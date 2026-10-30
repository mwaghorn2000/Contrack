import { arrayMove } from "@dnd-kit/sortable";
import type { JobTile, TileType } from "~/lib/job-tiles";
import { createTile } from "./tiles/registry";

/** The droppable area behind the canvas tiles, for dropping after the last one. */
export const CANVAS_DROP_ID = "job-canvas";

/** What is being dragged: a new tile from the palette, or an existing tile. */
export type DragSource = { newType: TileType } | { tileId: string };

/**
 * Returns the tiles after a drop. A palette tile goes before the tile it was
 * dropped on, or at the end; an existing tile moves to the dropped-on spot.
 */
export function dropTile(
  tiles: JobTile[],
  source: DragSource,
  overId: string | null,
) {
  if (overId === null) return tiles;
  const overIndex = tiles.findIndex((tile) => tile.id === overId);
  if ("newType" in source) {
    const at = overIndex === -1 ? tiles.length : overIndex;
    return [
      ...tiles.slice(0, at),
      createTile(source.newType),
      ...tiles.slice(at),
    ];
  }
  const fromIndex = tiles.findIndex((tile) => tile.id === source.tileId);
  if (fromIndex === -1 || overIndex === -1 || fromIndex === overIndex)
    return tiles;
  return arrayMove(tiles, fromIndex, overIndex);
}
