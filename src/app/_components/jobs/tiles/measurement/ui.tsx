// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useState } from "react";
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
 * note), then the list, newest first.
 */
export function MeasurementTileAnswers({
  answers,
  readOnly,
  busy,
  onCreate,
}: AnswersProps<MeasurementConfig, Data>) {
  const measurements = [...answers].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return (
    <div className="space-y-3 text-sm">
      {!readOnly && (
        <MeasurementForm
          name="New measurement"
          busy={busy}
          submitLabel="Add measurement"
          onSubmit={(data, note) => onCreate(data, note)}
        />
      )}
      {measurements.length > 0 && (
        <ul aria-label="Measurements" className="divide-y divide-gray-100">
          {measurements.map((measurement) => (
            <MeasurementRow key={measurement.id} measurement={measurement} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One measurement in the list, with who took it and its note. */
function MeasurementRow({ measurement }: { measurement: Measurement }) {
  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{describe(measurement.data)}</span>
        <AnswerByline answer={measurement} />
      </div>
      {measurement.note && (
        <p className="whitespace-pre-wrap text-gray-700">{measurement.note}</p>
      )}
    </li>
  );
}

/**
 * A label, value, unit (millimetres unless changed) and note for a new
 * measurement. The form clears once it saves, keeping the unit for the next;
 * a failed save keeps what was typed.
 */
function MeasurementForm({
  name,
  busy,
  submitLabel,
  onSubmit,
}: {
  name: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (data: Data, note: string) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("mm");
  const [note, setNote] = useState("");
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
          if (saved) {
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
            required
            maxLength={100}
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
      </div>
    </form>
  );
}
