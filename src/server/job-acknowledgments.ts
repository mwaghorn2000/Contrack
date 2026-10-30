import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import {
  tileSchema,
  type JobTile,
} from "~/app/_components/jobs/tiles/registry";
import { isManagerRole } from "~/lib/company-roles";
import { canSeeTile, tileAudience } from "~/lib/job-tiles";
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
  const row = await db.jobTile.findUnique({
    where: { id: tileId },
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

/**
 * For each tile that asks for acknowledgment: whether the viewer is asked
 * and has acknowledged it, and for owners and admins, how many of the people
 * asked have. Members get no counts, which would hint at who else can see it.
 */
export async function acknowledgmentStatus(
  db: Prisma.TransactionClient,
  job: Job,
  tiles: JobTile[],
  viewer: { userId: string; isManager: boolean },
) {
  const asking = tiles.filter((tile) => tile.requiresAcknowledgment);
  if (asking.length === 0) return {};
  const [people, rows] = await Promise.all([
    jobPeople(db, job),
    db.jobTileAcknowledgment.findMany({
      where: {
        tileId: { in: asking.map((tile) => tile.id) },
        ...(viewer.isManager ? {} : { userId: viewer.userId }),
      },
      select: { tileId: true, userId: true },
    }),
  ]);
  const done = new Set(rows.map((row) => `${row.tileId}:${row.userId}`));
  return Object.fromEntries(
    asking.map((tile) => {
      const audience = tileAudience(tile, people);
      const acknowledged = (userId: string) => done.has(`${tile.id}:${userId}`);
      return [
        tile.id,
        {
          needed: audience.some(({ userId }) => userId === viewer.userId),
          acknowledged: acknowledged(viewer.userId),
          summary: viewer.isManager
            ? {
                acknowledged: audience.filter(({ userId }) =>
                  acknowledged(userId),
                ).length,
                total: audience.length,
              }
            : null,
        },
      ];
    }),
  );
}
