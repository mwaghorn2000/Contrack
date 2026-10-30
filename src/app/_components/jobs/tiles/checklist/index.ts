import { z } from "zod";
import { defineTile } from "../define-tile";
import { ChecklistTileEditor, ChecklistTileView } from "./ui";

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
});
