import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Dispatch, SetStateAction } from "react";
import type { JobTile } from "~/lib/job-tiles";
import CanvasTile from "./canvas-tile";

/** The job's tiles in order, each with a drag handle and its inline editor. */
export default function JobCanvas({
  tiles,
  onChange,
}: {
  tiles: JobTile[];
  onChange: Dispatch<SetStateAction<JobTile[]>>;
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
              <li key={tile.id}>
                <CanvasTile
                  tile={tile}
                  position={index + 1}
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
      {tiles.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Add tiles from the palette to build this job.
        </p>
      )}
    </div>
  );
}
