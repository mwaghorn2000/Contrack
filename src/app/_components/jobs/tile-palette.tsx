import { useDraggable } from "@dnd-kit/core";
import type { TileType } from "./tiles/registry";
import type { DragSource } from "./tile-drop";
import { tileTypes } from "./tiles/registry";

/**
 * Lists every tile type. Dragging one onto the canvas inserts it there;
 * clicking it adds it to the end.
 */
export default function TilePalette({
  onAdd,
}: {
  onAdd: (type: TileType) => void;
}) {
  return (
    <section aria-labelledby="tile-palette" className="space-y-2">
      <h2 id="tile-palette" className="text-sm font-semibold text-gray-900">
        Tiles
      </h2>
      <ul className="space-y-2">
        {(Object.keys(tileTypes) as TileType[]).map((type) => (
          <li key={type}>
            <PaletteItem type={type} onAdd={onAdd} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One tile type in the palette, draggable with a pointer. */
function PaletteItem({
  type,
  onAdd,
}: {
  type: TileType;
  onAdd: (type: TileType) => void;
}) {
  const { label, icon, hint } = tileTypes[type];
  const source: DragSource = { newType: type };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: source,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      // Pointer drags only: Enter and Space keep adding the tile, and keyboard
      // users reorder it on the canvas afterwards.
      onKeyDown={undefined}
      onClick={() => onAdd(type)}
      aria-label={`Add ${label} tile`}
      aria-describedby={`tile-hint-${type}`}
      className={`flex w-full touch-none items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-gray-900 ${isDragging ? "opacity-50" : ""}`}
    >
      <span aria-hidden="true" className="text-lg text-gray-500">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span id={`tile-hint-${type}`} className="block text-xs text-gray-500">
          {hint}
        </span>
      </span>
    </button>
  );
}
