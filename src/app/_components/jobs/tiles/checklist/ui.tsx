// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useEffect, useRef } from "react";
import type { z } from "zod";
import type { checklistConfig } from ".";

type ChecklistConfig = z.infer<typeof checklistConfig>;

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/** Lets the job's author choose how items are ticked and list them. */
export function ChecklistTileEditor({
  config,
  onChange,
}: {
  config: ChecklistConfig;
  onChange: (config: ChecklistConfig) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the items change: an item's id, or "add".
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(
        target === "add" ? "[data-add-item]" : `[data-item="${target}"]`,
      )
      ?.focus();
  }, [config.items]);

  return (
    <div ref={listRef} className="space-y-3 text-sm">
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 font-medium">Who ticks the items</legend>
        {(
          [
            ["shared", "Shared for the job"],
            ["each", "Each person ticks their own"],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-2">
            <input
              type="radio"
              checked={config.mode === mode}
              onChange={() => onChange({ ...config, mode })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <ol className="space-y-2">
        {config.items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-2">
            <input
              data-item={item.id}
              aria-label={`Item ${index + 1}`}
              maxLength={300}
              value={item.text}
              onChange={(event) =>
                onChange({
                  ...config,
                  items: config.items.map((each) =>
                    each.id === item.id
                      ? { ...each, text: event.target.value }
                      : each,
                  ),
                })
              }
              className={inputClass}
            />
            <button
              type="button"
              aria-label={`Remove item ${index + 1}`}
              onClick={() => {
                // Keeps keyboard users' place, as removing a contact does.
                const neighbour =
                  config.items[index + 1] ?? config.items[index - 1];
                focusNext.current = neighbour?.id ?? "add";
                onChange({
                  ...config,
                  items: config.items.filter(({ id }) => id !== item.id),
                });
              }}
              className="text-red-700"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      {config.items.length < 100 && (
        <button
          type="button"
          data-add-item
          onClick={() => {
            const id = crypto.randomUUID();
            focusNext.current = id;
            onChange({ ...config, items: [...config.items, { id, text: "" }] });
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        >
          Add item
        </button>
      )}
    </div>
  );
}

/** The checklist's items, without anyone's ticks. */
export function ChecklistTileView({ config }: { config: ChecklistConfig }) {
  if (config.items.length === 0)
    return <p className="text-sm text-gray-500">No items yet.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {config.items.map((item) => (
        <li key={item.id}>{item.text || "Untitled item"}</li>
      ))}
    </ul>
  );
}
