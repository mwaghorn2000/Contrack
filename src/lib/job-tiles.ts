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
