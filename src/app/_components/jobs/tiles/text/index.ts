import { z } from "zod";
import { defineTile } from "../define-tile";
import { TextTileEditor, TextTileView } from "./ui";

export const textConfig = z.object({ body: z.string().max(5000) });

/** A block of instructions or notes, shown with its line breaks. */
export const textTile = defineTile({
  type: "text",
  label: "Text",
  icon: "¶",
  hint: "Instructions or notes",
  config: textConfig,
  defaultConfig: () => ({ body: "" }),
  Editor: TextTileEditor,
  View: TextTileView,
});
