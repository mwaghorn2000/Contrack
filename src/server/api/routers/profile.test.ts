import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../../generated/prisma";
import { clearTestDatabase, startTestDatabase } from "~/test/database";
import {
  createUploadUrl,
  deleteObject,
  getObjectInfo,
  storageConfigured,
} from "~/server/storage";
import { IMAGE_UPLOADS_PER_HOUR } from "~/server/image-uploads";
import { profileRouter } from "./profile";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/storage", () => {
  const base = "https://images.example.com/";
  return {
    UPLOAD_CACHE_CONTROL: "public, max-age=31536000, immutable",
    storageConfigured: vi.fn(() => true),
    publicUrl: (key: string) => `${base}${key}`,
    keyFromPublicUrl: (url: string) =>
      url.startsWith(base) ? url.slice(base.length) : null,
    createUploadUrl: vi.fn((key: string) =>
      Promise.resolve(`https://upload.example.com/${key}`),
    ),
    getObjectInfo: vi.fn(),
    deleteObject: vi.fn(),
    deletePrefix: vi.fn(),
  };
});

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let userId: string;
let caller: ReturnType<typeof profileRouter.createCaller>;

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  vi.mocked(storageConfigured).mockReturnValue(true);
  vi.mocked(getObjectInfo).mockReset();
  vi.mocked(getObjectInfo).mockResolvedValue({
    size: 1024,
    contentType: "image/png",
  });
  vi.mocked(deleteObject).mockReset();
  await clearTestDatabase(db);
  const user = await db.user.create({
    data: {
      name: "Original Name",
      email: "profile@example.com",
      description: "Original description",
      image: "https://example.com/avatar.png",
      passwordHash: "private-password-hash",
      emailVerified: new Date("2026-01-01"),
    },
  });
  userId = user.id;
  caller = profileRouter.createCaller({
    db,
    session: {
      user: { id: userId, name: user.name, email: user.email },
      expires: "2099-01-01",
    },
    headers: new Headers(),
  });
});

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

it("get returns the current user's profile without authentication secrets", async () => {
  expect(await caller.get()).toEqual({
    id: userId,
    name: "Original Name",
    email: "profile@example.com",
    description: "Original description",
    image: "https://example.com/avatar.png",
  });
});

it("update saves a trimmed name and description and preserves account details", async () => {
  const result = await caller.update({
    name: " Updated Name ",
    description: " Updated description ",
  });
  expect(result).toMatchObject({
    id: userId,
    name: "Updated Name",
    description: "Updated description",
  });
  expect(result).not.toHaveProperty("passwordHash");
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({
    name: "Updated Name",
    description: "Updated description",
    email: "profile@example.com",
    image: "https://example.com/avatar.png",
    passwordHash: "private-password-hash",
    emailVerified: new Date("2026-01-01"),
  });
});

it("get returns the saved name even when the session still has the previous name", async () => {
  await caller.update({ name: "New Name", description: "New description" });
  expect(await caller.get()).toMatchObject({
    name: "New Name",
    description: "New description",
  });
});

it("update changes only the signed-in user", async () => {
  const other = await db.user.create({
    data: { name: "Other person", description: "Keep this" },
  });
  await caller.update({ name: "New Name", description: "New description" });
  expect(await db.user.findUnique({ where: { id: other.id } })).toMatchObject({
    name: "Other person",
    description: "Keep this",
  });
});

