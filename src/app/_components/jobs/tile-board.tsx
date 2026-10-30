import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useState, type Dispatch, type SetStateAction } from "react";
import JobCanvas from "./job-canvas";
import TilePalette from "./tile-palette";
import type { JobPerson } from "./tile-settings";
import { CANVAS_DROP_ID, dropTile, type DragSource } from "./tile-drop";
import {
  createTile,
  tileTypes,
  type JobTile,
  type TileType,
} from "./tiles/registry";

/** Reads what a drag is carrying from the data its draggable registered. */
function sourceOf(active: Active) {
  return active.data.current as DragSource;
}

/**
 * New tiles land where the pointer is, so letting go anywhere else adds
 * nothing. Moved tiles snap to the nearest tile, which keyboard moves need.
 */
const collisionDetection: CollisionDetection = (args) =>
  "newType" in sourceOf(args.active)
    ? pointerWithin(args)
    : closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== CANVAS_DROP_ID,
        ),
      });

/**
 * The palette beside the canvas, sharing one drag-and-drop context so tiles
 * can be dragged in from the palette and reordered on the canvas.
 */
export default function TileBoard({
  tiles,
  people,
  onChange,
}: {
  tiles: JobTile[];
  people: JobPerson[];
  onChange: Dispatch<SetStateAction<JobTile[]>>;
}) {
  const [newType, setNewType] = useState<TileType | null>(null);
  const [insertBefore, setInsertBefore] = useState<string | null>(null);
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
  // Names what is being dragged: a new tile, or a tile already on the canvas.
  const describe = (active: Active) => {
    const source = sourceOf(active);
    return "newType" in source
      ? `New ${tileTypes[source.newType].label} tile`
      : nameOf(active.id);
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(active)}.`,
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? `${describe(active)} is over ${nameOf(over.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${describe(active)} was dropped at ${nameOf(over.id)}.`
        : `${describe(active)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${describe(active)} was cancelled.`,
  };

  // Clears the palette drag's overlay and insert line.
  const reset = () => {
    setNewType(null);
    setInsertBefore(null);
  };

  return (
    <DndContext
      // A fixed id keeps dnd-kit's generated ids the same on the server and in
      // the browser, so hydration matches.
      id="tile-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements }}
      onDragStart={({ active }) => {
        const source = sourceOf(active);
        if ("newType" in source) setNewType(source.newType);
      }}
      onDragOver={({ active, over }) => {
        if ("newType" in sourceOf(active))
          setInsertBefore(over ? String(over.id) : null);
      }}
      onDragEnd={({ active, over }) => {
        const source = sourceOf(active);
        onChange((current) =>
          dropTile(current, source, over ? String(over.id) : null),
        );
        reset();
      }}
      onDragCancel={reset}
    >
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <TilePalette
          onAdd={(type) =>
            onChange((current) => [...current, createTile(type)])
          }
        />
        <JobCanvas
          tiles={tiles}
          people={people}
          onChange={onChange}
          addingTile={newType !== null}
          insertBefore={insertBefore}
        />
      </div>
      {/* Only palette drags use an overlay; moved tiles drag themselves, and
          a mounted overlay would be measured in their place. */}
      {newType && (
        <DragOverlay dropAnimation={null}>
          <div className="rounded-md border border-gray-400 bg-white px-3 py-2 text-sm font-medium shadow-lg">
            {tileTypes[newType].icon} {tileTypes[newType].label}
          </div>
        </DragOverlay>
      )}
    </DndContext>
  );
}
