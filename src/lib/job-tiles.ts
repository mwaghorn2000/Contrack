import { z } from "zod";

/** Who can see a tile: everyone on the job, or only the listed job members. */
export const tileVisibilitySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("everyone") }),
  z.object({ mode: z.literal("members"), userIds: z.array(z.string()) }),
]);

const textTileSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  visibility: tileVisibilitySchema,
  config: z.object({ body: z.string().max(5000) }),
});

/** Every tile type a job template can hold. New tile types join this union. */
export const tileSchema = z.discriminatedUnion("type", [textTileSchema]);

export type JobTile = z.infer<typeof tileSchema>;
export type TileType = JobTile["type"];

export type TileVisibility = z.infer<typeof tileVisibilitySchema>;

/**
 * Whether someone can see a tile. Company owners and admins see every tile,
 * as they see every channel; others need it open to everyone or to be listed.
 */
export function canSeeTile(
  tile: JobTile,
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
export function keepJobMembers(
  tiles: JobTile[],
  memberIds: string[],
): JobTile[] {
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
