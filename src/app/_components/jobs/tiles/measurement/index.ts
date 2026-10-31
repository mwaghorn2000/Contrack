import { z } from "zod";
import { defineTile } from "../define-tile";
import {
  MeasurementTileAnswers,
  MeasurementTileEditor,
  MeasurementTileView,
} from "./ui";

// Nothing to set: the tile's description says what to measure, and people
// label each measurement themselves.
export const measurementConfig = z.object({});

// One measurement, e.g. "North wall gap: 12.5 mm". The unit may be blank,
// e.g. for a count; the answer's note says where or how it was taken.
export const measurementAnswer = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.number().finite(),
  unit: z.string().trim().max(20),
});

/** Labelled measurements people take on the job, each with its unit. */
export const measurementTile = defineTile({
  type: "measurement",
  label: "Measurement",
  icon: "📏",
  hint: "Labelled measurements taken on site",
  config: measurementConfig,
  defaultConfig: () => ({}),
  Editor: MeasurementTileEditor,
  View: MeasurementTileView,
  answers: { schema: measurementAnswer, Answers: MeasurementTileAnswers },
});
