import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { jobRouter } from "./job";
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
let tiles: { open: string; limited: string; plain: string };

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

/** Adds someone to the company with a role and returns a caller for them. */
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
  const caller = jobRouter.createCaller({
    db,
    session: {
      user: { id: user.id, name: user.name, email: user.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  return { id: user.id, name: user.name, caller };
}

/** A Text tile row for the job. */
function tile(
  position: number,
  body: string,
  requiresAcknowledgment: boolean,
  visibility: Prisma.InputJsonValue = { mode: "everyone" },
) {
  return {
    type: "text",
    position,
    config: { body },
    visibility,
    requiresAcknowledgment,
  };
}

/**
 * The job: the owner isn't on it; an admin, a worker and a colleague are.
 * "open" needs everyone on the job to acknowledge it, "limited" only the
 * worker (and the admin, who sees every tile), and "plain" nobody.
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
  const [open, limited, plain] = await Promise.all([
    db.jobTile.create({ data: { jobId, ...tile(0, "Wear a harness", true) } }),
    db.jobTile.create({
      data: {
        jobId,
        ...tile(1, "Gate code 1234", true, {
          mode: "members",
          userIds: [worker.id],
        }),
      },
    }),
    db.jobTile.create({
      data: { jobId, ...tile(2, "Parking out back", false) },
    }),
  ]);
  tiles = { open: open.id, limited: limited.id, plain: plain.id };
});

/** The job's tiles as the builder would send them back, unchanged. */
async function savedTiles() {
  return (await owner.caller.getJob({ jobId })).tiles;
}

/** Acknowledgment rows for a tile, by user id. */
async function acknowledgedBy(tileId: string) {
  const rows = await db.jobTileAcknowledgment.findMany({
    where: { tileId },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  return rows.map(({ userId }) => userId);
}

it("acknowledgments are deleted with their tile and with the person", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  await colleague.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });

  await db.user.delete({ where: { id: colleague.id } });
  expect(await acknowledgedBy(tiles.open)).toEqual([worker.id]);
  await db.jobTile.delete({ where: { id: tiles.open } });
  expect(await db.jobTileAcknowledgment.count()).toBe(0);
});

it("createJob saves which tiles need acknowledging", async () => {
  const { id } = await owner.caller.createJob({
    companyId,
    title: "Fit-out",
    tiles: [
      {
        id: "a",
        type: "text",
        visibility: { mode: "everyone" },
        config: { body: "Read me" },
        requiresAcknowledgment: true,
      },
      // Older clients don't send the flag.
      {
        id: "b",
        type: "text",
        visibility: { mode: "everyone" },
        config: { body: "Optional" },
      },
    ],
  });

  const rows = await db.jobTile.findMany({
    where: { jobId: id },
    orderBy: { position: "asc" },
    select: { requiresAcknowledgment: true },
  });
  expect(rows).toEqual([
    { requiresAcknowledgment: true },
    { requiresAcknowledgment: false },
  ]);
});

it("editing a tile's text clears its acknowledgments", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.limited,
    acknowledged: true,
  });

  await owner.caller.updateJob({
    jobId,
    title: "Roof",
    description: "",
    memberIds: [admin.id, worker.id, colleague.id],
    tiles: (await savedTiles()).map((saved) =>
      saved.id === tiles.open && saved.type === "text"
        ? { ...saved, config: { body: "Wear a harness and a helmet" } }
        : saved,
    ),
  });

  expect(await acknowledgedBy(tiles.open)).toEqual([]);
  expect(await acknowledgedBy(tiles.limited)).toEqual([worker.id]);
});

it("editing a tile's description clears its acknowledgments too", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });

  await owner.caller.updateJob({
    jobId,
    title: "Roof",
    description: "",
    memberIds: [admin.id, worker.id, colleague.id],
    tiles: (await savedTiles()).map((saved) =>
      saved.id === tiles.open
        ? { ...saved, description: "Now with a helmet" }
        : saved,
    ),
  });

  expect(await acknowledgedBy(tiles.open)).toEqual([]);
  expect(
    (await owner.caller.getJob({ jobId })).tiles.find(
      ({ id }) => id === tiles.open,
    )?.description,
  ).toBe("Now with a helmet");
});

it("moving a tile or changing who sees it keeps its acknowledgments", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  const saved = await savedTiles();

  await owner.caller.updateJob({
    jobId,
    title: "Roof",
    description: "",
    memberIds: [admin.id, worker.id, colleague.id],
    tiles: [...saved]
      .reverse()
      .map((each) =>
        each.id === tiles.open
          ? { ...each, visibility: { mode: "members", userIds: [worker.id] } }
          : each,
      ),
  });

  expect(await acknowledgedBy(tiles.open)).toEqual([worker.id]);
});

it("people who need to acknowledge a tile can acknowledge it and take it back", async () => {
  const before = await worker.caller.getJob({ jobId });
  expect(before.acknowledgments[tiles.open]).toEqual({
    needed: true,
    acknowledged: false,
    summary: null,
  });

  expect(
    await worker.caller.setTileAcknowledgment({
      tileId: tiles.open,
      acknowledged: true,
    }),
  ).toEqual({ acknowledged: true });
  // Acknowledging twice is harmless.
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  expect(
    (await worker.caller.getJob({ jobId })).acknowledgments[tiles.open],
  ).toEqual({ needed: true, acknowledged: true, summary: null });

  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: false,
  });
  expect(await acknowledgedBy(tiles.open)).toEqual([]);
});

it("getJob only covers tiles that need acknowledging and the viewer can see", async () => {
  const { acknowledgments } = await colleague.caller.getJob({ jobId });
  expect(Object.keys(acknowledgments)).toEqual([tiles.open]);
});

