import type { Dispatch, SetStateAction } from "react";
import type { JobTile } from "~/lib/job-tiles";
import CanvasTile from "./canvas-tile";

/** The job's tiles in order, each with its type's inline editor. */
export default function JobCanvas({
  tiles,
  onChange,
}: {
  tiles: JobTile[];
  onChange: Dispatch<SetStateAction<JobTile[]>>;
}) {
  if (tiles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        Add tiles from the palette to build this job.
      </p>
    );
  }
  return (
    <ol aria-label="Job tiles" className="space-y-3">
      {tiles.map((tile, index) => (
        <li key={tile.id}>
          <CanvasTile
            tile={tile}
            position={index + 1}
            // Updates the latest tiles, so edits can't undo a concurrent move.
            onChange={(updated) =>
              onChange((current) =>
                current.map((t) => (t.id === updated.id ? updated : t)),
              )
            }
          />
        </li>
      ))}
    </ol>
  );
}
