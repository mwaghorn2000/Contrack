import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import {
  deleteObject,
  deletePrefix,
  getObjectInfo,
  storageConfigured,
} from "~/server/storage";
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
  UPLOAD_CACHE_CONTROL: "public, max-age=31536000, immutable",
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
let caller: ReturnType<typeof jobRouter.createCaller>;
let userId: string;
let companyId: string;
const missingId = "cmissing00000000000000001";

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  vi.mocked(getObjectInfo).mockReset();
  vi.mocked(getObjectInfo).mockResolvedValue({
    size: 1024,
    contentType: "image/png",
  });
  vi.mocked(deleteObject).mockReset();
  vi.mocked(deletePrefix).mockReset();
  vi.mocked(storageConfigured).mockReturnValue(true);
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
      requiresAcknowledgment: false,
    })),
    acknowledgments: {},
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
      memberCount: 0,
    },
    {
      id: second.id,
      title: "Fit-out",
      description: null,
      photoUrl: null,
      memberCount: 0,
    },
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

it("listCompanyJobs counts only the people still on each job", async () => {
  const [stays, leaves] = await Promise.all([
    personWithRole("MEMBER"),
    personWithRole("CONTRACTOR"),
  ]);
  await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      members: {
        create: [
          { userId: stays.id },
          { userId: leaves.id, removedAt: new Date() },
        ],
      },
    },
  });
  const [job] = await caller.listCompanyJobs({ companyId });
  expect(job?.memberCount).toBe(1);
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
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "J",
  });
});

it("createJob accepts a 99-character title", async () => {
  const job = await caller.createJob({ companyId, title: "J".repeat(99) });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "J".repeat(99),
  });
});

it("createJob accepts a 500-character description", async () => {
  const job = await caller.createJob({
    companyId,
    title: "Job",
    description: "D".repeat(500),
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    description: "D".repeat(500),
  });
});

it("createJob accepts a empty description", async () => {
  const job = await caller.createJob({
    companyId,
    title: "Job",
    description: "",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    description: "",
  });
});

it("createJob accepts an omitted description", async () => {
  const job = await caller.createJob({ companyId, title: "Job" });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    description: null,
  });
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

/** A Text tile as the builder sends it, with a client-made id. */
function draftTile(
  id: string,
  body: string,
  visibility: { mode: "everyone" } | { mode: "members"; userIds: string[] } = {
    mode: "everyone",
  },
) {
  return { id, type: "text" as const, visibility, config: { body } };
}

/** The job's stored tiles, in order, without their ids. */
async function storedTiles(jobId: string) {
  return db.jobTile.findMany({
    where: { jobId },
    orderBy: { position: "asc" },
    select: { position: true, config: true, visibility: true },
  });
}

/** The job's member rows, as userId → whether they are still on it. */
async function storedMembers(jobId: string) {
  const rows = await db.jobMember.findMany({ where: { jobId } });
  return Object.fromEntries(
    rows.map((row) => [row.userId, row.removedAt === null]),
  );
}

it("createJob saves members and tiles in order, with new tile ids", async () => {
  const worker = await personWithRole("CONTRACTOR");
  const { id } = await caller.createJob({
    companyId,
    title: "Inspection",
    memberIds: [worker.id],
    tiles: [
      draftTile("client-1", "First"),
      draftTile("client-2", "Second", {
        mode: "members",
        userIds: [worker.id, userId],
      }),
    ],
  });
  expect(await storedMembers(id)).toEqual({ [worker.id]: true });
  // Visibility keeps only people on the job; the owner isn't on it.
  expect(await storedTiles(id)).toEqual([
    {
      position: 0,
      config: { body: "First" },
      visibility: { mode: "everyone" },
    },
    {
      position: 1,
      config: { body: "Second" },
      visibility: { mode: "members", userIds: [worker.id] },
    },
  ]);
  const ids = (await db.jobTile.findMany({ select: { id: true } })).map(
    (tile) => tile.id,
  );
  expect(ids).not.toContain("client-1");
  expect(ids).not.toContain("client-2");
});

