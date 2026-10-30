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
  storageConfigured: () => true,
  signedReadUrl: (key: string) => Promise.resolve(`signed:${key}`),
}));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let caller: ReturnType<typeof jobRouter.createCaller>;
let userId: string;
let companyId: string;
const missingId = "cmissing00000000000000001";

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  await clearTestDatabase(db);
  const user = await db.user.create({
    data: { name: "Test User", email: "owner@example.com" },
  });
  userId = user.id;
  const company = await db.company.create({
    data: {
      name: "Existing Company",
      members: { create: { userId, role: "OWNER" } },
    },
  });
  companyId = company.id;
  caller = jobRouter.createCaller({
    db,
    session: {
      user: { id: userId, name: user.name, email: user.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
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

let people = 0;

/** Adds someone to the company with a role and returns a caller for them. */
async function personWithRole(role: CompanyRole) {
  const user = await db.user.create({
    data: {
      name: role,
      email: `${role.toLowerCase()}-${++people}@example.com`,
    },
  });
  await db.companyMember.create({
    data: { userId: user.id, companyId, role },
  });
  const personCaller = jobRouter.createCaller({
    db,
    session: {
      user: { id: user.id, name: user.name, email: user.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  return { id: user.id, caller: personCaller };
}

/** Text tile row data with the given body and visibility. */
function textTile(
  position: number,
  body: string,
  visibility: Prisma.InputJsonValue = { mode: "everyone" },
) {
  return { type: "text", position, config: { body }, visibility };
}

it("getJob returns a job's details, members and tiles in order", async () => {
  const worker = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      description: "North side",
      photo: "jobs/cjob/photo/a.jpg",
      members: { create: { userId: worker.id } },
      tiles: { create: [textTile(1, "Second"), textTile(0, "First")] },
    },
    include: { tiles: { orderBy: { position: "asc" } } },
  });
  expect(await caller.getJob({ jobId: job.id })).toEqual({
    id: job.id,
    title: "Inspection",
    description: "North side",
    photoUrl: "signed:jobs/cjob/photo/a.jpg",
    memberIds: [worker.id],
    tiles: job.tiles.map(({ id, type, config, visibility }) => ({
      id,
      type,
      config,
      visibility,
    })),
  });
});

it("getJob shows owners and admins every tile on any job", async () => {
  const admin = await personWithRole("ADMIN");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      tiles: {
        create: textTile(0, "Managers only", { mode: "members", userIds: [] }),
      },
    },
  });
  for (const viewer of [caller, admin.caller])
    expect((await viewer.getJob({ jobId: job.id })).tiles).toHaveLength(1);
});

it("getJob sends members only the tiles they can see", async () => {
  const worker = await personWithRole("CONTRACTOR");
  const other = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: { create: [{ userId: worker.id }, { userId: other.id }] },
      tiles: {
        create: [
          textTile(0, "Everyone"),
          textTile(1, "Mine", { mode: "members", userIds: [worker.id] }),
          textTile(2, "Theirs", { mode: "members", userIds: [other.id] }),
        ],
      },
    },
  });
  const { tiles } = await worker.caller.getJob({ jobId: job.id });
  expect(tiles.map((tile) => tile.config)).toEqual([
    { body: "Everyone" },
    { body: "Mine" },
  ]);
  expect(tiles.map((tile) => tile.visibility)).toEqual([
    { mode: "everyone" },
    { mode: "members", userIds: [worker.id] },
  ]);
});

it("getJob doesn't tell members who else can see a tile", async () => {
  const worker = await personWithRole("MEMBER");
  const other = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: { create: [{ userId: worker.id }, { userId: other.id }] },
      tiles: {
        create: textTile(0, "Shared", {
          mode: "members",
          userIds: [worker.id, other.id],
        }),
      },
    },
  });
  const forWorker = await worker.caller.getJob({ jobId: job.id });
  expect(forWorker.tiles[0]?.visibility).toEqual({
    mode: "members",
    userIds: [worker.id],
  });
  const forOwner = await caller.getJob({ jobId: job.id });
  expect(forOwner.tiles[0]?.visibility).toEqual({
    mode: "members",
    userIds: [worker.id, other.id],
  });
});

it("getJob hides a job from someone who left the company", async () => {
  const worker = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: { create: { userId: worker.id } },
    },
  });
  await db.companyMember.delete({
    where: { userId_companyId: { userId: worker.id, companyId } },
  });
  await expect(worker.caller.getJob({ jobId: job.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("getJob forgets tile access for people taken off the job", async () => {
  const worker = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: { create: { userId: worker.id, removedAt: new Date() } },
      tiles: {
        create: textTile(0, "Mine", { mode: "members", userIds: [worker.id] }),
      },
    },
  });
  const fetched = await caller.getJob({ jobId: job.id });
  expect(fetched.memberIds).toEqual([]);
  expect(fetched.tiles[0]?.visibility).toEqual({
    mode: "members",
    userIds: [],
  });
});

