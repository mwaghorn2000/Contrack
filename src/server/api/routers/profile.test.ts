import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../../generated/prisma";
import { clearTestDatabase, startTestDatabase } from "~/test/database";
import { profileRouter } from "./profile";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let userId: string;
let caller: ReturnType<typeof profileRouter.createCaller>;

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
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
