import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import { tileSchema } from "~/app/_components/jobs/tiles/registry";
import { isManagerRole } from "~/lib/company-roles";
import { canSeeTile } from "~/lib/job-tiles";
import { requireJobAccess } from "~/server/job-access";

type Job = { id: string; companyId: string };

/**
 * The job's current members who are still in its company, in the order they
 * were added, with whether each manages the company.
 */
export async function jobPeople(db: Prisma.TransactionClient, job: Job) {
  const rows = await db.jobMember.findMany({
    where: { jobId: job.id, removedAt: null },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    select: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          companyMemberships: {
            where: { companyId: job.companyId },
            select: { role: true },
          },
        },
      },
    },
  });
  return rows.flatMap(({ user: { companyMemberships, ...user } }) => {
    const role = companyMemberships[0]?.role;
    return role
      ? [{ userId: user.id, user, isManager: isManagerRole(role) }]
      : [];
  });
}

/**
 * Finds a tile the user can see, with its job and whether they manage it.
 * Anything else, including a tile that no longer parses, is NOT_FOUND.
 */
export async function requireVisibleTile(
  db: Prisma.TransactionClient,
  userId: string,
  tileId: string,
) {
  const notFound = new TRPCError({
    code: "NOT_FOUND",
    message: "Tile not found.",
  });
  // Tiles taken off the job are kept for their answers, but hidden.
  const row = await db.jobTile.findUnique({
    where: { id: tileId, removedAt: null },
    select: {
      id: true,
      jobId: true,
      type: true,
      config: true,
      visibility: true,
      requiresAcknowledgment: true,
    },
  });
  if (!row) throw notFound;
  // Rethrown as "Tile not found.", so the message can't confirm a real tile.
  const { job, isManager } = await requireJobAccess(
    db,
    userId,
    row.jobId,
  ).catch(() => {
    throw notFound;
  });
  const parsed = tileSchema.safeParse(row);
  if (!parsed.success || !canSeeTile(parsed.data, { userId, isManager }))
    throw notFound;
  return { tile: parsed.data, job, isManager };
}