it("update rejects a supplied user ID", async () => {
  const other = await db.user.create({ data: { name: "Other person" } });
  const input = { name: "Changed", description: "Changed", userId: other.id };
  await expect(caller.update(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({
    name: "Original Name",
  });
  expect(await db.user.findUnique({ where: { id: other.id } })).toMatchObject({
    name: "Other person",
  });
});

it("update rejects extra account fields", async () => {
  const input = {
    name: "Changed",
    description: "Changed",
    email: "different@example.com",
    passwordHash: "changed",
  };
  await expect(caller.update(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({
    email: "profile@example.com",
    passwordHash: "private-password-hash",
  });
});

it("update clears a description when it is blank", async () => {
  expect(
    (await caller.update({ name: "Original Name", description: "  \n  " }))
      .description,
  ).toBeNull();
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).description,
  ).toBeNull();
});

it("update accepts a null description", async () => {
  expect(
    (await caller.update({ name: "Original Name", description: null }))
      .description,
  ).toBeNull();
});

it("update preserves line breaks within a description", async () => {
  const description = "Builder\nBased in Sydney";
  expect(
    (await caller.update({ name: "Original Name", description })).description,
  ).toBe(description);
});

it("update accepts a one-character name", async () => {
  expect((await caller.update({ name: "A", description: null })).name).toBe(
    "A",
  );
});

it("update accepts a 100-character Unicode name", async () => {
  const name = "😀".repeat(100);
  expect((await caller.update({ name, description: null })).name).toBe(name);
});

it("update rejects an empty name without changing the profile", async () => {
  await expect(
    caller.update({ name: "", description: "Changed" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.get()).toMatchObject({
    name: "Original Name",
    description: "Original description",
  });
});

it("update rejects a whitespace-only name", async () => {
  await expect(
    caller.update({ name: " \t ", description: null }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("update rejects a name longer than 100 characters", async () => {
  await expect(
    caller.update({ name: "A".repeat(101), description: null }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("update rejects control characters in a name", async () => {
  await expect(
    caller.update({ name: "Test\u0000Name", description: null }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("update accepts a 500-character Unicode description", async () => {
  const description = "😀".repeat(500);
  expect((await caller.update({ name: "Name", description })).description).toBe(
    description,
  );
});

it("update rejects a description longer than 500 characters", async () => {
  await expect(
    caller.update({ name: "Name", description: "A".repeat(501) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.get()).toMatchObject({
    name: "Original Name",
    description: "Original description",
  });
});

it("update rejects null characters in a description before writing to PostgreSQL", async () => {
  await expect(
    caller.update({ name: "Name", description: "Test\u0000description" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("get requires authentication", async () => {
  const anonymous = profileRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("update requires authentication", async () => {
  const anonymous = profileRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.update({ name: "Name", description: null }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rejects a session after its user is deleted", async () => {
  await db.user.delete({ where: { id: userId } });
  await expect(caller.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    caller.update({ name: "Name", description: null }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

async function uploadedAvatarKey() {
  const upload = await caller.createAvatarUpload({
    contentType: "image/png",
    size: 1024,
  });
  return upload.key;
}

it("createAvatarUpload returns a signed upload in the user's folder", async () => {
  const upload = await caller.createAvatarUpload({
    contentType: "image/webp",
    size: 2048,
  });
  expect(upload.key).toMatch(
    new RegExp(`^users/${userId}/avatar/[0-9a-f-]{36}\\.webp$`),
  );
  expect(upload.uploadUrl).toBe(`https://upload.example.com/${upload.key}`);
  // The URL is signed for this exact type and size, so these must be sent.
  expect(createUploadUrl).toHaveBeenLastCalledWith(
    upload.key,
    "image/webp",
    2048,
  );
  expect(upload.headers).toEqual({
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  expect(
    await db.imageUpload.findUniqueOrThrow({ where: { key: upload.key } }),
  ).toMatchObject({ userId, confirmedAt: null });
});

it("createAvatarUpload limits how many uploads a user can request per hour", async () => {
  await db.imageUpload.createMany({
    data: Array.from({ length: IMAGE_UPLOADS_PER_HOUR }, (_, index) => ({
      key: `users/${userId}/avatar/old-${index}.png`,
      userId,
    })),
  });
  await expect(
    caller.createAvatarUpload({ contentType: "image/png", size: 10 }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

it("createAvatarUpload allows new uploads once older requests are an hour old", async () => {
  await db.imageUpload.createMany({
    data: Array.from({ length: IMAGE_UPLOADS_PER_HOUR }, (_, index) => ({
      key: `users/${userId}/avatar/old-${index}.png`,
      userId,
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    })),
  });
  await expect(
    caller.createAvatarUpload({ contentType: "image/png", size: 10 }),
  ).resolves.toHaveProperty("key");
});

it("createAvatarUpload rejects unsupported image types", async () => {
  await expect(
    caller.createAvatarUpload({
      contentType: "image/svg+xml" as "image/png",
      size: 10,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createAvatarUpload rejects images larger than 5 MB", async () => {
  await expect(
    caller.createAvatarUpload({
      contentType: "image/png",
      size: 5 * 1024 * 1024 + 1,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createAvatarUpload explains when storage is not configured", async () => {
  vi.mocked(storageConfigured).mockReturnValue(false);
  await expect(
    caller.createAvatarUpload({ contentType: "image/png", size: 10 }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("setAvatar saves the uploaded image and keeps an external previous image", async () => {
  const key = await uploadedAvatarKey();
  expect(await caller.setAvatar({ key })).toMatchObject({
    image: `https://images.example.com/${key}`,
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).image,
  ).toBe(`https://images.example.com/${key}`);
  expect(deleteObject).not.toHaveBeenCalled();
});

it("setAvatar deletes the previous uploaded avatar", async () => {
  const first = await uploadedAvatarKey();
  await caller.setAvatar({ key: first });
  const second = await uploadedAvatarKey();
  await caller.setAvatar({ key: second });
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(first);
});

it("setAvatar rejects another user's upload", async () => {
  const other = await db.user.create({ data: { name: "Other person" } });
  const key = `users/${other.id}/avatar/00000000-0000-4000-8000-000000000000.png`;
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).image,
  ).toBe("https://example.com/avatar.png");
});

it("setAvatar rejects a key in the user's folder that was never requested", async () => {
  const key = `users/${userId}/avatar/00000000-0000-4000-8000-000000000000.png`;
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(getObjectInfo).not.toHaveBeenCalled();
});

it("setAvatar confirms each upload only once", async () => {
  const key = await uploadedAvatarKey();
  await caller.setAvatar({ key });
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("setAvatar rejects an upload requested more than an hour ago", async () => {
  const key = await uploadedAvatarKey();
  await db.imageUpload.update({
    where: { key },
    data: { createdAt: new Date(Date.now() - 61 * 60 * 1000) },
  });
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("setAvatar rejects keys outside the upload format", async () => {
  await expect(
    caller.setAvatar({ key: `users/${userId}/avatar/../../secret.png` }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("setAvatar rejects an upload that was never completed", async () => {
  vi.mocked(getObjectInfo).mockResolvedValue(null);
  const key = await uploadedAvatarKey();
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("setAvatar deletes and rejects an oversized upload", async () => {
  vi.mocked(getObjectInfo).mockResolvedValue({
    size: 5 * 1024 * 1024 + 1,
    contentType: "image/png",
  });
  const key = await uploadedAvatarKey();
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).image,
  ).toBe("https://example.com/avatar.png");
});

it("setAvatar deletes and rejects an upload with a different content type", async () => {
  vi.mocked(getObjectInfo).mockResolvedValue({
    size: 1024,
    contentType: "text/html",
  });
  const key = await uploadedAvatarKey();
  await expect(caller.setAvatar({ key })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key);
});

it("setAvatar still saves when deleting the previous avatar fails", async () => {
  const first = await uploadedAvatarKey();
  await caller.setAvatar({ key: first });
  vi.mocked(deleteObject).mockRejectedValueOnce(new Error("offline"));
  vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
  const second = await uploadedAvatarKey();
  expect((await caller.setAvatar({ key: second })).image).toBe(
    `https://images.example.com/${second}`,
  );
});

it("removeAvatar clears the photo and deletes an uploaded avatar", async () => {
  const key = await uploadedAvatarKey();
  await caller.setAvatar({ key });
  expect((await caller.removeAvatar()).image).toBeNull();
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key);
});

it("avatar procedures require authentication", async () => {
  const anonymous = profileRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.createAvatarUpload({ contentType: "image/png", size: 10 }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(anonymous.removeAvatar()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
