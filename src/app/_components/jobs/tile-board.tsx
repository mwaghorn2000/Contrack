import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Dispatch, SetStateAction } from "react";
import type { JobTile } from "~/lib/job-tiles";
import JobCanvas from "./job-canvas";
import TilePalette from "./tile-palette";
import { dropTile, type DragSource } from "./tile-drop";
import { createTile, tileTypes } from "./tiles/registry";

/** Reads what a drag is carrying from the data its draggable registered. */
function sourceOf(active: Active) {
  return active.data.current as DragSource;
}

/**
 * The palette beside the canvas, whose tiles can be reordered by dragging
 * their handles with a pointer or the keyboard.
 */
export default function TileBoard({
  tiles,
  onChange,
}: {
  tiles: JobTile[];
  onChange: Dispatch<SetStateAction<JobTile[]>>;
}) {
  const sensors = useSensors(
    // A short distance lets palette clicks still add tiles.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Names tiles the way their labels do, since dnd-kit only knows ids.
  const nameOf = (id: UniqueIdentifier) => {
    const index = tiles.findIndex((tile) => tile.id === id);
    const tile = tiles[index];
    return tile ? `${tileTypes[tile.type].label} tile ${index + 1}` : "the end";
  };
  const describe = (active: Active) => nameOf(active.id);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(active)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${describe(active)} is over ${nameOf(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${describe(active)} was dropped at ${nameOf(over.id)}.`
        : `${describe(active)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${describe(active)} was cancelled.`,
  };

  return (
    <DndContext
      sensors={sensors}
      // Moved tiles snap to the nearest tile, which keyboard moves need.
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      onDragEnd={({ active, over }) => {
        const source = sourceOf(active);
        onChange((current) =>
          dropTile(current, source, over ? String(over.id) : null),
        );
      }}
    >
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <TilePalette
          onAdd={(type) =>
            onChange((current) => [...current, createTile(type)])
          }
        />
        <JobCanvas tiles={tiles} onChange={onChange} />
      </div>
    </DndContext>
  );
}
