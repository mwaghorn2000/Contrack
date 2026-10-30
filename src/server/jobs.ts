import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import type { JobTile } from "~/app/_components/jobs/tiles/registry";
import { keepJobMembers } from "~/lib/job-tiles";

/**
 * Makes a job's members and tiles match what the builder saved. People taken
 * off the job keep a removed row, as history. A tile keeps its id only when it
 * already belongs to this job, so a client can't take over another job's tile.
 */
export async function saveJobContents(
  tx: Prisma.TransactionClient,
  job: { id: string; companyId: string },
  memberIds: string[],
  tiles: JobTile[],
) {
  const userIds = [...new Set(memberIds)];
  const inCompany = await tx.companyMember.count({
    where: { companyId: job.companyId, userId: { in: userIds } },
  });
  if (inCompany !== userIds.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only people in this company can be added to the job.",
    });

  await tx.jobMember.updateMany({
    where: { jobId: job.id, userId: { notIn: userIds }, removedAt: null },
    data: { removedAt: new Date() },
  });
  await tx.jobMember.updateMany({
    where: { jobId: job.id, userId: { in: userIds }, removedAt: { not: null } },
    data: { removedAt: null },
  });
  await tx.jobMember.createMany({
    data: userIds.map((userId) => ({ jobId: job.id, userId })),
    skipDuplicates: true,
  });

  const existing = await tx.jobTile.findMany({
    where: { jobId: job.id },
    select: { id: true },
  });
  const unclaimed = new Set(existing.map((tile) => tile.id));
  const saved = keepJobMembers(tiles, userIds).map((tile) => ({
    ...tile,
    // A repeated id only updates the first tile; the rest become new tiles.
    keep: unclaimed.delete(tile.id),
  }));
  await tx.jobTile.deleteMany({ where: { id: { in: [...unclaimed] } } });
  const rows = saved.map(
    ({ id, keep, type, config, visibility }, position) => ({
      id,
      keep,
      data: { type, config, visibility, position },
    }),
  );
  // New tiles go in one query; kept tiles each need their own update.
  await tx.jobTile.createMany({
    data: rows
      .filter((row) => !row.keep)
      .map((row) => ({ ...row.data, jobId: job.id })),
  });
  for (const row of rows.filter((row) => row.keep))
    await tx.jobTile.update({ where: { id: row.id }, data: row.data });
}
