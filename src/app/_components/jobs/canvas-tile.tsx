import type { JobTile } from "~/lib/job-tiles";
import { definitionFor } from "./tiles/registry";

/** One tile on the canvas: a header naming its type, then its inline editor. */
export default function CanvasTile<T extends JobTile>({
  tile,
  position,
  onChange,
}: {
  tile: T;
  position: number;
  onChange: (tile: T) => void;
}) {
  const { label, icon, Editor } = definitionFor(tile);
  return (
    <section
      aria-label={`${label} tile ${position}`}
      className="rounded-lg border border-gray-200 bg-white"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm font-medium">
        <span aria-hidden="true" className="text-gray-500">
          {icon}
        </span>
        {label}
      </div>
      <div className="p-3">
        <Editor
          config={tile.config}
          onChange={(config) => onChange({ ...tile, config })}
        />
      </div>
    </section>
  );
}
