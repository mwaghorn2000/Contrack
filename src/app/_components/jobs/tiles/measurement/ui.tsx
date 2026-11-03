// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { z } from "zod";
import type { measurementAnswer, measurementConfig } from ".";
import AnswerByline from "../../answers/answer-byline";
import ConfirmDelete from "../../answers/confirm-delete";
import type { AnswersProps, TileAnswer } from "../define-tile";

type MeasurementConfig = z.infer<typeof measurementConfig>;
type Data = z.infer<typeof measurementAnswer>;
type Value = Data["values"][number];
type Measurement = TileAnswer<Data>;

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/** "Width: 1200 mm", one of a measurement's values as shown. */
function describe({ label, value, unit }: Value) {
  return `${label}: ${value}${unit ? ` ${unit}` : ""}`;
}

/** Tells the job's author that measurements are added on the job page. */
export function MeasurementTileEditor(_props: {
  config: MeasurementConfig;
  onChange: (config: MeasurementConfig) => void;
}) {
  return (
    <p className="text-sm text-gray-500">
      People on the job add measurements on the job page, each with a label and
      one or more values with units. Use the description to say what to measure.
    </p>
  );
}

/** Nothing to show without measurements; the description says it all. */
export function MeasurementTileView(_props: { config: MeasurementConfig }) {
  return null;
}

/**
 * Measurements on the job page: a form to add one (label, values, note),
 * then the list, newest first. Authors can edit or delete their own.
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
          template={measurements[0]}
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
  // With its first value, to tell apart two of the same label.
  const name = `${measurement.data.label}, ${describe(measurement.data.values[0]!)}`;
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
      <p>{measurement.data.values.map(describe).join(" · ")}</p>
      {measurement.note && (
        <p className="whitespace-pre-wrap text-gray-700">{measurement.note}</p>
      )}
      {mode === "delete" && (
        <ConfirmDelete
          label="Confirm deleting this measurement"
          question="Delete this measurement?"
          busy={busy}
          onDelete={onDelete}
          onCancel={() => setMode("view")}
        />
      )}
    </li>
  );
}

// A row of the form: one value as typed, keyed so rows can be removed.
type Row = { key: number; label: string; value: string; unit: string };
let nextRowKey = 0;

/**
 * Form rows for the given values, or one empty row in millimetres without
 * any. Without `withValues`, rows keep only the names and units.
 */
function toRows(values: Value[] | undefined, withValues: boolean): Row[] {
  if (!values) return [{ key: nextRowKey++, label: "", value: "", unit: "mm" }];
  return values.map((value) => ({
    key: nextRowKey++,
    label: value.label,
    value: withValues ? `${value.value}` : "",
    unit: value.unit,
  }));
}

/**
 * A label, rows of name, value and unit, and a note, for a new measurement
 * or an edit. A new one starts with the names and units of `template`, the
 * newest measurement. Once a new one saves, its values clear for the next;
 * a failed save keeps them.
 */
function MeasurementForm({
  name,
  busy,
  initial,
  template,
  autoFocus = false,
  labelRef,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  name: string;
  busy: boolean;
  initial?: Measurement;
  template?: Measurement;
  autoFocus?: boolean;
  labelRef?: RefObject<HTMLInputElement | null>;
  submitLabel: string;
  onSubmit: (data: Data, note: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState(initial?.data.label ?? "");
  const [rows, setRows] = useState(() =>
    initial
      ? toRows(initial.data.values, true)
      : toRows(template?.data.values, false),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  // The row whose name takes focus once rows are added or removed.
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    formRef.current
      ?.querySelector<HTMLInputElement>(`[data-row-name="${key}"]`)
      ?.focus();
  }, [rows]);

  /** Changes some of one row's fields. */
  const changeRow = (key: number, change: Partial<Row>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const valid =
    label.trim() !== "" &&
    rows.every(
      (row) =>
        row.label.trim() !== "" &&
        row.value.trim() !== "" &&
        Number.isFinite(Number(row.value)),
    );
  return (
    <form
      ref={formRef}
      aria-label={name}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        const data = {
          label: label.trim(),
          values: rows.map((row) => ({
            label: row.label.trim(),
            value: Number(row.value),
            unit: row.unit.trim(),
          })),
        };
        void onSubmit(data, note).then((saved) => {
          if (saved && !initial) {
            setLabel("");
            setRows(rows.map((row) => ({ ...row, value: "" })));
            setNote("");
          }
        });
      }}
    >
      <label className="block">
        <span className="font-medium">Label</span>
        <input
          ref={labelRef}
          required
          maxLength={100}
          autoFocus={autoFocus}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Window A32"
          className={inputClass}
        />
      </label>
      {rows.map((row, index) => (
        <div
          key={row.key}
          role="group"
          aria-label={`Row ${index + 1}`}
          className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2"
        >
          <label className="block">
            <span className="font-medium">Name</span>
            <input
              required
              maxLength={100}
              data-row-name={row.key}
              value={row.label}
              onChange={(event) =>
                changeRow(row.key, { label: event.target.value })
              }
              placeholder="e.g. Width"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="font-medium">Value</span>
            <input
              type="number"
              step="any"
              required
              value={row.value}
              onChange={(event) =>
                changeRow(row.key, { value: event.target.value })
              }
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="font-medium">Unit</span>
            <input
              maxLength={20}
              value={row.unit}
              onChange={(event) =>
                changeRow(row.key, { unit: event.target.value })
              }
              className={inputClass}
            />
          </label>
          <button
            type="button"
            aria-label={`Remove row ${index + 1}`}
            disabled={rows.length === 1}
            onClick={() => {
              // Focus would leave with the removed button; keep it nearby.
              focusNext.current = (rows[index + 1] ?? rows[index - 1])!.key;
              setRows(rows.filter((other) => other.key !== row.key));
            }}
            className="rounded-md border border-gray-300 px-2 py-1.5 disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={rows.length >= 20}
        onClick={() => {
          const added = toRows(undefined, false);
          focusNext.current = added[0]!.key;
          setRows([...rows, ...added]);
        }}
        className="text-xs underline disabled:opacity-50"
      >
        Add row
      </button>
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
