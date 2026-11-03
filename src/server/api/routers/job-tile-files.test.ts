import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { createImageUpload } from "~/server/image-uploads";
import {
  deleteObject,
  getObjectInfo,
  storageConfigured,
} from "~/server/storage";
import { jobRouter } from "./job";
import { jobTileRouter } from "./job-tile";
import type { CompanyRole, PrismaClient } from "../../../../generated/prisma";

// Only prevent application services from loading. Queries use real PostgreSQL.
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/storage", () => ({
  UPLOAD_CACHE_CONTROL: "private, max-age=31536000",
  storageConfigured: vi.fn(() => true),
  signedReadUrl: (key: string) => Promise.resolve(`signed:${key}`),
  createUploadUrl: (key: string) =>
    Promise.resolve(`https://upload.example.com/${key}`),
  getObjectInfo: vi.fn(),
  deleteObject: vi.fn(),
  deletePrefix: vi.fn(),
}));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let companyId: string;
let people = 0;

type Person = Awaited<ReturnType<typeof personWithRole>>;
let owner: Person;
let worker: Person;
let colleague: Person;
let outsider: Person;
let jobId: string;
let tiles: { photos: string; checklist: string; hidden: string };

const missingId = "cmissing00000000000000001";
const png = { contentType: "image/png" as const, size: 2048 };
const pdf = { contentType: "application/pdf" as const, size: 50_000 };

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

/** Adds someone to the company with a role, with callers for both routers. */
async function personWithRole(role: CompanyRole) {
  const user = await db.user.create({
    data: {
      name: `${role} ${++people}`,
      email: `person-${people}@example.com`,
    },
  });
  await db.companyMember.create({
    data: { userId: user.id, companyId, role },
  });
  const context = {
    db,
    session: {
      user: { id: user.id, name: user.name, email: user.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  };
  return {
    id: user.id,
    caller: jobTileRouter.createCaller(context),
    jobs: jobRouter.createCaller(context),
  };
}

/**
 * The job: the owner isn't on it; a worker and a colleague are. "photos"
 * takes files, "checklist" doesn't, and only the worker can see "hidden".
 */
beforeEach(async () => {
  vi.mocked(storageConfigured).mockReturnValue(true);
  vi.mocked(deleteObject).mockReset();
  vi.mocked(getObjectInfo).mockReset();
  // Storage reports whatever type the key's extension says.
  vi.mocked(getObjectInfo).mockImplementation((key: string) =>
    Promise.resolve(
      key.endsWith(".pdf")
        ? { contentType: "application/pdf", size: 50_000 }
        : { contentType: "image/png", size: 2048 },
    ),
  );
  await clearTestDatabase(db);
  const company = await db.company.create({ data: { name: "Acme" } });
  companyId = company.id;
  owner = await personWithRole("OWNER");
  worker = await personWithRole("MEMBER");
  colleague = await personWithRole("MEMBER");
  outsider = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: owner.id,
      title: "Roof",
      members: {
        create: [worker, colleague].map(({ id }) => ({ userId: id })),
      },
    },
  });
  jobId = job.id;
  const tile = (
    position: number,
    type: string,
    config: object,
    userIds?: string[],
  ) =>
    db.jobTile.create({
      data: {
        jobId,
        type,
        position,
        config,
        visibility: userIds
          ? { mode: "members", userIds }
          : { mode: "everyone" },
      },
    });
  const [photos, checklist, hidden] = await Promise.all([
    tile(0, "photos", {}),
    tile(1, "checklist", { mode: "shared", items: [{ id: "a", text: "A" }] }),
    tile(2, "photos", {}, [worker.id]),
  ]);
  tiles = { photos: photos.id, checklist: checklist.id, hidden: hidden.id };
});

/** Signs an upload as someone and returns its key. */
async function uploaded(
  person: Person,
  file: { contentType: "image/png" | "application/pdf"; size: number } = png,
  tileId = tiles.photos,
) {
  const { key } = await person.caller.createFileUpload({
    tileId,
    ...file,
  });
  return key;
}

