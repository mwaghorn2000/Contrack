import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JobTile } from "~/lib/job-tiles";
import type { DragSource } from "./tile-drop";
import { definitionFor } from "./tiles/registry";

const iconButtonClass =
  "rounded px-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900";

/**
 * One tile on the canvas: a header with a drag handle, its type and a remove
 * button, then its inline editor.
 */
export default function CanvasTile<T extends JobTile>({
  tile,
  position,
  onChange,
  onRemove,
}: {
  tile: T;
  position: number;
  onChange: (tile: T) => void;
  onRemove: () => void;
}) {
  const { label, icon, Editor } = definitionFor(tile);
  const name = `${label} tile ${position}`;
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
          className={`${iconButtonClass} cursor-grab touch-none`}
        >
          ⠿
        </button>
        <span aria-hidden="true" className="text-gray-500">
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className={iconButtonClass}
        >
          ✕
        </button>
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
