import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { requireJobAccess, visibleJobsWhere } from "./job-access";
import type { CompanyRole, PrismaClient } from "../../generated/prisma";

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let companyId: string;
let ownerId: string;
let jobId: string;
const missingId = "cmissing00000000000000001";

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  await clearTestDatabase(db);
  const owner = await db.user.create({
    data: { name: "Owner", email: "owner@example.com" },
  });
  ownerId = owner.id;
  const company = await db.company.create({
    data: {
      name: "Builders",
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
  companyId = company.id;
  const job = await db.job.create({
    data: { companyId, createdById: ownerId, title: "Inspection" },
  });
  jobId = job.id;
});

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

/** Adds someone to the company with a role, and to the job when `onJob`. */
async function addPerson(role: CompanyRole, onJob: boolean) {
  const user = await db.user.create({
    data: { name: role, email: `${role.toLowerCase()}@example.com` },
  });
  await db.companyMember.create({
    data: { userId: user.id, companyId, role },
  });
  if (onJob) await db.jobMember.create({ data: { jobId, userId: user.id } });
  return user.id;
}

it("lets owners and admins see a job they aren't on", async () => {
  const adminId = await addPerson("ADMIN", false);
  for (const userId of [ownerId, adminId])
    expect(await requireJobAccess(db, userId, jobId)).toEqual({
      job: { id: jobId, companyId },
      isManager: true,
    });
});

it("lets members and contractors see a job they are on", async () => {
  for (const role of ["MEMBER", "CONTRACTOR"] as const) {
    const userId = await addPerson(role, true);
    expect(await requireJobAccess(db, userId, jobId)).toEqual({
      job: { id: jobId, companyId },
      isManager: false,
    });
  }
});

it("hides a job from a company member who isn't on it", async () => {
  const userId = await addPerson("MEMBER", false);
  await expect(requireJobAccess(db, userId, jobId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("hides a job from someone removed from it", async () => {
  const userId = await addPerson("MEMBER", true);
  await db.jobMember.update({
    where: { jobId_userId: { jobId, userId } },
    data: { removedAt: new Date() },
  });
  await expect(requireJobAccess(db, userId, jobId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("hides a job from a job member who has left the company", async () => {
  for (const role of ["MEMBER", "CONTRACTOR"] as const) {
    const userId = await addPerson(role, true);
    await db.companyMember.delete({
      where: { userId_companyId: { userId, companyId } },
    });
    await expect(requireJobAccess(db, userId, jobId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  }
});

it("hides a job from another company's owner", async () => {
  const outsider = await db.user.create({
    data: { name: "Outsider", email: "outsider@example.com" },
  });
  await db.company.create({
    data: {
      name: "Rivals",
      members: { create: { userId: outsider.id, role: "OWNER" } },
    },
  });
  await expect(requireJobAccess(db, outsider.id, jobId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("treats a missing job as not found", async () => {
  await expect(requireJobAccess(db, ownerId, missingId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("lists every job for managers and only current jobs for others", async () => {
  const adminId = await addPerson("ADMIN", false);
  const memberId = await addPerson("MEMBER", true);
  const contractorId = await addPerson("CONTRACTOR", false);
  const other = await db.job.create({
    data: {
      companyId,
      createdById: ownerId,
      title: "Fit-out",
      members: { create: { userId: memberId, removedAt: new Date() } },
    },
  });
  // A job in a company the owner also runs must not leak into this list.
  const rivals = await db.company.create({
    data: {
      name: "Rivals",
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
  await db.job.create({
    data: { companyId: rivals.id, createdById: ownerId, title: "Elsewhere" },
  });
  const listed = async (userId: string) =>
    (
      await db.job.findMany({
        where: visibleJobsWhere(userId, companyId),
        select: { id: true },
        orderBy: { createdAt: "asc" },
      })
    ).map(({ id }) => id);

  expect(await listed(ownerId)).toEqual([jobId, other.id]);
  expect(await listed(adminId)).toEqual([jobId, other.id]);
  expect(await listed(memberId)).toEqual([jobId]);
  expect(await listed(contractorId)).toEqual([]);
});

it("lists no jobs for someone outside the company", async () => {
  const leaverId = await addPerson("MEMBER", true);
  await db.companyMember.delete({
    where: { userId_companyId: { userId: leaverId, companyId } },
  });
  const outsider = await db.user.create({
    data: { name: "Outsider", email: "outsider@example.com" },
  });
  for (const userId of [leaverId, outsider.id])
    expect(
      await db.job.findMany({ where: visibleJobsWhere(userId, companyId) }),
    ).toEqual([]);
});
