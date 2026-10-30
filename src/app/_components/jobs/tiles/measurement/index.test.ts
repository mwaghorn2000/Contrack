import { expect, test } from "vitest";
import { measurementAnswer, measurementConfig, measurementTile } from ".";

test("a Measurement tile has nothing to set besides its description", () => {
  const config = measurementTile.defaultConfig();
  expect(config).toEqual({});
  expect(measurementConfig.parse(config)).toEqual({});
});

test("a measurement has a label, a finite number and a unit", () => {
  expect(
    measurementAnswer.parse({ label: " North wall ", value: 12.5, unit: "mm" }),
  ).toEqual({ label: "North wall", value: 12.5, unit: "mm" });
  // No unit is fine, e.g. for a count.
  expect(
    measurementAnswer.safeParse({ label: "Posts", value: 4, unit: "" }).success,
  ).toBe(true);
  for (const answer of [
    { label: "", value: 1, unit: "mm" },
    { label: "x".repeat(101), value: 1, unit: "mm" },
    { label: "Gap", value: Infinity, unit: "mm" },
    { label: "Gap", value: "12", unit: "mm" },
    { label: "Gap", value: 1, unit: "x".repeat(21) },
  ])
    expect(measurementAnswer.safeParse(answer).success).toBe(false);
});
