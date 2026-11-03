import { z } from "zod";
import { defineTile } from "../define-tile";
import { PhotosTileAnswers, PhotosTileEditor, PhotosTileView } from "./ui";

// Nothing to set: the tile's description says what to photograph.
export const photosConfig = z.object({});

// Each answer is a batch of 1–10 photos or PDFs; its note is the caption.
export const photosAnswer = z.object({});

/** A shared gallery of photos and PDFs that anyone on the job can add to. */
export const photosTile = defineTile({
  type: "photos",
  label: "Photos & files",
  icon: "🖼",
  hint: "Photos and PDFs from the job",
  config: photosConfig,
  defaultConfig: () => ({}),
  Editor: PhotosTileEditor,
  View: PhotosTileView,
  answers: {
    schema: photosAnswer,
    files: { min: 1, max: 10 },
    Answers: PhotosTileAnswers,
  },
});
