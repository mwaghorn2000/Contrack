import { expect, test } from "vitest";
import { formConfig, formTile } from ".";

test("a new Form starts with no fields and no one asked to submit", () => {
  const config = formTile.defaultConfig();
  expect(config).toEqual({ fields: [], submitters: [], mode: "one" });
  expect(formConfig.parse(config)).toEqual(config);
});

test("a form takes each kind of field", () => {
  const fields = [
    { id: "a", kind: "short", label: "Name", required: true },
    { id: "b", kind: "long", label: "Notes", required: false },
    { id: "c", kind: "number", label: "Hours", required: true },
    { id: "d", kind: "yesno", label: "Safe?", required: true },
    { id: "e", kind: "date", label: "Done on", required: false },
    {
      id: "f",
      kind: "choice",
      label: "Weather",
      required: true,
      options: ["Fine", "Rain"],
    },
    { id: "g", kind: "files", label: "Site photos", required: true },
  ];
  expect(
    formConfig.parse({ fields, submitters: ["user-1"], mode: "each" }).fields,
  ).toEqual(fields);
});

test("a form's fields need different ids and a known kind", () => {
  for (const fields of [
    [
      { id: "a", kind: "short", label: "One", required: false },
      { id: "a", kind: "short", label: "Two", required: false },
    ],
    [{ id: "a", kind: "colour", label: "One", required: false }],
  ])
    expect(
      formConfig.safeParse({ fields, submitters: [], mode: "one" }).success,
    ).toBe(false);
});
