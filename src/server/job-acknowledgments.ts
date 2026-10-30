import type { Prisma } from "../../generated/prisma";
import type { JobTile } from "~/app/_components/jobs/tiles/registry";
import { tileAudience } from "~/lib/job-tiles";
import { jobPeople } from "~/server/job-tiles";

type Job = { id: string; companyId: string };

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
