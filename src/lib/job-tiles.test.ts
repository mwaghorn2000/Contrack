import { expect, test } from "vitest";
import { canSeeTile, keepJobMembers, type TileVisibility } from "./job-tiles";

/** A tile with the given visibility. */
function tile(visibility: TileVisibility) {
  return { id: "tile-1", visibility };
}

const member = { userId: "user-1", isManager: false };

test("anyone can see a tile open to everyone", () => {
  expect(canSeeTile(tile({ mode: "everyone" }), member)).toBe(true);
});

test("members see a limited tile only when they are listed", () => {
  const limited = tile({ mode: "members", userIds: ["user-2"] });
  expect(canSeeTile(limited, member)).toBe(false);
  expect(canSeeTile(limited, { ...member, userId: "user-2" })).toBe(true);
});

test("owners and admins see every tile, even one listing nobody", () => {
  const nobody = tile({ mode: "members", userIds: [] });
  expect(canSeeTile(nobody, member)).toBe(false);
  expect(canSeeTile(nobody, { ...member, isManager: true })).toBe(true);
});

test("people taken off the job are dropped from tile visibility", () => {
  const tiles = [
    tile({ mode: "members", userIds: ["user-1", "user-2"] }),
    tile({ mode: "everyone" }),
  ];

  expect(keepJobMembers(tiles, ["user-2"]).map((t) => t.visibility)).toEqual([
    { mode: "members", userIds: ["user-2"] },
    { mode: "everyone" },
  ]);
});
