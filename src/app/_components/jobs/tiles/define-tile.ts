import type { ComponentType } from "react";
import { z } from "zod";
import { tileVisibilitySchema } from "~/lib/job-tiles";

/** One saved answer on a tile, as the job page gets it. */
export type TileAnswer<Data> = {
  id: string;
  author: { id: string; name: string | null; image: string | null } | null;
  data: Data;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  canEdit: boolean;
  canDelete: boolean;
};

/** What a tile's answers component gets on the job page. */
export type AnswersProps<Config, Data> = {
  config: Config;
  answers: TileAnswer<Data>[];
  viewer: { userId: string; isManager: boolean };
  // Nothing can be changed: previewing as someone, or answers not loaded.
  readOnly: boolean;
  // A change is saving. Controls stay focusable but ignore input.
  busy: boolean;
  // Each resolves to whether it saved; failures are shown by the job page.
  onCreate: (data: Data, note?: string) => Promise<boolean>;
  onUpdate: (answerId: string, data: Data, note?: string) => Promise<boolean>;
  onDelete: (answerId: string) => Promise<boolean>;
};

/**
 * Describes one tile type: its palette entry, the zod schema for its config,
 * and the components that edit and show it. Adds the schema for a whole tile.
 * Tiles people fill in also give `answers`: the schema for one answer, any
 * rules beyond it (checked on the server, returning an error message), and
 * the component that shows and takes answers on the job page.
 */
export function defineTile<
  Type extends string,
  Config extends z.ZodTypeAny,
  Answer extends z.ZodTypeAny = z.ZodNever,
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
  answers?: {
    schema: Answer;
    check?: (answer: {
      config: z.infer<Config>;
      data: z.infer<Answer>;
      userId: string;
      // The tile's other answers, for rules like "tick each item once".
      others: { authorId: string | null; data: z.infer<Answer> }[];
    }) => string | null;
    Answers: ComponentType<AnswersProps<z.infer<Config>, z.infer<Answer>>>;
  };
}) {
  return {
    ...tile,
    schema: z.object({
      // Made by the client; cuids and UUIDs fit with room to spare.
      id: z.string().max(64),
      type: z.literal(tile.type),
      visibility: tileVisibilitySchema,
      // Defaults so tiles saved before acknowledgments existed still parse.
      requiresAcknowledgment: z.boolean().default(false),
      // Shown above the tile; every tile type can have one.
      description: z.string().trim().max(500).default(""),
      config: tile.config,
    }),
  };
}