it("getJob tells owners and admins how many of each tile's audience have acknowledged", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  await admin.caller.setTileAcknowledgment({
    tileId: tiles.limited,
    acknowledged: true,
  });

  // The owner isn't on the job, so isn't asked to acknowledge anything.
  expect((await owner.caller.getJob({ jobId })).acknowledgments).toEqual({
    [tiles.open]: {
      needed: false,
      acknowledged: false,
      summary: { acknowledged: 1, total: 3 },
    },
    [tiles.limited]: {
      needed: false,
      acknowledged: false,
      summary: { acknowledged: 1, total: 2 },
    },
  });
  // The admin is on the job and sees every tile, so is asked about both.
  expect(
    (await admin.caller.getJob({ jobId })).acknowledgments[tiles.limited],
  ).toEqual({
    needed: true,
    acknowledged: true,
    summary: { acknowledged: 1, total: 2 },
  });
});

it("someone taken off a tile's list stops counting, and counts again when put back", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.limited,
    acknowledged: true,
  });
  const summary = async () =>
    (await owner.caller.getJob({ jobId })).acknowledgments[tiles.limited]
      ?.summary;

  await db.jobTile.update({
    where: { id: tiles.limited },
    data: { visibility: { mode: "members", userIds: [colleague.id] } },
  });
  expect(await summary()).toEqual({ acknowledged: 0, total: 2 });

  await db.jobTile.update({
    where: { id: tiles.limited },
    data: { visibility: { mode: "members", userIds: [worker.id] } },
  });
  expect(await summary()).toEqual({ acknowledged: 1, total: 2 });
});

it("someone taken off the job stops counting and can't acknowledge", async () => {
  await colleague.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  await db.jobMember.update({
    where: { jobId_userId: { jobId, userId: colleague.id } },
    data: { removedAt: new Date() },
  });

  expect(
    (await owner.caller.getJob({ jobId })).acknowledgments[tiles.open]?.summary,
  ).toEqual({ acknowledged: 0, total: 2 });
  await expect(
    colleague.caller.setTileAcknowledgment({
      tileId: tiles.open,
      acknowledged: true,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("setTileAcknowledgment hides tiles the person can't see", async () => {
  for (const [person, tileId] of [
    [colleague, tiles.limited],
    [outsider, tiles.open],
    [worker, "cmissing00000000000000001"],
  ] as const)
    await expect(
      person.caller.setTileAcknowledgment({ tileId, acknowledged: true }),
      // The same message every time, so it can't tell a real tile from none.
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Tile not found." });
  expect(await db.jobTileAcknowledgment.count()).toBe(0);
});

it("setTileAcknowledgment rejects tiles the person isn't asked to acknowledge", async () => {
  // The owner can see the job but isn't on it; "plain" asks nobody.
  for (const [person, tileId] of [
    [owner, tiles.open],
    [worker, tiles.plain],
  ] as const)
    await expect(
      person.caller.setTileAcknowledgment({ tileId, acknowledged: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.jobTileAcknowledgment.count()).toBe(0);
});

it("setTileAcknowledgment rejects an unauthenticated request and invalid input", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.setTileAcknowledgment({ tileId: tiles.open, acknowledged: true }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    worker.caller.setTileAcknowledgment({
      tileId: "x".repeat(65),
      acknowledged: true,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("getTileAcknowledgments lists who has and hasn't acknowledged, for owners and admins", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });

  const list = await owner.caller.getTileAcknowledgments({
    tileId: tiles.open,
  });
  expect(list).toEqual([
    {
      user: { id: admin.id, name: admin.name, image: null },
      acknowledgedAt: null,
    },
    {
      user: { id: worker.id, name: worker.name, image: null },
      acknowledgedAt: expect.any(Date) as Date,
    },
    {
      user: { id: colleague.id, name: colleague.name, image: null },
      acknowledgedAt: null,
    },
  ]);
  expect(
    (await admin.caller.getTileAcknowledgments({ tileId: tiles.limited })).map(
      ({ user }) => user.id,
    ),
  ).toEqual([admin.id, worker.id]);
});

it("getTileAcknowledgments is only for owners and admins", async () => {
  await expect(
    worker.caller.getTileAcknowledgments({ tileId: tiles.open }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    outsider.caller.getTileAcknowledgments({ tileId: tiles.open }),
  ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Tile not found." });
  await expect(
    owner.caller.getTileAcknowledgments({ tileId: tiles.plain }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    owner.caller.getTileAcknowledgments({
      tileId: "cmissing00000000000000001",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("getTileAcknowledgments rejects an unauthenticated request and invalid input", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.getTileAcknowledgments({ tileId: tiles.open }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    owner.caller.getTileAcknowledgments({ tileId: "" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("members on a limited tile get no counts either", async () => {
  const { acknowledgments } = await worker.caller.getJob({ jobId });
  expect(acknowledgments[tiles.limited]).toEqual({
    needed: true,
    acknowledged: false,
    summary: null,
  });
});

it("someone who left the company isn't asked, even if still on the job", async () => {
  await db.companyMember.delete({
    where: { userId_companyId: { userId: colleague.id, companyId } },
  });
  expect(
    (await owner.caller.getJob({ jobId })).acknowledgments[tiles.open]?.summary,
  ).toEqual({ acknowledged: 0, total: 2 });
});

it("saving a job without changing a tile keeps its acknowledgments", async () => {
  await worker.caller.setTileAcknowledgment({
    tileId: tiles.open,
    acknowledged: true,
  });
  await owner.caller.updateJob({
    jobId,
    title: "Roof repairs",
    description: "",
    memberIds: [admin.id, worker.id, colleague.id],
    tiles: await savedTiles(),
  });
  expect(await acknowledgedBy(tiles.open)).toEqual([worker.id]);
});
