import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import {
  tileSchema,
  type JobTile,
} from "~/app/_components/jobs/tiles/registry";
import { keepJobMembers } from "~/lib/job-tiles";

/**
 * Makes a job's members and tiles match what the builder saved. People taken
 * off the job keep a removed row, as history. A tile keeps its id only when it
 * already belongs to this job, so a client can't take over another job's tile.
 * Tiles taken off the job are hidden, not deleted, so their answers are kept.
 * Saved tiles that no longer fit their type are left alone. Changing a tile's
 * content clears its acknowledgments, so people confirm the new version.
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
    where: { jobId: job.id, removedAt: null },
    select: {
      id: true,
      type: true,
      config: true,
      visibility: true,
      requiresAcknowledgment: true,
      description: true,
    },
  });
  // Only tiles the builder could have been shown can be kept or deleted.
  // getJob hides unreadable ones, so leaving them out would otherwise
  // delete them on every save.
  const unclaimed = new Set(
    existing
      .filter((tile) => tileSchema.safeParse(tile).success)
      .map((tile) => tile.id),
  );
  const typeOf = new Map(existing.map((tile) => [tile.id, tile.type]));
  const saved = keepJobMembers(tiles, userIds).map((tile) => ({
    ...tile,
    // A repeated id only updates the first tile; the rest become new tiles.
    // So does one sent back as another type, so old answers stay apart.
    keep: typeOf.get(tile.id) === tile.type && unclaimed.delete(tile.id),
  }));
  // Taken off rather than deleted, so their answers are kept for export.
  await tx.jobTile.updateMany({
    where: { id: { in: [...unclaimed] } },
    data: { removedAt: new Date() },
  });
  const rows = saved.map(
    (
      {
        id,
        keep,
        type,
        config,
        visibility,
        requiresAcknowledgment,
        description,
      },
      position,
    ) => ({
      id,
      keep,
      data: {
        type,
        config,
        visibility,
        requiresAcknowledgment,
        description,
        position,
      },
    }),
  );
  // Both sides go through JSON, so undefined fields and key order don't
  // count as an edit.
  const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  // The description is content too, so changing it counts as an edit.
  const content = (tile: { config: unknown; description: string }) =>
    asJson({ config: tile.config, description: tile.description });
  const before = new Map(existing.map((tile) => [tile.id, content(tile)]));
  const edited = rows.filter(
    (row) =>
      row.keep && !isDeepStrictEqual(before.get(row.id), content(row.data)),
  );
  if (edited.length > 0)
    await tx.jobTileAcknowledgment.deleteMany({
      where: { tileId: { in: edited.map((row) => row.id) } },
    });
  // New tiles go in one query; kept tiles each need their own update.
  await tx.jobTile.createMany({
    data: rows
      .filter((row) => !row.keep)
      .map((row) => ({ ...row.data, jobId: job.id })),
  });
  for (const row of rows.filter((row) => row.keep))
    await tx.jobTile.update({ where: { id: row.id }, data: row.data });
}
