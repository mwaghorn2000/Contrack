import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { jobRouter } from "./job";
import type { PrismaClient } from "../../../../generated/prisma";

// Only prevent application services from loading. Queries use real PostgreSQL.
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

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

it("getJob returns the stored job to a company member", async () => {
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.getJob({ jobId: job.id })).toEqual(job);
});

it("getJob allows ADMIN members", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.getJob({ jobId: job.id })).toEqual(job);
});

it("getJob allows MEMBER members", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.getJob({ jobId: job.id })).toEqual(job);
});

it("getJob allows CONTRACTOR members", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.getJob({ jobId: job.id })).toEqual(job);
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

it("listCompanyJobs lists only the requested company jobs", async () => {
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  const other = await db.company.create({
    data: { name: "Other", members: { create: { userId, role: "OWNER" } } },
  });
  await db.job.create({
    data: { companyId: other.id, createdById: userId, title: "Other job" },
  });
  expect(await caller.listCompanyJobs({ companyId })).toEqual([job]);
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

it("listCompanyJobs returns an empty list for a missing company", async () => {
  expect(await caller.listCompanyJobs({ companyId: missingId })).toEqual([]);
});

it("listCompanyJobs allows MEMBER members", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.listCompanyJobs({ companyId })).toEqual([job]);
});

it("listCompanyJobs allows CONTRACTOR members", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  const job = await db.job.create({
    data: { companyId, createdById: userId, title: "Inspection" },
  });
  expect(await caller.listCompanyJobs({ companyId })).toEqual([job]);
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
