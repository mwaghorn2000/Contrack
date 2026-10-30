import { TRPCError } from "@trpc/server";
import type { CompanyRole, Prisma } from "../../generated/prisma";
import { isManagerRole } from "~/lib/company-roles";

/**
 * Returns the job and whether the user manages its company. Company owners and
 * admins can see every job; everyone else must currently be on it. Anyone else
 * gets NOT_FOUND, so a job's existence isn't revealed.
 */
export async function requireJobAccess(
  db: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      company: {
        select: { members: { where: { userId }, select: { role: true } } },
      },
      members: { where: { userId, removedAt: null }, select: { userId: true } },
    },
  });
  const role = job?.company.members[0]?.role;
  // Job membership alone isn't enough: it also needs a company membership.
  if (!job || !role || (!isManagerRole(role) && job.members.length === 0))
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  return {
    job: { id: job.id, companyId: job.companyId },
    isManager: isManagerRole(role),
  };
}

/**
 * Like requireJobAccess, but only for company owners and admins: people on
 * the job can see it, so they get FORBIDDEN rather than NOT_FOUND.
 */
export async function requireJobManager(
  db: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const { job, isManager } = await requireJobAccess(db, userId, jobId);
  if (!isManager)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only owners and admins can change jobs.",
    });
  return job;
}

/**
 * Filters to the company's jobs this user can see. Roles are checked in the
 * query itself, so the filter is safe without any other company check.
 */
export function visibleJobsWhere(
  userId: string,
  companyId: string,
): Prisma.JobWhereInput {
  const managerRoles: CompanyRole[] = ["OWNER", "ADMIN"];
  return {
    companyId,
    company: { members: { some: { userId } } },
    OR: [
      {
        company: { members: { some: { userId, role: { in: managerRoles } } } },
      },
      { members: { some: { userId, removedAt: null } } },
    ],
  };
}
