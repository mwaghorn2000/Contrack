// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { z } from "zod";
import type { measurementAnswer, measurementConfig } from ".";
import AnswerByline from "../../answers/answer-byline";
import type { AnswersProps, TileAnswer } from "../define-tile";

type MeasurementConfig = z.infer<typeof measurementConfig>;
type Data = z.infer<typeof measurementAnswer>;
type Measurement = TileAnswer<Data>;

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/** "Gap: 4 mm", a measurement as shown and as its buttons name it. */
function describe({ label, value, unit }: Data) {
  return `${label}: ${value}${unit ? ` ${unit}` : ""}`;
}

/** Tells the job's author that measurements are added on the job page. */
export function MeasurementTileEditor(_props: {
  config: MeasurementConfig;
  onChange: (config: MeasurementConfig) => void;
}) {
  return (
    <p className="text-sm text-gray-500">
      People on the job add measurements on the job page, each with a label, a
      value and a unit. Use the description to say what to measure.
    </p>
  );
}

/** Nothing to show without measurements; the description says it all. */
export function MeasurementTileView(_props: { config: MeasurementConfig }) {
  return null;
}

/**
 * Measurements on the job page: a form to add one (label, value, unit,
 * note), then the list, newest first. Authors can edit or delete their own.
 */
export function MeasurementTileAnswers({
  answers,
  readOnly,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: AnswersProps<MeasurementConfig, Data>) {
  // Where focus goes after a measurement is deleted.
  const newLabelRef = useRef<HTMLInputElement>(null);
  const measurements = [...answers].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return (
    <div className="space-y-3 text-sm">
      {!readOnly && (
        <MeasurementForm
          name="New measurement"
          busy={busy}
          labelRef={newLabelRef}
          submitLabel="Add measurement"
          onSubmit={(data, note) => onCreate(data, note)}
        />
      )}
      {measurements.length > 0 && (
        <ul aria-label="Measurements" className="divide-y divide-gray-100">
          {measurements.map((measurement) => (
            <MeasurementRow
              key={measurement.id}
              measurement={measurement}
              readOnly={readOnly}
              busy={busy}
              onUpdate={(data, note) => onUpdate(measurement.id, data, note)}
              onDelete={async () => {
                if (await onDelete(measurement.id))
                  newLabelRef.current?.focus();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One measurement in the list, which its author can edit or delete. */
function MeasurementRow({
  measurement,
  readOnly,
  busy,
  onUpdate,
  onDelete,
}: {
  measurement: Measurement;
  readOnly: boolean;
  busy: boolean;
  onUpdate: (data: Data, note: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const editRef = useRef<HTMLButtonElement>(null);
  // Set when the edit form closes, so focus goes back to its Edit button.
  const refocus = useRef(false);
  useEffect(() => {
    if (mode !== "view" || !refocus.current) return;
    refocus.current = false;
    editRef.current?.focus();
  }, [mode]);
  const name = describe(measurement.data);
  /** Closes the edit form, putting focus back on its Edit button. */
  const closeEdit = () => {
    refocus.current = true;
    setMode("view");
  };
  if (mode === "edit")
    return (
      <li className="py-2">
        <MeasurementForm
          name="Edit measurement"
          busy={busy}
          initial={measurement}
          autoFocus
          submitLabel="Save"
          onSubmit={async (data, note) => {
            const saved = await onUpdate(data, note);
            if (saved) closeEdit();
            return saved;
          }}
          onCancel={closeEdit}
        />
      </li>
    );
  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{name}</span>
        <AnswerByline answer={measurement} />
        {!readOnly && measurement.canEdit && (
          <button
            ref={editRef}
            type="button"
            aria-label={`Edit measurement: ${name}`}
            onClick={() => setMode("edit")}
            className="text-xs underline"
          >
            Edit
          </button>
        )}
        {!readOnly && measurement.canDelete && (
          <button
            type="button"
            aria-label={`Delete measurement: ${name}`}
            onClick={() => setMode("delete")}
            className="text-xs text-red-700 underline"
          >
            Delete
          </button>
        )}
      </div>
      {measurement.note && (
        <p className="whitespace-pre-wrap text-gray-700">{measurement.note}</p>
      )}
      {mode === "delete" && (
        <div
          role="group"
          aria-label="Confirm deleting this measurement"
          className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2"
        >
          <span>Delete this measurement?</span>
          <button
            type="button"
            aria-disabled={busy}
            onClick={() => void (busy || onDelete())}
            className="rounded-md bg-red-700 px-3 py-1 text-white aria-disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            // Focus starts on the safe choice.
            autoFocus
            onClick={() => setMode("view")}
            className="rounded-md border border-gray-300 bg-white px-3 py-1"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * A label, value, unit (millimetres unless changed) and note, for a new
 * measurement or an edit. A new one's form clears once it saves, keeping the
 * unit for the next; a failed save keeps what was typed.
 */
function MeasurementForm({
  name,
  busy,
  initial,
  autoFocus = false,
  labelRef,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  name: string;
  busy: boolean;
  initial?: Measurement;
  autoFocus?: boolean;
  labelRef?: RefObject<HTMLInputElement | null>;
  submitLabel: string;
  onSubmit: (data: Data, note: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState(initial?.data.label ?? "");
  const [value, setValue] = useState(initial ? `${initial.data.value}` : "");
  const [unit, setUnit] = useState(initial?.data.unit ?? "mm");
  const [note, setNote] = useState(initial?.note ?? "");
  const number = Number(value);
  const valid =
    label.trim() !== "" && value.trim() !== "" && Number.isFinite(number);
  return (
    <form
      aria-label={name}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        const data = { label: label.trim(), value: number, unit: unit.trim() };
        void onSubmit(data, note).then((saved) => {
          if (saved && !initial) {
            setLabel("");
            setValue("");
            setNote("");
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="block">
          <span className="font-medium">Label</span>
          <input
            ref={labelRef}
            required
            maxLength={100}
            autoFocus={autoFocus}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. North wall gap"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="font-medium">Value</span>
          <input
            type="number"
            step="any"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="font-medium">Unit</span>
          <input
            maxLength={20}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="block">
        <span className="font-medium">Note</span>{" "}
        <span className="text-gray-500">(optional)</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!valid}
          aria-disabled={busy}
          className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 aria-disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
