import type { TileType } from "~/lib/job-tiles";
import { tileTypes } from "./tiles/registry";

/** Lists every tile type; choosing one adds it to the end of the job. */
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
        {(Object.keys(tileTypes) as TileType[]).map((type) => {
          const { label, icon, hint } = tileTypes[type];
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => onAdd(type)}
                aria-label={`Add ${label} tile`}
                aria-describedby={`tile-hint-${type}`}
                className="flex w-full items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-gray-900"
              >
                <span aria-hidden="true" className="text-lg text-gray-500">
                  {icon}
                </span>
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span
                    id={`tile-hint-${type}`}
                    className="block text-xs text-gray-500"
                  >
                    {hint}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
