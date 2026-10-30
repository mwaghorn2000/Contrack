import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Dispatch, SetStateAction } from "react";
import type { JobTile } from "./tiles/registry";
import CanvasTile from "./canvas-tile";
import type { JobPerson } from "./tile-settings";
import { CANVAS_DROP_ID } from "./tile-drop";

/**
 * The job's tiles in order, each with its type's inline editor. While a new
 * tile is dragged in, `insertBefore` marks where it would land and a zone
 * after the last tile accepts drops at the end.
 */
export default function JobCanvas({
  tiles,
  people,
  onChange,
  addingTile,
  insertBefore,
}: {
  tiles: JobTile[];
  people: JobPerson[];
  onChange: Dispatch<SetStateAction<JobTile[]>>;
  addingTile: boolean;
  insertBefore: string | null;
}) {
  return (
    <div className="space-y-3">
      {tiles.length > 0 && (
        <SortableContext
          items={tiles.map((tile) => tile.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol aria-label="Job tiles" className="space-y-3">
            {tiles.map((tile, index) => (
              <li key={tile.id} className="relative">
                {/* Drawn in the gap so the tiles don't shift, since dnd-kit
                    doesn't re-measure them mid-drag. */}
                {insertBefore === tile.id && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -top-2 h-1 rounded bg-gray-900"
                  />
                )}
                <CanvasTile
                  tile={tile}
                  position={index + 1}
                  people={people}
                  // Updates the latest tiles, so edits can't undo a concurrent
                  // move.
                  onChange={(updated) =>
                    onChange((current) =>
                      current.map((t) => (t.id === updated.id ? updated : t)),
                    )
                  }
                  onRemove={() =>
                    onChange((current) =>
                      current.filter((t) => t.id !== tile.id),
                    )
                  }
                />
              </li>
            ))}
          </ol>
        </SortableContext>
      )}
      {(tiles.length === 0 || addingTile) && (
        <EndZone>
          {tiles.length === 0
            ? "Drag tiles here, or click one in the palette, to build this job."
            : "Drop here to add at the end."}
        </EndZone>
      )}
    </div>
  );
}

/** The drop zone after the last tile, which is also the empty canvas. */
function EndZone({ children }: { children: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_DROP_ID });
  return (
    <p
      ref={setNodeRef}
      className={`rounded-lg border border-dashed p-8 text-center text-sm text-gray-500 ${isOver ? "border-gray-900 bg-gray-100" : "border-gray-300"}`}
    >
      {children}
    </p>
  );
}
