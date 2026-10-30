import type { ComponentType } from "react";
import { z } from "zod";
import { tileVisibilitySchema } from "~/lib/job-tiles";

/**
 * Describes one tile type: its palette entry, the zod schema for its config,
 * and the components that edit and show it. Adds the schema for a whole tile.
 */
export function defineTile<
  Type extends string,
  Config extends z.ZodTypeAny,
>(tile: {
  type: Type;
  label: string;
  icon: string;
  hint: string;
  config: Config;
  defaultConfig: () => z.infer<Config>;
  Editor: ComponentType<{
    config: z.infer<Config>;
    onChange: (config: z.infer<Config>) => void;
  }>;
  View: ComponentType<{ config: z.infer<Config> }>;
}) {
  return {
    ...tile,
    schema: z.object({
      id: z.string(),
      type: z.literal(tile.type),
      visibility: tileVisibilitySchema,
      config: tile.config,
    }),
  };
}