it("createJob rejects members from outside the company without saving", async () => {
  const outsider = await db.user.create({
    data: { name: "Outsider", email: "outsider@example.com" },
  });
  await expect(
    caller.createJob({ companyId, title: "Job", memberIds: [outsider.id] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects invalid tiles", async () => {
  for (const tile of [
    { ...draftTile("t", "x"), type: "audit" },
    draftTile("t", "x".repeat(5001)),
  ])
    await expect(
      caller.createJob({
        companyId,
        title: "Job",
        tiles: [tile as ReturnType<typeof draftTile>],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

/** Creates a job with two members and two tiles, returning their ids. */
async function seededJob() {
  const first = await personWithRole("MEMBER");
  const second = await personWithRole("MEMBER");
  const { id } = await caller.createJob({
    companyId,
    title: "Inspection",
    memberIds: [first.id, second.id],
    tiles: [draftTile("a", "Keep"), draftTile("b", "Drop")],
  });
  const [kept, dropped] = await db.jobTile.findMany({
    where: { jobId: id },
    orderBy: { position: "asc" },
  });
  return { id, first, second, keptId: kept!.id, droppedId: dropped!.id };
}

it("updateJob saves details and keeps, adds, reorders and removes tiles", async () => {
  const job = await seededJob();
  await caller.updateJob({
    jobId: job.id,
    title: " Re-inspection ",
    description: " South side ",
    memberIds: [job.first.id, job.second.id],
    tiles: [draftTile("new", "Added"), draftTile(job.keptId, "Kept, edited")],
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "Re-inspection",
    description: "South side",
  });
  const tiles = await db.jobTile.findMany({
    where: { jobId: job.id },
    orderBy: { position: "asc" },
  });
  expect(tiles.map((tile) => tile.config)).toEqual([
    { body: "Added" },
    { body: "Kept, edited" },
  ]);
  expect(tiles[1]?.id).toBe(job.keptId);
  expect(tiles[0]?.id).not.toBe("new");
  expect(
    await db.jobTile.findUnique({ where: { id: job.droppedId } }),
  ).toBeNull();
});

it("updateJob takes people off the job and can add them back", async () => {
  const job = await seededJob();
  const save = (memberIds: string[]) =>
    caller.updateJob({
      jobId: job.id,
      title: "Inspection",
      memberIds,
      tiles: [],
    });
  await save([job.first.id]);
  expect(await storedMembers(job.id)).toEqual({
    [job.first.id]: true,
    [job.second.id]: false,
  });
  await save([job.second.id]);
  expect(await storedMembers(job.id)).toEqual({
    [job.first.id]: false,
    [job.second.id]: true,
  });
});

it("updateJob won't take over another job's tile", async () => {
  const job = await seededJob();
  const other = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Other",
      tiles: {
        create: {
          type: "text",
          position: 0,
          config: { body: "Theirs" },
          visibility: { mode: "everyone" },
        },
      },
    },
    include: { tiles: true },
  });
  const theirs = other.tiles[0]!.id;
  await caller.updateJob({
    jobId: job.id,
    title: "Inspection",
    memberIds: [],
    tiles: [draftTile(theirs, "Mine now?")],
  });
  expect(await db.jobTile.findUnique({ where: { id: theirs } })).toMatchObject({
    jobId: other.id,
    config: { body: "Theirs" },
  });
  expect(await storedTiles(job.id)).toEqual([
    {
      position: 0,
      config: { body: "Mine now?" },
      visibility: { mode: "everyone" },
    },
  ]);
});

it("updateJob lets admins save", async () => {
  const job = await seededJob();
  const admin = await personWithRole("ADMIN");
  await admin.caller.updateJob({
    jobId: job.id,
    title: "By admin",
    memberIds: [],
    tiles: [],
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "By admin",
  });
});

it("updateJob stops members on the job and hides it from others", async () => {
  const job = await seededJob();
  const update = { jobId: job.id, title: "Changed", memberIds: [], tiles: [] };
  await expect(job.first.caller.updateJob(update)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const bystander = await personWithRole("MEMBER");
  await expect(bystander.caller.updateJob(update)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "Inspection",
  });
});

it("updateJob rejects members from outside the company without saving", async () => {
  const job = await seededJob();
  const outsider = await db.user.create({
    data: { name: "Outsider", email: "outsider@example.com" },
  });
  await expect(
    caller.updateJob({
      jobId: job.id,
      title: "Changed",
      memberIds: [outsider.id],
      tiles: [],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    title: "Inspection",
  });
  expect(await db.jobTile.count({ where: { jobId: job.id } })).toBe(2);
});

it("updateJob rejects unauthenticated requests and invalid input", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  const update = { jobId: missingId, title: "Job", memberIds: [], tiles: [] };
  await expect(anonymous.updateJob(update)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  for (const bad of [
    { ...update, jobId: "invalid" },
    { ...update, title: "  " },
  ])
    await expect(caller.updateJob(bad)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  await expect(caller.updateJob(update)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("createJob returns only the new job's id", async () => {
  const job = await caller.createJob({ companyId, title: "Inspection" });
  expect(Object.keys(job)).toEqual(["id"]);
});

it("updateJob needs members and tiles, so a partial save can't wipe them", async () => {
  const job = await seededJob();
  await expect(
    caller.updateJob({ jobId: job.id, title: "Changed" } as Parameters<
      typeof caller.updateJob
    >[0]),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.jobTile.count({ where: { jobId: job.id } })).toBe(2);
  expect(Object.values(await storedMembers(job.id))).toEqual([true, true]);
});

it("saving repeated tile and member ids keeps every tile and one row each", async () => {
  const job = await seededJob();
  await caller.updateJob({
    jobId: job.id,
    title: "Inspection",
    memberIds: [job.first.id, job.first.id],
    tiles: [draftTile(job.keptId, "One"), draftTile(job.keptId, "Two")],
  });
  expect((await storedTiles(job.id)).map((tile) => tile.config)).toEqual([
    { body: "One" },
    { body: "Two" },
  ]);
  expect(await storedMembers(job.id)).toEqual({
    [job.first.id]: true,
    [job.second.id]: false,
  });
});

/** Requests a PNG photo upload for a job and returns its key. */
async function uploadedPhoto(jobId: string, as = caller) {
  const upload = await as.createPhotoUpload({
    jobId,
    contentType: "image/png",
    size: 1024,
  });
  return upload.key;
}

/** Creates an empty job and returns its id. */
async function emptyJob() {
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  return job.id;
}

it("createPhotoUpload returns a signed upload in the job's photo folder", async () => {
  const jobId = await emptyJob();
  const upload = await caller.createPhotoUpload({
    jobId,
    contentType: "image/png",
    size: 1024,
  });
  expect(upload.key).toMatch(
    new RegExp(`^jobs/${jobId}/photo/[0-9a-f-]{36}\\.png$`),
  );
  expect(upload.uploadUrl).toBe(`https://upload.example.com/${upload.key}`);
});

it("createPhotoUpload allows photos up to 10 MB of an image type", async () => {
  const jobId = await emptyJob();
  const request = (contentType: string, size: number) =>
    caller.createPhotoUpload({
      jobId,
      contentType: contentType as "image/png",
      size,
    });
  await expect(request("image/jpeg", 10 * 1024 * 1024)).resolves.toHaveProperty(
    "key",
  );
  await expect(
    request("image/jpeg", 10 * 1024 * 1024 + 1),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(request("image/svg+xml", 1024)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

it("setPhoto saves the photo, shows it signed and deletes the one it replaced", async () => {
  const jobId = await emptyJob();
  const first = await uploadedPhoto(jobId);
  expect(await caller.setPhoto({ jobId, key: first })).toEqual({
    photoUrl: `signed:${first}`,
  });
  const second = await uploadedPhoto(jobId);
  await caller.setPhoto({ jobId, key: second });
  expect((await caller.getJob({ jobId })).photoUrl).toBe(`signed:${second}`);
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(first);
});

it("setPhoto removes the photo and deletes it", async () => {
  const jobId = await emptyJob();
  const key = await uploadedPhoto(jobId);
  await caller.setPhoto({ jobId, key });
  expect(await caller.setPhoto({ jobId, key: null })).toEqual({
    photoUrl: null,
  });
  expect(await db.job.findUnique({ where: { id: jobId } })).toMatchObject({
    photo: null,
  });
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key);
});

it("setPhoto rejects a photo uploaded for another job", async () => {
  const jobId = await emptyJob();
  const otherKey = await uploadedPhoto(await emptyJob());
  await expect(caller.setPhoto({ jobId, key: otherKey })).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  expect(await db.job.findUnique({ where: { id: jobId } })).toMatchObject({
    photo: null,
  });
});

it("setPhoto rejects an upload requested by another admin, and reuse", async () => {
  const jobId = await emptyJob();
  const admin = await personWithRole("ADMIN");
  const theirs = await uploadedPhoto(jobId, admin.caller);
  await expect(caller.setPhoto({ jobId, key: theirs })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const mine = await uploadedPhoto(jobId);
  await caller.setPhoto({ jobId, key: mine });
  await expect(caller.setPhoto({ jobId, key: mine })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("job photos can be changed by admins but not by members", async () => {
  const jobId = await emptyJob();
  const admin = await personWithRole("ADMIN");
  const key = await uploadedPhoto(jobId, admin.caller);
  await admin.caller.setPhoto({ jobId, key });

  const onJob = await personWithRole("MEMBER");
  await db.jobMember.create({ data: { jobId, userId: onJob.id } });
  const bystander = await personWithRole("CONTRACTOR");
  for (const [person, code] of [
    [onJob, "FORBIDDEN"],
    [bystander, "NOT_FOUND"],
  ] as const) {
    await expect(uploadedPhoto(jobId, person.caller)).rejects.toMatchObject({
      code,
    });
    await expect(
      person.caller.setPhoto({ jobId, key: null }),
    ).rejects.toMatchObject({ code });
  }
  expect(await db.job.findUnique({ where: { id: jobId } })).toMatchObject({
    photo: key,
  });
});

it("job photo uploads reject unauthenticated requests and invalid input", async () => {
  const anonymous = jobRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  const jobId = await emptyJob();
  await expect(uploadedPhoto(jobId, anonymous)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(anonymous.setPhoto({ jobId, key: null })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(uploadedPhoto("invalid")).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    caller.setPhoto({ jobId, key: "users/elsewhere.png" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteJob deletes the job's files, and still succeeds when that fails", async () => {
  const jobId = await emptyJob();
  await caller.deleteJob({ jobId });
  expect(deletePrefix).toHaveBeenCalledExactlyOnceWith(`jobs/${jobId}/`);

  const otherId = await emptyJob();
  vi.mocked(deletePrefix).mockRejectedValueOnce(new Error("offline"));
  vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
  await expect(caller.deleteJob({ jobId: otherId })).resolves.toEqual({
    success: true,
  });
  expect(await db.job.count()).toBe(0);
});

it("setPhoto reports a job deleted mid-save as not found", async () => {
  const jobId = await emptyJob();
  const key = await uploadedPhoto(jobId);
  vi.mocked(getObjectInfo).mockImplementationOnce(async () => {
    await db.job.delete({ where: { id: jobId } });
    return { size: 1024, contentType: "image/png" };
  });
  await expect(caller.setPhoto({ jobId, key })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("jobs work without photo storage set up", async () => {
  const jobId = await emptyJob();
  await db.job.update({
    where: { id: jobId },
    data: { photo: `jobs/${jobId}/photo/a.png` },
  });
  vi.mocked(storageConfigured).mockReturnValue(false);
  expect((await caller.getJob({ jobId })).photoUrl).toBeNull();
  expect(await caller.setPhoto({ jobId, key: null })).toEqual({
    photoUrl: null,
  });
  await caller.deleteJob({ jobId });
  expect(deleteObject).not.toHaveBeenCalled();
  expect(deletePrefix).not.toHaveBeenCalled();
});

it("getJob skips saved tiles that no longer fit their type", async () => {
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      tiles: {
        create: [
          textTile(0, "Kept"),
          // A tile type since removed, and a config from an older schema.
          { ...textTile(1, "Gone"), type: "retired" },
          { ...textTile(2, "Old"), config: { text: "Old" } },
        ],
      },
    },
  });

  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  const { tiles } = await caller.getJob({ jobId: job.id });
  expect(tiles.map((tile) => tile.config)).toEqual([{ body: "Kept" }]);
  // Logged, so a broken tile change doesn't go unnoticed.
  const skipped = consoleError.mock.calls.filter(([message]) =>
    String(message).startsWith("Skipped job tile"),
  );
  expect(skipped).toHaveLength(2);
  consoleError.mockRestore();
});

it("createJob rejects a tile id over 64 characters", async () => {
  await expect(
    caller.createJob({
      companyId,
      title: "Inspection",
      tiles: [draftTile("x".repeat(65), "Body")],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("createJob rejects a tile shared with more than 200 people", async () => {
  const userIds = Array.from({ length: 201 }, (_, i) => `user-${i}`);
  await expect(
    caller.createJob({
      companyId,
      title: "Inspection",
      tiles: [draftTile("tile-1", "Body", { mode: "members", userIds })],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.job.count()).toBe(0);
});

it("updateJob keeps saved tiles it can't read", async () => {
  const job = await db.job.create({
    data: {
      companyId,
      createdById: userId,
      title: "Inspection",
      tiles: {
        create: [
          textTile(0, "Shown"),
          { ...textTile(1, "Gone"), type: "retired" },
          { ...textTile(2, "Old"), config: { text: "Old" } },
        ],
      },
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { tiles } = await caller.getJob({ jobId: job.id });

  // Only renaming: the builder sends back the one tile it was shown.
  await caller.updateJob({
    jobId: job.id,
    title: "Renamed",
    description: "",
    memberIds: [],
    tiles,
  });

  const rows = await db.jobTile.findMany({
    where: { jobId: job.id },
    select: { type: true, config: true },
  });
  expect(rows).toEqual(
    expect.arrayContaining([
      { type: "text", config: { body: "Shown" } },
      { type: "retired", config: { body: "Gone" } },
      { type: "text", config: { text: "Old" } },
    ]),
  );
  expect(rows).toHaveLength(3);
  vi.mocked(console.error).mockRestore();
});
