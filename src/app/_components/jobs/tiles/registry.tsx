import type { ComponentType } from "react";
import type { JobTile, TileType } from "~/lib/job-tiles";
import { TextTileEditor, TextTileView } from "./text-tile";

type TileDefinition<T extends JobTile> = {
  label: string;
  icon: string;
  hint: string;
  defaultConfig: () => T["config"];
  Editor: ComponentType<{
    config: T["config"];
    onChange: (config: T["config"]) => void;
  }>;
  View: ComponentType<{ config: T["config"] }>;
};

/**
 * Everything the palette, canvas and job view need for each tile type, so they
 * never switch on the type. A new tile type only needs an entry here.
 */
export const tileTypes: {
  [K in TileType]: TileDefinition<Extract<JobTile, { type: K }>>;
} = {
  text: {
    label: "Text",
    icon: "¶",
    hint: "Instructions or notes",
    defaultConfig: () => ({ body: "" }),
    Editor: TextTileEditor,
    View: TextTileView,
  },
};

/**
 * Returns a tile's registry entry. TypeScript can't tie `tile.type` to its
 * entry across a union, so this and `createTile` are the only casts.
 */
export function definitionFor<T extends JobTile>(tile: T) {
  return tileTypes[tile.type] as unknown as TileDefinition<T>;
}

/** Makes a new tile of the given type, visible to everyone on the job. */
export function createTile<K extends TileType>(type: K) {
  return {
    id: crypto.randomUUID(),
    type,
    visibility: { mode: "everyone" },
    config: tileTypes[type].defaultConfig(),
  } as unknown as Extract<JobTile, { type: K }>;
}
