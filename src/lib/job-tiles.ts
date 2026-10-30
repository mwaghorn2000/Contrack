import { z } from "zod";

/** Who can see a tile: everyone on the job, or only the listed job members. */
export const tileVisibilitySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("everyone") }),
  // Capped like a job's member list, which every listed person must be on.
  z.object({
    mode: z.literal("members"),
    userIds: z.array(z.string()).max(200),
  }),
]);

export type TileVisibility = z.infer<typeof tileVisibilitySchema>;

/**
 * Whether someone can see a tile. Company owners and admins see every tile,
 * as they see every channel; others need it open to everyone or to be listed.
 */
export function canSeeTile(
  tile: { visibility: TileVisibility },
  viewer: { userId: string; isManager: boolean },
) {
  const { visibility } = tile;
  return (
    viewer.isManager ||
    visibility.mode === "everyone" ||
    visibility.userIds.includes(viewer.userId)
  );
}

/** Drops people who are no longer on the job from every tile's visibility. */
export function keepJobMembers<T extends { visibility: TileVisibility }>(
  tiles: T[],
  memberIds: string[],
): T[] {
  return tiles.map((tile) =>
    tile.visibility.mode === "members"
      ? {
          ...tile,
          visibility: {
            mode: "members" as const,
            userIds: tile.visibility.userIds.filter((id) =>
              memberIds.includes(id),
            ),
          },
        }
      : tile,
  );
}

/**
 * The people asked to acknowledge a tile: those given (the job's current
 * members) who can see it.
 */
export function tileAudience<P extends { userId: string; isManager: boolean }>(
  tile: { visibility: TileVisibility },
  people: P[],
) {
  return people.filter((person) => canSeeTile(tile, person));
}
