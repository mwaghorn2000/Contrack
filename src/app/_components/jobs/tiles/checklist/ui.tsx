// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { checklistAnswer, checklistConfig } from ".";
import type { AnswersProps, TileAnswer } from "../define-tile";

type ChecklistConfig = z.infer<typeof checklistConfig>;
type Tick = TileAnswer<z.infer<typeof checklistAnswer>>;

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

/**
 * The checklist on the job page. Shared lists show who ticked each item;
 * each-person lists show your own ticks and everyone's progress.
 */
export function ChecklistTileAnswers({
  config,
  answers,
  viewer,
  readOnly,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: AnswersProps<ChecklistConfig, z.infer<typeof checklistAnswer>>) {
  if (config.items.length === 0)
    return <p className="text-sm text-gray-500">No items yet.</p>;
  // Each-person lists only tick the viewer's own copy.
  const ticks =
    config.mode === "shared"
      ? answers
      : answers.filter((answer) => answer.author?.id === viewer.userId);
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-2">
        {config.items.map((item) => {
          const tick = ticks.find((answer) => answer.data.itemId === item.id);
          const text = item.text || "Untitled item";
          return (
            <li key={item.id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 aria-disabled:opacity-50"
                  checked={!!tick}
                  // Someone else's tick can only be undone by an admin.
                  disabled={readOnly || (tick && !tick.canDelete)}
                  // Not disabled while saving, which would drop focus.
                  aria-disabled={busy}
                  onChange={() => {
                    if (busy) return;
                    void (tick
                      ? onDelete(tick.id)
                      : onCreate({ itemId: item.id }));
                  }}
                />
                <span>{text}</span>
              </label>
              {tick && (
                <TickDetails
                  tick={tick}
                  itemText={text}
                  shared={config.mode === "shared"}
                  disabled={readOnly || busy}
                  onSave={(note) => onUpdate(tick.id, tick.data, note)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {config.mode === "each" && (
        <Progress items={config.items} answers={answers} />
      )}
    </div>
  );
}

/** Who ticked an item and when, and its note, which the ticker can edit. */
function TickDetails({
  tick,
  itemText,
  shared,
  disabled,
  onSave,
}: {
  tick: Tick;
  itemText: string;
  shared: boolean;
  disabled: boolean;
  onSave: (note: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(tick.note ?? "");
  return (
    <div className="ml-6 space-y-1 text-xs text-gray-500">
      {shared && (
        <p>
          Ticked by {tick.author?.name ?? "a former member"} ·{" "}
          {tick.createdAt.toLocaleString("en-AU", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      )}
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            // Stays open after a failure, to try again.
            void onSave(note).then((saved) => saved && setEditing(false));
          }}
        >
          <input
            aria-label={`Note on ${itemText}`}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={disabled}
            className="underline disabled:opacity-50"
          >
            Save
          </button>
        </form>
      ) : (
        <p className="flex gap-2">
          {tick.note && (
            <span className="whitespace-pre-wrap text-gray-700">
              {tick.note}
            </span>
          )}
          {tick.canEdit && !disabled && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`${tick.note ? "Edit note on" : "Add note to"} ${itemText}`}
              className="underline"
            >
              {tick.note ? "Edit note" : "Add note"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** How many items each person has ticked, on an each-person list. */
function Progress({
  items,
  answers,
}: {
  items: ChecklistConfig["items"];
  answers: Tick[];
}) {
  const people = new Map<string, { id: string; name: string; done: number }>();
  for (const answer of answers) {
    // Ticks of items since removed from the list don't count.
    if (!answer.author || !items.some(({ id }) => id === answer.data.itemId))
      continue;
    const person = people.get(answer.author.id) ?? {
      id: answer.author.id,
      name: answer.author.name ?? "Unnamed member",
      done: 0,
    };
    person.done++;
    people.set(answer.author.id, person);
  }
  if (people.size === 0) return null;
  return (
    <ul aria-label="Progress" className="space-y-0.5 text-xs text-gray-600">
      {[...people.values()].map((person) => (
        <li key={person.id}>
          {person.name}: {person.done} of {items.length}
        </li>
      ))}
    </ul>
  );
}
