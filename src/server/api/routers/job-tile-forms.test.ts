import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { getObjectInfo, storageConfigured } from "~/server/storage";
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
let jobId: string;
let people = 0;

type Person = Awaited<ReturnType<typeof personWithRole>>;
let owner: Person;
let worker: Person;
let colleague: Person;
let bystander: Person;

const fields = [
  { id: "name", kind: "short", label: "Name", required: true },
  { id: "notes", kind: "long", label: "Notes", required: false },
  { id: "hours", kind: "number", label: "Hours", required: false },
  { id: "safe", kind: "yesno", label: "Safe?", required: false },
  { id: "done", kind: "date", label: "Done on", required: false },
  {
    id: "weather",
    kind: "choice",
    label: "Weather",
    required: false,
    options: ["Fine", "Rain"],
  },
  { id: "photos", kind: "files", label: "Site photos", required: true },
  { id: "docs", kind: "files", label: "Signed docs", required: false },
];

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

/** Adds someone to the company with a role, with a job tile caller. */
async function personWithRole(role: CompanyRole) {
  const user = await db.user.create({
    data: { name: `${role} ${++people}`, email: `form-${people}@example.com` },
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
 * The job: a worker, a colleague and a bystander are on it; the worker and
 * colleague must submit. The owner isn't on the job but sees every tile.
 */
beforeEach(async () => {
  vi.mocked(storageConfigured).mockReturnValue(true);
  vi.mocked(getObjectInfo).mockResolvedValue({
    contentType: "image/png",
    size: 2048,
  });
  await clearTestDatabase(db);
  companyId = (await db.company.create({ data: { name: "Acme" } })).id;
  owner = await personWithRole("OWNER");
  worker = await personWithRole("MEMBER");
  colleague = await personWithRole("MEMBER");
  bystander = await personWithRole("MEMBER");
  jobId = (
    await db.job.create({
      data: {
        companyId,
        createdById: owner.id,
        title: "Roof",
        members: {
          create: [worker, colleague, bystander].map(({ id }) => ({
            userId: id,
          })),
        },
      },
    })
  ).id;
});

/** A Form tile with every kind of field, submitted once or by each person. */
async function formTile(mode: "one" | "each") {
  const tile = await db.jobTile.create({
    data: {
      jobId,
      type: "form",
      position: 0,
      visibility: { mode: "everyone" },
      config: { fields, submitters: [worker.id, colleague.id], mode },
    },
  });
  return tile.id;
}

/** Uploads a photo to the tile as someone, under a field. */
async function photo(person: Person, tileId: string, fieldId = "photos") {
  const { key } = await person.caller.createFileUpload({
    tileId,
    contentType: "image/png",
    size: 2048,
  });
  return { key, name: "a.png", fieldId };
}

/** Submits the form as someone with a name and one site photo. */
async function submit(person: Person, tileId: string) {
  return person.caller.createAnswer({
    tileId,
    data: { values: { name: "Ada" } },
    files: [await photo(person, tileId)],
  });
}

it("a submitter fills in each kind of field, with files under their fields", async () => {
  const tileId = await formTile("one");
  const values = {
    name: "Ada",
    notes: "All good",
    hours: 7.5,
    safe: true,
    done: "2026-11-03",
    weather: "Rain",
  };

  await worker.caller.createAnswer({
    tileId,
    data: { values },
    files: [await photo(worker, tileId), await photo(worker, tileId, "docs")],
  });

  const [answer] = (await bystander.caller.listAnswers({ jobId }))[tileId]!;
  expect(answer?.data).toEqual({ values });
  expect(answer?.files.map(({ fieldId }) => fieldId)).toEqual([
    "photos",
    "docs",
  ]);
});

it("only the people asked can submit", async () => {
  const tileId = await formTile("each");
  for (const person of [owner, bystander])
    await expect(submit(person, tileId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "You're not asked to submit this form.",
    });
});

it("a form for any one person is done once someone submits, until it's deleted", async () => {
  const tileId = await formTile("one");
  const { id } = await submit(worker, tileId);

  await expect(submit(colleague, tileId)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "This form has already been submitted.",
  });
  await worker.caller.deleteAnswer({ answerId: id });
  await submit(colleague, tileId);
});

it("a form for each person takes one submission from each", async () => {
  const tileId = await formTile("each");
  await submit(worker, tileId);
  await submit(colleague, tileId);

  await expect(submit(worker, tileId)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "You've already submitted this form.",
  });
});

it("required fields and file fields must be filled in", async () => {
  const tileId = await formTile("one");
  await expect(
    worker.caller.createAnswer({
      tileId,
      data: { values: { name: "  " } },
      files: [await photo(worker, tileId)],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST", message: 'Fill in "Name".' });
  await expect(
    worker.caller.createAnswer({ tileId, data: { values: { name: "Ada" } } }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: 'Add a file to "Site photos".',
  });
});

it("answers must fit their fields", async () => {
  const tileId = await formTile("one");
  for (const values of [
    { name: "Ada", hours: "seven" },
    { name: "Ada", safe: "yes" },
    { name: "Ada", done: "3 Nov" },
    { name: "Ada", done: "2026-02-31" },
    { name: "Ada", weather: "Snow" },
    { name: "Ada", colour: "Red" },
    { name: 42 },
  ])
    await expect(
      worker.caller.createAnswer({
        tileId,
        data: { values },
        files: [await photo(worker, tileId)],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "That answer doesn't fit this form.",
    });
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("files must go under one of the form's file fields, ten at most each", async () => {
  const tileId = await formTile("one");
  for (const files of [
    [await photo(worker, tileId), await photo(worker, tileId, "name")],
    [{ ...(await photo(worker, tileId)), fieldId: undefined }],
  ])
    await expect(
      worker.caller.createAnswer({
        tileId,
        data: { values: { name: "Ada" } },
        files,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Those files don't fit this form's fields.",
    });
  const many = await Promise.all(
    Array.from({ length: 11 }, () => photo(worker, tileId)),
  );
  await expect(
    worker.caller.createAnswer({
      tileId,
      data: { values: { name: "Ada" } },
      files: many,
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: 'Attach at most 10 files to "Site photos".',
  });
});

it("submissions don't take notes", async () => {
  const tileId = await formTile("one");
  await expect(
    worker.caller.createAnswer({
      tileId,
      data: { values: { name: "Ada" } },
      note: "Hi",
      files: [await photo(worker, tileId)],
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "This tile doesn't take notes.",
  });
});

it("submitters can edit their answers and add or remove files", async () => {
  const tileId = await formTile("one");
  const { id } = await submit(worker, tileId);

  await worker.caller.updateAnswer({
    answerId: id,
    data: { values: { name: "Ada L" } },
    addFiles: [await photo(worker, tileId, "docs")],
  });

  const [answer] = (await worker.caller.listAnswers({ jobId }))[tileId]!;
  expect(answer?.data).toEqual({ values: { name: "Ada L" } });
  expect(answer?.files.map(({ fieldId }) => fieldId)).toEqual([
    "photos",
    "docs",
  ]);
  // A required file field can't be emptied.
  const [first] = answer!.files;
  await expect(
    worker.caller.updateAnswer({
      answerId: id,
      data: { values: { name: "Ada L" } },
      removeFileIds: [first!.id],
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: 'Add a file to "Site photos".',
  });
});

it("people who can't see the form can't submit it", async () => {
  const tileId = await formTile("one");
  await db.jobTile.update({
    where: { id: tileId },
    data: { visibility: { mode: "members", userIds: [colleague.id] } },
  });
  await expect(submit(worker, tileId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("submitters who left the job or can no longer see the form aren't waited on", async () => {
  const tileId = await formTile("each");
  await db.jobTile.update({
    where: { id: tileId },
    data: {
      visibility: { mode: "members", userIds: [worker.id, colleague.id] },
      config: {
        fields,
        submitters: [worker.id, colleague.id, bystander.id],
        mode: "each",
      },
    },
  });
  await db.jobMember.updateMany({
    where: { jobId, userId: colleague.id },
    data: { removedAt: new Date() },
  });

  for (const person of [owner, worker]) {
    const job = await person.jobs.getJob({ jobId });
    expect(job.tiles[0]?.config).toMatchObject({ submitters: [worker.id] });
  }
});

it("someone taken off the submitters can still edit or delete what they sent", async () => {
  const tileId = await formTile("each");
  const { id } = await submit(worker, tileId);
  await db.jobTile.update({
    where: { id: tileId },
    data: { config: { fields, submitters: [colleague.id], mode: "each" } },
  });

  await worker.caller.updateAnswer({
    answerId: id,
    data: { values: { name: "Ada L" } },
    addFiles: [await photo(worker, tileId, "docs")],
  });
  await worker.caller.deleteAnswer({ answerId: id });
  await expect(submit(worker, tileId)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "You're not asked to submit this form.",
  });
});

it("files under a since-deleted field don't block file changes", async () => {
  const tileId = await formTile("one");
  const { id } = await worker.caller.createAnswer({
    tileId,
    data: { values: { name: "Ada" } },
    files: [await photo(worker, tileId), await photo(worker, tileId, "docs")],
  });
  await db.jobTile.update({
    where: { id: tileId },
    data: {
      config: {
        fields: fields.filter((field) => field.id !== "docs"),
        submitters: [worker.id, colleague.id],
        mode: "one",
      },
    },
  });

  await worker.caller.updateAnswer({
    answerId: id,
    data: { values: { name: "Ada" } },
    addFiles: [await photo(worker, tileId)],
  });
  expect(await db.jobTileFile.count({ where: { answerId: id } })).toBe(3);
});
