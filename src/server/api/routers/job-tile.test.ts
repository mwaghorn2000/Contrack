import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { jobRouter } from "./job";
import { jobTileRouter } from "./job-tile";
import type {
  CompanyRole,
  Prisma,
  PrismaClient,
} from "../../../../generated/prisma";

// Only prevent application services from loading. Queries use real PostgreSQL.
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/storage", () => ({
  storageConfigured: () => false,
  signedReadUrl: (key: string) => Promise.resolve(`signed:${key}`),
}));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let companyId: string;
let people = 0;

type Person = Awaited<ReturnType<typeof personWithRole>>;
let owner: Person;
let admin: Person;
let worker: Person;
let colleague: Person;
let outsider: Person;
let jobId: string;
let tiles: { shared: string; each: string; text: string };

const missingId = "cmissing00000000000000001";

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
    name: user.name,
    caller: jobTileRouter.createCaller(context),
    jobs: jobRouter.createCaller(context),
  };
}

/** A Checklist tile row with items "a" and "b". */
function checklist(
  position: number,
  mode: "shared" | "each",
  visibility: Prisma.InputJsonValue = { mode: "everyone" },
) {
  return {
    type: "checklist",
    position,
    visibility,
    config: {
      mode,
      items: [
        { id: "a", text: "Isolate power" },
        { id: "b", text: "Fit harness" },
      ],
    },
  };
}

/**
 * The job: the owner isn't on it; an admin, a worker and a colleague are.
 * "shared" is ticked once for the job, "each" (only the worker can see it,
 * besides managers) per person, and "text" takes no answers.
 */
beforeEach(async () => {
  await clearTestDatabase(db);
  const company = await db.company.create({ data: { name: "Acme" } });
  companyId = company.id;
  owner = await personWithRole("OWNER");
  admin = await personWithRole("ADMIN");
  worker = await personWithRole("MEMBER");
  colleague = await personWithRole("MEMBER");
  outsider = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: owner.id,
      title: "Roof",
      members: {
        create: [admin, worker, colleague].map(({ id }) => ({ userId: id })),
      },
    },
  });
  jobId = job.id;
  const [shared, each, text] = await Promise.all([
    db.jobTile.create({ data: { jobId, ...checklist(0, "shared") } }),
    db.jobTile.create({
      data: {
        jobId,
        ...checklist(1, "each", { mode: "members", userIds: [worker.id] }),
      },
    }),
    db.jobTile.create({
      data: {
        jobId,
        type: "text",
        position: 2,
        visibility: { mode: "everyone" },
        config: { body: "Read me" },
      },
    }),
  ]);
  tiles = { shared: shared.id, each: each.id, text: text.id };
});

/** Ticks an item on a Checklist tile as someone, returning the answer id. */
async function tick(
  person: Person,
  tileId: string,
  itemId = "a",
  note?: string,
) {
  const { id } = await person.caller.createAnswer({
    tileId,
    data: { itemId },
    note,
  });
  return id;
}

it("an answer is saved with its author, note and dates", async () => {
  const id = await tick(worker, tiles.shared, "a", "  Done at 9am  ");

  const row = await db.jobTileAnswer.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({
    tileId: tiles.shared,
    authorId: worker.id,
    data: { itemId: "a" },
    note: "Done at 9am",
  });
  expect(row.createdAt).toBeInstanceOf(Date);
  expect(row.updatedAt).toBeInstanceOf(Date);
});

it("answers outlive their author's account, and go with their job", async () => {
  const id = await tick(colleague, tiles.shared);

  await db.user.delete({ where: { id: colleague.id } });
  expect(
    (await db.jobTileAnswer.findUniqueOrThrow({ where: { id } })).authorId,
  ).toBeNull();
  await db.job.delete({ where: { id: jobId } });
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("removing a tile in the builder hides it but keeps it and its answers", async () => {
  await tick(worker, tiles.shared);
  const { tiles: saved } = await owner.jobs.getJob({ jobId });

  await owner.jobs.updateJob({
    jobId,
    title: "Roof",
    description: "",
    memberIds: [admin.id, worker.id, colleague.id],
    tiles: saved.filter((tile) => tile.id !== tiles.shared),
  });

  expect(
    (await db.jobTile.findUniqueOrThrow({ where: { id: tiles.shared } }))
      .removedAt,
  ).toBeInstanceOf(Date);
  expect(await db.jobTileAnswer.count()).toBe(1);
  expect(
    (await owner.jobs.getJob({ jobId })).tiles.map(({ id }) => id),
  ).not.toContain(tiles.shared);
  expect(await owner.caller.listAnswers({ jobId })).not.toHaveProperty(
    tiles.shared,
  );
  await expect(tick(worker, tiles.shared, "b")).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "Tile not found.",
  });
});