it("getJob has no photo link without a photo", async () => {
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect((await caller.getJob({ jobId: job.id })).photoUrl).toBeNull();
});

it("getJob hides a job from company members who aren't on it", async () => {
  const worker = await personWithRole("MEMBER");
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  await expect(worker.caller.getJob({ jobId: job.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("getJob rejects an existing job from another company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const job = await db.job.create({
    data: { companyId: other.id, createdById: userId, title: "Private job" },
  });
  await expect(caller.getJob({ jobId: job.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("getJob rejects a missing job", async () => {
  await expect(caller.getJob({ jobId: missingId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("getJob rejects an unauthenticated request and an invalid ID", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.getJob({ jobId: missingId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(caller.getJob({ jobId: "invalid" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

it("listCompanyJobs lists the company's jobs, oldest first, with photos", async () => {
  const first = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      description: "North side",
      photo: "jobs/cjob/photo/a.jpg",
    },
  });
  const second = await db.job.create({
    data: { companyId, createdById: userId, title: "Fit-out" },
  });
  const other = await db.company.create({
    data: { name: "Other", members: { create: { userId, role: "OWNER" } } },
  });
  await db.job.create({
    data: { companyId: other.id, createdById: userId, title: "Other job" },
  });
  expect(await caller.listCompanyJobs({ companyId })).toEqual([
    {
      id: first.id,
      title: "Inspection",
      description: "North side",
      photoUrl: "signed:jobs/cjob/photo/a.jpg",
    },
    { id: second.id, title: "Fit-out", description: null, photoUrl: null },
  ]);
});

it("listCompanyJobs shows members and contractors only their current jobs", async () => {
  for (const role of ["MEMBER", "CONTRACTOR"] as const) {
    const worker = await personWithRole(role);
    const mine = await db.job.create({
      data: {
        companyId,
        createdById: userId,
        title: `${role} job`,
        members: { create: { userId: worker.id } },
      },
    });
    await db.job.create({
      data: {
        companyId,
        createdById: userId,
        title: "Left",
        members: { create: { userId: worker.id, removedAt: new Date() } },
      },
    });
    const listed = await worker.caller.listCompanyJobs({ companyId });
    expect(listed.map((job) => job.id)).toEqual([mine.id]);
  }
});

it("listCompanyJobs returns an empty list when there are no jobs", async () => {
  expect(await caller.listCompanyJobs({ companyId })).toEqual([]);
});

it("listCompanyJobs returns an empty list for an inaccessible company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  await db.job.create({
    data: { companyId: other.id, createdById: userId, title: "Secret" },
  });
  expect(await caller.listCompanyJobs({ companyId: other.id })).toEqual([]);
});

it("listCompanyJobs returns an empty list for someone outside the company", async () => {
  await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  const outsider = await db.user.create({
    data: { name: "Outsider", email: "outsider@example.com" },
  });
  const outsiderCaller = jobRouter.createCaller({
    db,
    session: {
      user: { id: outsider.id, name: outsider.name, email: outsider.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  expect(await outsiderCaller.listCompanyJobs({ companyId })).toEqual([]);
});

it("listCompanyJobs returns an empty list for a missing company", async () => {
  expect(await caller.listCompanyJobs({ companyId: missingId })).toEqual([]);
});

it("listCompanyJobs rejects an unauthenticated request and an invalid ID", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.listCompanyJobs({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(
    caller.listCompanyJobs({ companyId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createJob allows OWNER and saves trimmed fields and creator", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "OWNER" },
  });
  const job = await caller.createJob({
    companyId,
    title: " Inspection ",
    description: " Details ",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "Inspection",
    description: "Details",
    companyId,
    createdById: userId,
  });
});

it("createJob allows ADMIN and saves trimmed fields and creator", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  const job = await caller.createJob({
    companyId,
    title: " Inspection ",
    description: " Details ",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "Inspection",
    description: "Details",
    companyId,
    createdById: userId,
  });
});

it("createJob rejects MEMBER without inserting a job", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  await expect(
    caller.createJob({ companyId, title: "Job" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects CONTRACTOR without inserting a job", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  await expect(
    caller.createJob({ companyId, title: "Job" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects a missing company", async () => {
  const targetId = missingId;
  await expect(
    caller.createJob({ companyId: targetId, title: "Job" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects a inaccessible company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const targetId = other.id;
  await expect(
    caller.createJob({ companyId: targetId, title: "Job" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.job.count()).toBe(0);
});

it("createJob accepts a one-character title", async () => {
  const job = await caller.createJob({ companyId, title: "J" });
  expect(await db.job.findUnique({ where: { id: job.id } })).toEqual(job);
});

it("createJob accepts a 99-character title", async () => {
  const job = await caller.createJob({ companyId, title: "J".repeat(99) });
  expect(await db.job.findUnique({ where: { id: job.id } })).toEqual(job);
});

it("createJob accepts a 500-character description", async () => {
  const job = await caller.createJob({
    companyId,
    title: "Job",
    description: "D".repeat(500),
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toEqual(job);
});

it("createJob accepts a empty description", async () => {
  const job = await caller.createJob({
    companyId,
    title: "Job",
    description: "",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toEqual(job);
});

it("createJob accepts an omitted description", async () => {
  const job = await caller.createJob({ companyId, title: "Job" });
  expect(job.description).toBeNull();
});

it("createJob rejects a empty title", async () => {
  await expect(
    caller.createJob({ companyId, title: "" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects a whitespace-only title", async () => {
  await expect(
    caller.createJob({ companyId, title: " " }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects a 100-character title", async () => {
  await expect(
    caller.createJob({ companyId, title: "J".repeat(100) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects a 501-character description", async () => {
  await expect(
    caller.createJob({ companyId, title: "Job", description: "D".repeat(501) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("deleteJob allows OWNER", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "OWNER" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.deleteJob({ jobId: job.id })).toEqual({ success: true });
  expect(await db.job.findUnique({ where: { id: job.id } })).toBeNull();
});

it("deleteJob allows ADMIN", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.deleteJob({ jobId: job.id })).toEqual({ success: true });
  expect(await db.job.findUnique({ where: { id: job.id } })).toBeNull();
});

it("deleteJob rejects MEMBER", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  await expect(caller.deleteJob({ jobId: job.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).not.toBeNull();
});

it("deleteJob rejects CONTRACTOR", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  await expect(caller.deleteJob({ jobId: job.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).not.toBeNull();
});

it("deleteJob rejects a missing job", async () => {
  await expect(caller.deleteJob({ jobId: missingId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("deleteJob rejects a job in a company the user does not belong to", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const job = await db.job.create({
    data: { companyId: other.id, createdById: userId, title: "Private job" },
  });
  await expect(caller.deleteJob({ jobId: job.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).not.toBeNull();
});

it("getJob rejects an unauthenticated request", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.getJob({ jobId: missingId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});

it("getJob rejects an invalid ID", async () => {
  await expect(caller.getJob({ jobId: "invalid" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

it("listCompanyJobs rejects an unauthenticated request", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.listCompanyJobs({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});

it("listCompanyJobs rejects an invalid ID", async () => {
  await expect(
    caller.listCompanyJobs({ companyId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createJob rejects an unauthenticated request", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.createJob({ companyId, title: "Job" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("createJob rejects an invalid ID", async () => {
  await expect(
    caller.createJob({ companyId: "invalid", title: "Job" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteJob rejects an unauthenticated request", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.deleteJob({ jobId: missingId })).rejects.toMatchObject(
    { code: "UNAUTHORIZED" },
  );
});

it("deleteJob rejects an invalid ID", async () => {
  await expect(caller.deleteJob({ jobId: "invalid" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

it("createJob rejects a stale session after its user is deleted", async () => {
  await db.user.delete({ where: { id: userId } });
  await expect(
    caller.createJob({ companyId, title: "Job" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db.job.count()).toBe(0);
});

it("deleting a job deletes its members and tiles", async () => {
  const worker = await db.user.create({
    data: { name: "Worker", email: "worker@example.com" },
  });
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: { create: { userId: worker.id } },
      tiles: {
        create: {
          type: "text",
          position: 0,
          config: { body: "Wear a harness." },
          visibility: { mode: "members", userIds: [worker.id] },
        },
      },
    },
    select: { id: true, photo: true, members: true, tiles: true },
  });
  expect(job.photo).toBeNull();
  expect(job.members).toEqual([
    expect.objectContaining({ userId: worker.id, removedAt: null }),
  ]);
  expect(job.tiles[0]).toMatchObject({
    config: { body: "Wear a harness." },
    visibility: { mode: "members", userIds: [worker.id] },
  });

  const other = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Fit-out",
      members: { create: { userId: worker.id } },
      tiles: {
        create: {
          type: "text",
          position: 0,
          config: { body: "Bring a level." },
          visibility: { mode: "everyone" },
        },
      },
    },
  });

  await db.job.delete({ where: { id: job.id } });
  expect(await db.jobMember.findMany({ select: { jobId: true } })).toEqual([
    { jobId: other.id },
  ]);
  expect(await db.jobTile.findMany({ select: { jobId: true } })).toEqual([
    { jobId: other.id },
  ]);
});

it("someone can be on a job only once", async () => {
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  await db.jobMember.create({ data: { jobId: job.id, userId } });
  await expect(
    db.jobMember.create({ data: { jobId: job.id, userId } }),
  ).rejects.toMatchObject({ code: "P2002" });
});

it("deleting a user removes them from their jobs", async () => {
  const worker = await db.user.create({
    data: { name: "Worker", email: "worker@example.com" },
  });
  await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: { create: { userId: worker.id } },
    },
  });
  await db.user.delete({ where: { id: worker.id } });
  expect(await db.jobMember.count()).toBe(0);
  expect(await db.job.count()).toBe(1);
});
