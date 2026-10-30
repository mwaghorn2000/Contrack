import { z } from "zod";
import { defineTile } from "../define-tile";
import {
  ChecklistTileAnswers,
  ChecklistTileEditor,
  ChecklistTileView,
} from "./ui";

export const checklistConfig = z.object({
  // "shared": each item is ticked once for the job; "each": per person.
  mode: z.enum(["shared", "each"]),
  items: z
    .array(z.object({ id: z.string().max(64), text: z.string().max(300) }))
    .max(100)
    // Ticks point at items by id, so each must be different.
    .refine(
      (items) => new Set(items.map(({ id }) => id)).size === items.length,
    ),
});

// One tick of one item; the answer's note is an optional comment on it.
export const checklistAnswer = z.object({ itemId: z.string().max(64) });

/** Items people tick off, once for the whole job or each for themselves. */
export const checklistTile = defineTile({
  type: "checklist",
  label: "Checklist",
  icon: "☑",
  hint: "Items to tick off",
  config: checklistConfig,
  defaultConfig: () => ({ mode: "shared" as const, items: [] }),
  Editor: ChecklistTileEditor,
  View: ChecklistTileView,
  answers: {
    schema: checklistAnswer,
    check: ({ config, data, userId, others }) => {
      if (!config.items.some((item) => item.id === data.itemId))
        return "That item isn't on this checklist.";
      const ticks = others.filter((other) => other.data.itemId === data.itemId);
      if (config.mode === "shared")
        return ticks.length > 0 ? "That item is already ticked." : null;
      return ticks.some((tick) => tick.authorId === userId)
        ? "You've already ticked that item."
        : null;
    },
    Answers: ChecklistTileAnswers,
  },
});
