import type { ComponentType } from "react";
import { z } from "zod";
import { textTile } from "./text";

/**
 * Every tile type. A new tile type is a folder like `./text` (definition in
 * `index.ts`, components in `ui.tsx`) plus one entry here; the palette, canvas,
 * job view and server validation all read from this list.
 */
export const TILES = [textTile] as const;

type Tiles = typeof TILES;

export type TileDefinition = Tiles[number];
export type TileType = TileDefinition["type"];
export type JobTile = z.infer<TileDefinition["schema"]>;

// A generic mapped type keeps the tuple shape discriminatedUnion needs.
type SchemasOf<
  T extends readonly { schema: z.ZodDiscriminatedUnionOption<"type"> }[],
> = { -readonly [I in keyof T]: T[I]["schema"] };

/** Validates any tile, picking the schema by its `type`. */
export const tileSchema = z.discriminatedUnion(
  "type",
  TILES.map((tile) => tile.schema) as unknown as SchemasOf<Tiles>,
);

/** Each tile type's definition, by type, in the palette's order. */
export const tileTypes = Object.fromEntries(
  TILES.map((tile) => [tile.type, tile]),
) as { [K in TileType]: Extract<TileDefinition, { type: K }> };

type DefinitionOf<T extends JobTile> = {
  label: string;
  icon: string;
  Editor: ComponentType<{
    config: T["config"];
    onChange: (config: T["config"]) => void;
  }>;
  View: ComponentType<{ config: T["config"] }>;
};

/**
 * Returns a tile's definition. TypeScript can't tie `tile.type` to its entry
 * across a union, so this and `createTile` are the only casts.
 */
export function definitionFor<T extends JobTile>(tile: T) {
  return tileTypes[tile.type] as unknown as DefinitionOf<T>;
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
