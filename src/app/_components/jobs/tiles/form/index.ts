import { z } from "zod";
import { defineTile } from "../define-tile";
import { FormTileAnswers, FormTileEditor, FormTileView } from "./ui";

// Every field has a label (blank while the admin is still writing it) and
// says whether submitters must fill it in.
const fieldBase = {
  id: z.string().max(64),
  label: z.string().max(100),
  required: z.boolean(),
};

export const formField = z.discriminatedUnion("kind", [
  z.object({ ...fieldBase, kind: z.literal("short") }),
  z.object({ ...fieldBase, kind: z.literal("long") }),
  z.object({ ...fieldBase, kind: z.literal("number") }),
  z.object({ ...fieldBase, kind: z.literal("yesno") }),
  z.object({ ...fieldBase, kind: z.literal("date") }),
  z.object({
    ...fieldBase,
    kind: z.literal("choice"),
    options: z.array(z.string().max(100)).max(30),
  }),
  // Takes photos and PDFs, stored as the answer's files under this field.
  z.object({ ...fieldBase, kind: z.literal("files") }),
]);

export const formConfig = z.object({
  fields: z
    .array(formField)
    .max(50)
    // Answers and files point at fields by id, so each must be different.
    .refine(
      (fields) => new Set(fields.map(({ id }) => id)).size === fields.length,
    ),
  // Who must submit; they also need to be able to see the tile.
  submitters: z.array(z.string()).max(200),
  // "one": any one submitter completes it; "each": every submitter submits.
  mode: z.enum(["one", "each"]),
});

// One submission: each filled-in field's value by field id. Files are kept
// as the answer's files, under their field's id.
export const formAnswer = z.object({
  values: z.record(
    z.string().max(64),
    z.union([z.string().max(5000), z.number().finite(), z.boolean()]),
  ),
});

type Field = z.infer<typeof formField>;
// A real calendar day, as a date input gives it: 2026-11-03.
const isoDate = z.string().date();
type Value = z.infer<typeof formAnswer>["values"][string];

/** Whether a filled-in value suits its field's kind. */
function fits(field: Field, value: Value) {
  switch (field.kind) {
    case "short":
      return typeof value === "string" && value.length <= 200;
    case "long":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "yesno":
      return typeof value === "boolean";
    case "date":
      return isoDate.safeParse(value).success;
    case "choice":
      return typeof value === "string" && field.options.includes(value);
    case "files":
      return false;
  }
}

/**
 * Why a submission can't be saved, or null: a new one must be from someone
 * asked to submit, and the first (or their first, when each submits). Edits
 * skip those, so people taken off the list can still fix what they sent.
 * Either way its values must fill the required fields and suit their kinds.
 */
function checkSubmission({
  config,
  data,
  userId,
  editing,
  others,
}: {
  config: z.infer<typeof formConfig>;
  data: z.infer<typeof formAnswer>;
  userId: string;
  editing: boolean;
  others: { authorId: string | null }[];
}) {
  if (!editing) {
    if (!config.submitters.includes(userId))
      return "You're not asked to submit this form.";
    if (config.mode === "one" && others.length > 0)
      return "This form has already been submitted.";
    if (others.some((other) => other.authorId === userId))
      return "You've already submitted this form.";
  }
  for (const [id, value] of Object.entries(data.values)) {
    const field = config.fields.find((each) => each.id === id);
    if (!field || !fits(field, value))
      return "That answer doesn't fit this form.";
  }
  for (const field of config.fields) {
    const value = data.values[field.id];
    const blank = value === undefined || `${value}`.trim() === "";
    if (field.kind !== "files" && field.required && blank)
      return `Fill in "${field.label || "Untitled field"}".`;
  }
  return null;
}

/** A form admins write, for chosen people on the job to fill in. */
export const formTile = defineTile({
  type: "form",
  label: "Form",
  icon: "📝",
  hint: "Questions chosen people fill in",
  config: formConfig,
  defaultConfig: () => ({ fields: [], submitters: [], mode: "one" as const }),
  Editor: FormTileEditor,
  View: FormTileView,
  answers: {
    schema: formAnswer,
    notes: false,
    // Up to ten photos or PDFs in each Files field (MAX_FIELD_FILES in
    // ui.tsx); at least one if required.
    fileFields: (config) =>
      config.fields
        .filter((field) => field.kind === "files")
        .map((field) => ({
          id: field.id,
          label: field.label || "Untitled field",
          min: field.required ? 1 : 0,
          max: 10,
        })),
    check: checkSubmission,
    Answers: FormTileAnswers,
  },
});
