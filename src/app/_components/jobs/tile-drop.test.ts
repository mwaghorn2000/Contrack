import { expect, test } from "vitest";
import type { JobTile } from "~/lib/job-tiles";
import { CANVAS_DROP_ID, dropTile } from "./tile-drop";

/** A Text tile with a readable id. */
function tile(id: string): JobTile {
  return {
    id,
    type: "text",
    visibility: { mode: "everyone" },
    config: { body: id },
  };
}

const tiles = [tile("a"), tile("b"), tile("c")];
const ids = (list: JobTile[]) => list.map((t) => t.id);

test("a palette tile dropped on a tile goes before it", () => {
  const result = dropTile(tiles, { newType: "text" }, "b");
  expect(ids(result)).toEqual(["a", expect.any(String), "b", "c"]);
  expect(result[1]).toMatchObject({ type: "text", config: { body: "" } });
});

test("a palette tile dropped on the canvas goes at the end", () => {
  const result = dropTile(tiles, { newType: "text" }, CANVAS_DROP_ID);
  expect(ids(result).slice(0, 3)).toEqual(["a", "b", "c"]);
  expect(result[3]).toMatchObject({ config: { body: "" } });
});

test("a palette tile dropped outside the canvas adds nothing", () => {
  expect(dropTile(tiles, { newType: "text" }, null)).toBe(tiles);
});

test("a tile dropped on another tile moves to its place", () => {
  expect(ids(dropTile(tiles, { tileId: "a" }, "c"))).toEqual(["b", "c", "a"]);
  expect(ids(dropTile(tiles, { tileId: "c" }, "a"))).toEqual(["c", "a", "b"]);
});

test("a tile dropped on itself or off the tiles stays put", () => {
  expect(dropTile(tiles, { tileId: "b" }, "b")).toBe(tiles);
  expect(dropTile(tiles, { tileId: "b" }, CANVAS_DROP_ID)).toBe(tiles);
  expect(dropTile(tiles, { tileId: "b" }, null)).toBe(tiles);
});