it("a shared checklist item is ticked once for the whole job", async () => {
  await tick(worker, tiles.shared, "a");

  await expect(tick(colleague, tiles.shared, "a")).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "That item is already ticked.",
  });
  // Owners and admins can answer too, even when they aren't on the job.
  await tick(owner, tiles.shared, "b");
  expect(await db.jobTileAnswer.count()).toBe(2);
});

it("on an each-person checklist, everyone ticks their own copy", async () => {
  await tick(worker, tiles.each, "a");
  await tick(admin, tiles.each, "a");

  await expect(tick(worker, tiles.each, "a")).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "You've already ticked that item.",
  });
  expect(await db.jobTileAnswer.count()).toBe(2);
});

it("createAnswer rejects answers that don't fit the tile", async () => {
  for (const input of [
    { tileId: tiles.shared, data: { itemId: "missing" } },
    { tileId: tiles.shared, data: { item: "a" } },
    { tileId: tiles.shared, data: { itemId: "a" }, note: "x".repeat(2001) },
    { tileId: tiles.text, data: {} },
  ])
    await expect(worker.caller.createAnswer(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("createAnswer hides tiles the person can't see", async () => {
  for (const [person, tileId] of [
    [colleague, tiles.each],
    [outsider, tiles.shared],
    [worker, missingId],
  ] as const)
    await expect(tick(person, tileId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Tile not found.",
    });
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("listAnswers shows everyone who can see a tile all of its answers", async () => {
  await tick(worker, tiles.shared, "a", "Isolated at the board");
  await tick(colleague, tiles.shared, "b");
  await tick(worker, tiles.each, "a");

  const answers = await colleague.caller.listAnswers({ jobId });
  // The colleague can't see "each", and "text" takes no answers.
  expect(Object.keys(answers)).toEqual([tiles.shared]);
  expect(answers[tiles.shared]).toEqual([
    {
      id: expect.any(String) as string,
      author: { id: worker.id, name: worker.name, image: null },
      data: { itemId: "a" },
      note: "Isolated at the board",
      createdAt: expect.any(Date) as Date,
      updatedAt: expect.any(Date) as Date,
      canEdit: false,
      canDelete: false,
    },
    expect.objectContaining({
      author: { id: colleague.id, name: colleague.name, image: null },
      canEdit: true,
      canDelete: true,
    }),
  ]);
  expect((await owner.caller.listAnswers({ jobId }))[tiles.each]).toHaveLength(
    1,
  );
});

it("listAnswers skips answers that no longer fit their tile", async () => {
  await db.jobTileAnswer.create({
    data: { tileId: tiles.shared, authorId: worker.id, data: { old: true } },
  });
  expect((await worker.caller.listAnswers({ jobId }))[tiles.shared]).toEqual(
    [],
  );
});

it("listAnswers hides the job from people who can't see it", async () => {
  await expect(outsider.caller.listAnswers({ jobId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("updateAnswer lets people change their own answer's note", async () => {
  const id = await tick(worker, tiles.shared, "a");

  await worker.caller.updateAnswer({
    answerId: id,
    data: { itemId: "a" },
    note: "Checked twice",
  });
  expect(
    (await db.jobTileAnswer.findUniqueOrThrow({ where: { id } })).note,
  ).toBe("Checked twice");
  // An empty note clears it.
  await worker.caller.updateAnswer({
    answerId: id,
    data: { itemId: "a" },
    note: "",
  });
  expect(
    (await db.jobTileAnswer.findUniqueOrThrow({ where: { id } })).note,
  ).toBeNull();
});

it("updateAnswer only lets the author change an answer", async () => {
  const id = await tick(worker, tiles.shared, "a");

  for (const person of [colleague, owner])
    await expect(
      person.caller.updateAnswer({
        answerId: id,
        data: { itemId: "a" },
        note: "Not mine",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const answerId of [id, missingId])
    await expect(
      outsider.caller.updateAnswer({ answerId, data: { itemId: "a" } }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Answer not found.",
    });
  expect(
    (await db.jobTileAnswer.findUniqueOrThrow({ where: { id } })).note,
  ).toBeNull();
});

it("updateAnswer still applies the tile's rules", async () => {
  await tick(worker, tiles.shared, "a");
  const id = await tick(colleague, tiles.shared, "b");

  await expect(
    colleague.caller.updateAnswer({ answerId: id, data: { itemId: "a" } }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  // Re-saving an answer unchanged doesn't clash with itself.
  await colleague.caller.updateAnswer({
    answerId: id,
    data: { itemId: "b" },
    note: "ok",
  });
});

it("deleteAnswer lets authors and managers remove answers", async () => {
  const mine = await tick(worker, tiles.shared, "a");
  const theirs = await tick(colleague, tiles.shared, "b");

  await expect(
    worker.caller.deleteAnswer({ answerId: theirs }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    outsider.caller.deleteAnswer({ answerId: theirs }),
  ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Answer not found." });
  await worker.caller.deleteAnswer({ answerId: mine });
  await owner.caller.deleteAnswer({ answerId: theirs });
  expect(await db.jobTileAnswer.count()).toBe(0);
});

it("answers reject unauthenticated requests and invalid ids", async () => {
  const anonymous = jobTileRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.listAnswers({ jobId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(
    anonymous.createAnswer({ tileId: tiles.shared, data: { itemId: "a" } }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  for (const call of [
    () => worker.caller.listAnswers({ jobId: "nope" }),
    () => worker.caller.createAnswer({ tileId: "nope", data: {} }),
    () => worker.caller.updateAnswer({ answerId: "nope", data: {} }),
    () => worker.caller.deleteAnswer({ answerId: "nope" }),
  ])
    await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("two people ticking the same shared item at once only tick it once", async () => {
  const results = await Promise.allSettled([
    tick(worker, tiles.shared, "a"),
    tick(colleague, tiles.shared, "a"),
  ]);
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(await db.jobTileAnswer.count()).toBe(1);
});

it("updateAnswer leaves the note alone when none is sent", async () => {
  const id = await tick(worker, tiles.shared, "a", "Keep me");

  await worker.caller.updateAnswer({ answerId: id, data: { itemId: "a" } });
  expect(
    (await db.jobTileAnswer.findUniqueOrThrow({ where: { id } })).note,
  ).toBe("Keep me");
  // An empty note clears it.
  await worker.caller.updateAnswer({
    answerId: id,
    data: { itemId: "a" },
    note: "",
  });
  expect(
    (await db.jobTileAnswer.findUniqueOrThrow({ where: { id } })).note,
  ).toBeNull();
});

it("a tick's note can't be edited once its item is off the list", async () => {
  const id = await tick(worker, tiles.shared, "b");
  await db.jobTile.update({
    where: { id: tiles.shared },
    data: {
      config: { mode: "shared", items: [{ id: "a", text: "Isolate power" }] },
    },
  });
  await expect(
    worker.caller.updateAnswer({
      answerId: id,
      data: { itemId: "b" },
      note: "Late",
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "That item isn't on this checklist.",
  });
});

it("a tile sent back as a different type is a new tile, keeping the old one's answers apart", async () => {
  await tick(worker, tiles.shared, "a");
  const { tiles: saved } = await owner.jobs.getJob({ jobId });

  await owner.jobs.updateJob({
    jobId,
    title: "Roof",
    description: "",
    memberIds: [admin.id, worker.id, colleague.id],
    tiles: saved.map((tile) =>
      tile.id === tiles.shared
        ? {
            id: tile.id,
            type: "text" as const,
            visibility: tile.visibility,
            config: { body: "Now text" },
          }
        : tile,
    ),
  });

  const old = await db.jobTile.findUniqueOrThrow({
    where: { id: tiles.shared },
  });
  expect(old.type).toBe("checklist");
  expect(old.removedAt).toBeInstanceOf(Date);
  expect(await db.jobTileAnswer.count({ where: { tileId: old.id } })).toBe(1);
  expect(
    await db.jobTile.count({
      where: { jobId, type: "text", config: { equals: { body: "Now text" } } },
    }),
  ).toBe(1);
});
