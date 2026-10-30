import { expect, test } from "vitest";
import { TILES, createTile, tileSchema, tileTypes } from "./registry";

const textTile = {
  id: "tile-1",
  type: "text",
  visibility: { mode: "everyone" },
  requiresAcknowledgment: false,
  config: { body: "Wear a harness." },
};

test("the tile schema accepts a valid tile", () => {
  expect(tileSchema.parse(textTile)).toEqual(textTile);
});

test("the tile schema rejects unknown types, bad config and bad visibility", () => {
  for (const tile of [
    { ...textTile, type: "audit" },
    { ...textTile, config: { body: "x".repeat(5001) } },
    { ...textTile, config: {} },
    { ...textTile, visibility: { mode: "members" } },
  ])
    expect(tileSchema.safeParse(tile).success).toBe(false);
});

test("every registered tile has a unique type", () => {
  const types = TILES.map((tile) => tile.type);
  expect(new Set(types).size).toBe(types.length);
  expect(Object.keys(tileTypes)).toEqual(types);
});

test("every registered tile makes new tiles its own schema accepts", () => {
  for (const { type } of TILES) {
    const tile = createTile(type);
    expect(tileSchema.parse(tile)).toEqual(tile);
    expect(tile.visibility).toEqual({ mode: "everyone" });
  }
});
