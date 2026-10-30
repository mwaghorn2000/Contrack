import { expect, test } from "vitest";
import { checklistConfig, checklistTile } from ".";

test("a new Checklist starts shared and empty", () => {
  const config = checklistTile.defaultConfig();
  expect(config).toEqual({ mode: "shared", items: [] });
  expect(checklistConfig.parse(config)).toEqual(config);
});

test("a checklist's items need different ids", () => {
  expect(
    checklistConfig.safeParse({
      mode: "shared",
      items: [
        { id: "a", text: "One" },
        { id: "a", text: "Two" },
      ],
    }).success,
  ).toBe(false);
});