it("createFileUpload signs an upload into the tile's own folder", async () => {
  const image = await worker.caller.createFileUpload({
    tileId: tiles.photos,
    ...png,
  });
  expect(image.key).toMatch(
    new RegExp(`^jobs/${jobId}/tiles/${tiles.photos}/[0-9a-f-]{36}\\.png$`),
  );
  expect(image.uploadUrl).toBe(`https://upload.example.com/${image.key}`);
  expect(image.headers["Content-Type"]).toBe("image/png");
  expect(await uploaded(worker, pdf)).toMatch(/\.pdf$/);
});

it("createFileUpload only takes images and PDFs up to 20 MB, on tiles that take files", async () => {
  for (const input of [
    { tileId: tiles.photos, contentType: "text/plain", size: 10 },
    {
      tileId: tiles.photos,
      contentType: "application/pdf",
      size: 20 * 1024 * 1024 + 1,
    },
    { tileId: tiles.photos, contentType: "image/png", size: 0 },
    { tileId: tiles.checklist, ...png },
  ])
    await expect(
      // Typed as allowed, to check the server rejects what isn't.
      worker.caller.createFileUpload(input as typeof input & typeof png),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createFileUpload hides tiles the person can't see", async () => {
  for (const [person, tileId] of [
    [colleague, tiles.hidden],
    [outsider, tiles.photos],
    [worker, missingId],
  ] as const)
    await expect(uploaded(person, png, tileId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Tile not found.",
    });
});

it("createFileUpload says when file storage isn't set up", async () => {
  vi.mocked(storageConfigured).mockReturnValue(false);
  await expect(uploaded(worker)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
});

it("job files have their own, higher hourly limit", async () => {
  // A busy morning of profile and chat images doesn't block job photos...
  await db.imageUpload.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      key: `users/${worker.id}/avatar/${i}.png`,
      userId: worker.id,
    })),
  });
  await uploaded(worker);
  // ...and job photos don't use up the allowance for other images.
  await db.imageUpload.deleteMany({ where: { key: { startsWith: "users/" } } });
  await db.imageUpload.createMany({
    data: Array.from({ length: 298 }, (_, i) => ({
      key: `jobs/${jobId}/tiles/${tiles.photos}/${i}.png`,
      userId: worker.id,
    })),
  });
  await createImageUpload(
    db,
    worker.id,
    `users/${worker.id}/avatar`,
    "avatar",
    png,
  );
  // The 300th job file this hour is the last.
  await uploaded(worker);
  await expect(uploaded(worker)).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
});

it("an answer keeps its files, with their names, types and sizes", async () => {
  const photo = await uploaded(worker);
  const plan = await uploaded(worker, pdf);

  await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    note: "Before we started",
    files: [
      { key: photo, name: "IMG_0042.png" },
      { key: plan, name: "Site plan.pdf" },
    ],
  });

  const answers = await colleague.caller.listAnswers({ jobId });
  expect(answers[tiles.photos]).toEqual([
    expect.objectContaining({
      note: "Before we started",
      files: [
        {
          id: expect.any(String) as string,
          // Only Form tiles file answers under a field.
          fieldId: null,
          name: "IMG_0042.png",
          contentType: "image/png",
          size: 2048,
          url: `signed:${photo}`,
        },
        expect.objectContaining({
          name: "Site plan.pdf",
          contentType: "application/pdf",
          url: `signed:${plan}`,
        }),
      ],
    }),
  ]);
});

