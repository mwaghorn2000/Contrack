import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import type { JobTile } from "~/lib/job-tiles";
import type { DragSource } from "./tile-drop";
import TileSettings, { visibilityLabel, type JobPerson } from "./tile-settings";
import { definitionFor } from "./tiles/registry";

const iconButtonClass =
  "rounded px-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900";

/**
 * One tile on the canvas: a header with a drag handle, its type, who can see
 * it and remove and settings buttons, then its inline editor.
 */
export default function CanvasTile<T extends JobTile>({
  tile,
  position,
  people,
  onChange,
  onRemove,
}: {
  tile: T;
  position: number;
  people: JobPerson[];
  onChange: (tile: T) => void;
  onRemove: () => void;
}) {
  const { label, icon, Editor } = definitionFor(tile);
  const name = `${label} tile ${position}`;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const source: DragSource = { tileId: tile.id };
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tile.id, data: source });
  return (
    <section
      ref={setNodeRef}
      aria-label={name}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-gray-200 bg-white ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm font-medium">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move ${name}`}
          data-tile-handle
          className={`${iconButtonClass} cursor-grab touch-none`}
        >
          ⠿
        </button>
        <span aria-hidden="true" className="text-gray-500">
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">
          <span className="sr-only">Visible to: </span>
          {visibilityLabel(tile.visibility)}
        </span>
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-label={`Visibility of ${name}`}
          className={iconButtonClass}
        >
          {/* A gear drawn as text, not a colour emoji. */}
          {"\u2699\uFE0E"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            // Keeps keyboard users' place by focusing the next tile's handle,
            // or the previous one's when this is the last tile.
            const item = event.currentTarget.closest("li");
            const neighbour =
              item?.nextElementSibling ?? item?.previousElementSibling;
            onRemove();
            neighbour
              ?.querySelector<HTMLElement>("[data-tile-handle]")
              ?.focus();
          }}
          aria-label={`Remove ${name}`}
          className={iconButtonClass}
        >
          ✕
        </button>
      </div>
      {settingsOpen && (
        <TileSettings
          tileId={tile.id}
          visibility={tile.visibility}
          people={people}
          onChange={(visibility) => onChange({ ...tile, visibility })}
        />
      )}
      <div className="p-3">
        <Editor
          config={tile.config}
          onChange={(config) => onChange({ ...tile, config })}
        />
      </div>
    </section>
  );
}
