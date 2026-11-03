import { expect, test } from "vitest";
import { measurementAnswer, measurementConfig, measurementTile } from ".";

test("a Measurement tile has nothing to set besides its description", () => {
  const config = measurementTile.defaultConfig();
  expect(config).toEqual({});
  expect(measurementConfig.parse(config)).toEqual({});
});

const width = { label: "Width", value: 1200, unit: "mm" };

test("a measurement has a label and sub-measurements, each a label, finite number and unit", () => {
  expect(
    measurementAnswer.parse({
      label: " Window A32 ",
      values: [
        { label: " Width ", value: 1200, unit: " mm " },
        // No unit is fine, e.g. for a count.
        { label: "Panes", value: 2, unit: "" },
      ],
    }),
  ).toEqual({
    label: "Window A32",
    values: [
      { label: "Width", value: 1200, unit: "mm" },
      { label: "Panes", value: 2, unit: "" },
    ],
  });
  expect(
    measurementAnswer.safeParse({
      label: "Window",
      values: Array.from({ length: 20 }, () => width),
    }).success,
  ).toBe(true);
});

test("a measurement needs a label and 1 to 20 valid sub-measurements", () => {
  for (const answer of [
    { label: "", values: [width] },
    { label: "x".repeat(101), values: [width] },
    { label: "Window", values: [] },
    { label: "Window", values: Array.from({ length: 21 }, () => width) },
    { label: "Window", values: [{ ...width, label: " " }] },
    { label: "Window", values: [{ ...width, label: "x".repeat(101) }] },
    { label: "Window", values: [{ ...width, value: Infinity }] },
    { label: "Window", values: [{ ...width, value: "12" }] },
    { label: "Window", values: [{ ...width, unit: "x".repeat(21) }] },
    // The old shape, one value per measurement.
    { label: "Gap", value: 1, unit: "mm" },
  ])
    expect(measurementAnswer.safeParse(answer).success).toBe(false);
});