it("a Photos answer needs at least one file, and at most ten", async () => {
  await expect(
    worker.caller.createAnswer({ tileId: tiles.photos, data: {}, files: [] }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Add at least one photo or file.",
  });
  const keys = await Promise.all(
    Array.from({ length: 11 }, () => uploaded(worker)),
  );
  await expect(
    worker.caller.createAnswer({
      tileId: tiles.photos,
      data: {},
      files: keys.map((key) => ({ key, name: "a.png" })),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("files can't be attached to tiles that don't take them", async () => {
  const key = await uploaded(worker);
  await expect(
    worker.caller.createAnswer({
      tileId: tiles.checklist,
      data: { itemId: "a" },
      files: [{ key, name: "a.png" }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("only the uploader's own, unused upload for this tile can be attached", async () => {
  const theirs = await uploaded(colleague);
  const elsewhere = await uploaded(worker, png, tiles.hidden);
  const mine = await uploaded(worker);
  await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    files: [{ key: mine, name: "a.png" }],
  });

  for (const key of [theirs, elsewhere, mine])
    await expect(
      worker.caller.createAnswer({
        tileId: tiles.photos,
        data: {},
        files: [{ key, name: "a.png" }],
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/) as string,
    });
  expect(await db.jobTileAnswer.count()).toBe(1);
});

it("a file that isn't what it claimed is deleted and refused", async () => {
  const key = await uploaded(worker);
  vi.mocked(getObjectInfo).mockResolvedValueOnce({
    contentType: "text/html",
    size: 2048,
  });

  await expect(
    worker.caller.createAnswer({
      tileId: tiles.photos,
      data: {},
      files: [{ key, name: "a.png" }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(deleteObject).toHaveBeenCalledWith(key);
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("deleting an answer deletes its files from storage", async () => {
  const key = await uploaded(worker);
  const { id } = await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    files: [{ key, name: "a.png" }],
  });

  await owner.caller.deleteAnswer({ answerId: id });

  expect(deleteObject).toHaveBeenCalledWith(key);
  expect(await db.jobTileFile.count()).toBe(0);
});

it("createFileUpload rejects unauthenticated requests and invalid input", async () => {
  const anonymous = jobTileRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.createFileUpload({ tileId: tiles.photos, ...png }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    worker.caller.createFileUpload({ tileId: "nope", ...png }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("only keys in a tile's folder, with a known extension, are accepted", async () => {
  for (const key of [
    `jobs/${jobId}/tiles/${tiles.photos}/../photo/00000000-0000-0000-0000-000000000000.png`,
    `jobs/${jobId}/tiles/${tiles.photos}/00000000-0000-0000-0000-000000000000.svg`,
    `jobs/${jobId}/photo/00000000-0000-0000-0000-000000000000.png`,
  ])
    await expect(
      worker.caller.createAnswer({
        tileId: tiles.photos,
        data: {},
        files: [{ key, name: "a.png" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("people who can't see the tile can't attach files to it", async () => {
  const key = await uploaded(worker, png, tiles.hidden);
  await expect(
    colleague.caller.createAnswer({
      tileId: tiles.hidden,
      data: {},
      files: [{ key, name: "a.png" }],
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Tile not found." });
  const anonymous = jobTileRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.createAnswer({
      tileId: tiles.photos,
      data: {},
      files: [{ key, name: "a.png" }],
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("a very long file name is shortened rather than refused", async () => {
  const key = await uploaded(worker);
  await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    files: [{ key, name: `${"x".repeat(250)}.png` }],
  });
  expect((await db.jobTileFile.findFirstOrThrow()).name).toHaveLength(200);
});

it("files are listed without links when storage isn't set up", async () => {
  const key = await uploaded(worker);
  await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    files: [{ key, name: "a.png" }],
  });
  vi.mocked(storageConfigured).mockReturnValue(false);

  const [answer] = (await worker.caller.listAnswers({ jobId }))[tiles.photos]!;
  expect(answer?.files).toEqual([
    expect.objectContaining({ name: "a.png", url: null }),
  ]);
});

it("an answer is deleted even when storage fails to delete its files", async () => {
  const key = await uploaded(worker);
  const { id } = await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    files: [{ key, name: "a.png" }],
  });
  vi.mocked(deleteObject).mockRejectedValueOnce(new Error("offline"));

  await worker.caller.deleteAnswer({ answerId: id });
  expect(await db.jobTileAnswer.count()).toBe(0);
  // Without storage, there's nothing to delete it from.
  const second = await uploaded(worker);
  const { id: again } = await worker.caller.createAnswer({
    tileId: tiles.photos,
    data: {},
    files: [{ key: second, name: "b.png" }],
  });
  vi.mocked(storageConfigured).mockReturnValue(false);
  vi.mocked(deleteObject).mockClear();
  await worker.caller.deleteAnswer({ answerId: again });
  expect(deleteObject).not.toHaveBeenCalled();
});
