// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { z } from "zod";
import type { formAnswer, formConfig, formField } from ".";
import { ATTACHMENT_TYPES, pickAttachments } from "~/lib/attachments";
import AnswerByline from "../../answers/answer-byline";
import ConfirmDelete from "../../answers/confirm-delete";
import type { AnswersProps, TileAnswer } from "../define-tile";

type FormConfig = z.infer<typeof formConfig>;
type Field = z.infer<typeof formField>;
type Kind = Field["kind"];
type Data = z.infer<typeof formAnswer>;
type Submission = TileAnswer<Data>;
type Upload = { key: string; name: string; fieldId?: string };

// Each Files field takes this many photos or PDFs, as fileFields in
// index.ts lets the server allow.
const MAX_FIELD_FILES = 10;

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

// Each kind of field, in the order the Type list shows them.
const KINDS: [Kind, string][] = [
  ["short", "Short text"],
  ["long", "Long text"],
  ["number", "Number"],
  ["yesno", "Yes / no"],
  ["date", "Date"],
  ["choice", "Choice"],
  ["files", "Files"],
];

/** A field changed to another kind, keeping its id, label and required. */
function withKind({ id, label, required }: Field, kind: Kind): Field {
  return kind === "choice"
    ? { id, label, required, kind, options: [] }
    : { id, label, required, kind };
}

/**
 * Lets the job's author write the form's fields and pick who must submit
 * it, from the people who can see the tile, and whether one or all of them.
 */
export function FormTileEditor({
  config,
  people,
  onChange,
}: {
  config: FormConfig;
  people: { id: string; name: string | null }[];
  onChange: (config: FormConfig) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const modeName = useId();
  // The field whose label takes focus once fields change.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-field="${target}"]`)
      ?.focus();
  }, [config.fields]);

  /** Replaces one field with a changed copy. */
  const changeField = (id: string, next: Field) =>
    onChange({
      ...config,
      fields: config.fields.map((field) => (field.id === id ? next : field)),
    });

  return (
    <div ref={listRef} className="space-y-3 text-sm">
      {config.fields.length === 0 && (
        <p className="text-gray-500">No fields yet.</p>
      )}
      {config.fields.map((field, index) => (
        <div
          key={field.id}
          role="group"
          aria-label={`Field ${index + 1}`}
          className="space-y-2 rounded-md border border-gray-200 p-2"
        >
          <div className="grid grid-cols-[2fr_1fr_auto_auto] items-end gap-2">
            <label className="block">
              <span className="font-medium">Label</span>
              <input
                data-field={field.id}
                maxLength={100}
                value={field.label}
                onChange={(event) =>
                  changeField(field.id, { ...field, label: event.target.value })
                }
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="font-medium">Type</span>
              <select
                value={field.kind}
                onChange={(event) =>
                  changeField(
                    field.id,
                    withKind(field, event.target.value as Kind),
                  )
                }
                className={inputClass}
              >
                {KINDS.map(([kind, name]) => (
                  <option key={kind} value={kind}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 pb-2">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) =>
                  changeField(field.id, {
                    ...field,
                    required: event.target.checked,
                  })
                }
                className="size-4"
              />
              Required
            </label>
            <button
              type="button"
              aria-label={`Remove field ${index + 1}`}
              onClick={() => {
                // Keeps keyboard users' place, as removing an item does.
                const neighbour =
                  config.fields[index + 1] ?? config.fields[index - 1];
                focusNext.current = neighbour?.id ?? "add";
                onChange({
                  ...config,
                  fields: config.fields.filter(({ id }) => id !== field.id),
                });
              }}
              className="pb-2 text-red-700"
            >
              ✕
            </button>
          </div>
          {field.kind === "choice" && (
            <label className="block">
              <span className="font-medium">Choices, one per line</span>
              <textarea
                rows={3}
                value={field.options.join("\n")}
                onChange={(event) =>
                  changeField(field.id, {
                    ...field,
                    options: event.target.value.split("\n").slice(0, 30),
                  })
                }
                className={inputClass}
              />
            </label>
          )}
        </div>
      ))}
      {config.fields.length < 50 && (
        <button
          type="button"
          data-field="add"
          onClick={() => {
            const id = crypto.randomUUID();
            focusNext.current = id;
            onChange({
              ...config,
              fields: [
                ...config.fields,
                { id, kind: "short", label: "", required: false },
              ],
            });
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        >
          Add field
        </button>
      )}
      <fieldset className="space-y-1 border-t border-gray-100 pt-2">
        <legend className="mb-1 font-medium">Who must submit</legend>
        {people.length === 0 ? (
          <p className="text-gray-500">
            No one on the job can see this tile yet.
          </p>
        ) : (
          people.map((person) => (
            <label key={person.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.submitters.includes(person.id)}
                onChange={(event) =>
                  onChange({
                    ...config,
                    submitters: event.target.checked
                      ? [...config.submitters, person.id]
                      : config.submitters.filter((id) => id !== person.id),
                  })
                }
                className="size-4"
              />
              {person.name ?? "Unnamed member"}
            </label>
          ))
        )}
        <div className="flex flex-wrap gap-x-4 pt-1">
          {(
            [
              ["one", "Any one of them"],
              ["each", "Each of them"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex items-center gap-2">
              <input
                type="radio"
                name={modeName}
                checked={config.mode === mode}
                onChange={() => onChange({ ...config, mode })}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** The form's fields, without anyone's submissions. */
export function FormTileView({ config }: { config: FormConfig }) {
  if (config.fields.length === 0)
    return <p className="text-sm text-gray-500">No fields yet.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {config.fields.map((field) => (
        <li key={field.id}>{labelOf(field)}</li>
      ))}
    </ul>
  );
}

/** A field's label, or a stand-in while it has none. */
function labelOf(field: Field) {
  return field.label || "Untitled field";
}

/** "Ada, Jaxon": the names of the given people on the job. */
function names(
  ids: string[],
  people: AnswersProps<FormConfig, Data>["people"],
) {
  return ids
    .map(
      (id) =>
        people.find((person) => person.id === id)?.name ?? "Unnamed member",
    )
    .join(", ");
}

/**
 * The form on the job page: who still needs to submit, the form itself for
 * those asked who haven't (or, for any-one forms, until someone has), then
 * each submission. Authors can edit theirs; authors and admins can delete.
 */
export function FormTileAnswers({
  config,
  answers,
  viewer,
  people,
  readOnly,
  busy,
  onCreate,
  onUpdate,
  onDelete,
  uploadFile,
}: AnswersProps<FormConfig, Data>) {
  const submitted = config.submitters.filter((id) =>
    answers.some((answer) => answer.author?.id === id),
  );
  const waiting = config.submitters.filter((id) => !submitted.includes(id));
  const done =
    config.mode === "one" ? answers.length > 0 : waiting.length === 0;
  const canSubmit = !readOnly && !done && waiting.includes(viewer.userId);
  /** Uploads each picked file, then gives them with their field ids. */
  const uploadAll = async (files: { file: File; fieldId: string }[]) => {
    const uploaded: Upload[] = [];
    for (const { file, fieldId } of files)
      uploaded.push({ ...(await uploadFile(file)), fieldId });
    return uploaded;
  };
  return (
    <div className="space-y-4 text-sm">
      {config.submitters.length === 0 ? (
        <p className="text-gray-500">
          No one has been asked to submit this form.
        </p>
      ) : (
        !done && (
          <p className="text-gray-600">
            {config.mode === "one"
              ? `Waiting for one of ${names(waiting, people)}`
              : `${submitted.length} of ${config.submitters.length} submitted · Waiting for ${names(waiting, people)}`}
          </p>
        )
      )}
      {canSubmit && (
        <SubmissionForm
          name="Submit form"
          fields={config.fields}
          busy={busy}
          submitLabel="Submit"
          onSubmit={async (values, added) =>
            onCreate({ values }, undefined, await uploadAll(added))
          }
        />
      )}
      {answers.length > 0 && (
        <ul aria-label="Submissions" className="space-y-4">
          {answers.map((answer) => (
            <SubmissionCard
              key={answer.id}
              submission={answer}
              fields={config.fields}
              readOnly={readOnly}
              busy={busy}
              onUpdate={async (values, added, removed) =>
                onUpdate(answer.id, { values }, undefined, {
                  add: await uploadAll(added),
                  remove: removed,
                })
              }
              onDelete={() => onDelete(answer.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Moves focus from a file's Remove button, about to go, to its field's file
 * picker, so keyboard users keep their place.
 */
function focusFileInput(button: HTMLElement) {
  button
    .closest("[data-files]")
    ?.querySelector<HTMLInputElement>('input[type="file"]')
    ?.focus();
}

/** A filled-in value as shown, e.g. "Yes" for a yes/no field. */
function shown(value: Data["values"][string]) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return `${value}`;
}

/**
 * One submission: each filled-in field and its files, and who sent it. Its
 * author can edit it; its author or an admin can delete it, after confirming.
 */
function SubmissionCard({
  submission,
  fields,
  readOnly,
  busy,
  onUpdate,
  onDelete,
}: {
  submission: Submission;
  fields: Field[];
  readOnly: boolean;
  busy: boolean;
  onUpdate: (
    values: Data["values"],
    added: { file: File; fieldId: string }[],
    removed: string[],
  ) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  // The button that opened the edit form or delete question, which takes
  // focus back once it closes rather than leaving it on the page.
  const refocus = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  useEffect(() => {
    if (mode !== "view") return;
    refocus.current?.current?.focus();
    refocus.current = null;
  }, [mode]);
  /** Goes back to showing the submission, with focus on the given button. */
  const close = (button: RefObject<HTMLButtonElement | null>) => {
    refocus.current = button;
    setMode("view");
  };
  const author = submission.author?.name ?? "Unnamed member";
  if (mode === "edit")
    return (
      <li>
        <SubmissionForm
          name="Edit submission"
          fields={fields}
          busy={busy}
          initial={submission}
          submitLabel="Save"
          onSubmit={async (values, added, removed) => {
            const saved = await onUpdate(values, added, removed);
            if (saved) close(editRef);
            return saved;
          }}
          onCancel={() => close(editRef)}
        />
      </li>
    );
  return (
    <li className="space-y-2 rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-x-2">
        <AnswerByline answer={submission} />
        {!readOnly && submission.canEdit && (
          <button
            ref={editRef}
            type="button"
            aria-label={`Edit submission by ${author}`}
            onClick={() => setMode("edit")}
            className="text-xs underline"
          >
            Edit submission
          </button>
        )}
        {!readOnly && submission.canDelete && (
          <button
            ref={deleteRef}
            type="button"
            aria-label={`Delete submission by ${author}`}
            onClick={() => setMode("delete")}
            className="text-xs text-red-700 underline"
          >
            Delete submission
          </button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {fields.map((field) => {
          const files = submission.files.filter(
            (file) => file.fieldId === field.id,
          );
          const value = submission.data.values[field.id];
          if (field.kind === "files" ? files.length === 0 : value === undefined)
            return null;
          return (
            <div key={field.id} className="contents">
              <dt className="font-medium">{labelOf(field)}</dt>
              {field.kind === "files" ? (
                <dd>
                  <ul>
                    {files.map((file) => (
                      <li key={file.id}>
                        {file.url ? (
                          <a href={file.url} className="underline">
                            {file.name}
                          </a>
                        ) : (
                          file.name
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              ) : (
                <dd className="whitespace-pre-wrap">{shown(value!)}</dd>
              )}
            </div>
          );
        })}
      </dl>
      {mode === "delete" && (
        <ConfirmDelete
          label="Confirm deleting this submission"
          question="Delete this submission?"
          busy={busy}
          onDelete={onDelete}
          onCancel={() => close(deleteRef)}
        />
      )}
    </li>
  );
}

/**
 * The form's fields to fill in, for a new submission or an edit. Required
 * fields are left to the browser to ask for. Files are picked per Files
 * field (checked when picked) and uploaded on submit; an edit can also
 * remove the files already saved. A failed save keeps it all.
 */
function SubmissionForm({
  name,
  fields,
  busy,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  name: string;
  fields: Field[];
  busy: boolean;
  initial?: Submission;
  submitLabel: string;
  onSubmit: (
    values: Data["values"],
    added: { file: File; fieldId: string }[],
    removed: string[],
  ) => Promise<boolean>;
  onCancel?: () => void;
}) {
  // Every value as typed, by field id: numbers and yes/no too, as text.
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial?.data.values ?? {}).map(([id, value]) => [
        id,
        typeof value === "boolean" ? (value ? "yes" : "no") : `${value}`,
      ]),
    ),
  );
  const [added, setAdded] = useState<{ file: File; fieldId: string }[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Names each yes/no field's radios as one group.
  const radioName = useId();
  const kept = (initial?.files ?? []).filter(
    (file) => !removed.includes(file.id),
  );
  /** How many files a Files field will have once saved. */
  const fileCount = (id: string) =>
    kept.filter((file) => file.fieldId === id).length +
    added.filter((file) => file.fieldId === id).length;
  /** The values to save: blank fields are left out. */
  const values = () => {
    const result: Data["values"] = {};
    for (const field of fields) {
      const typedText = typed[field.id] ?? "";
      if (field.kind === "files" || typedText.trim() === "") continue;
      // A choice since taken off the form is dropped, as its list shows.
      if (field.kind === "choice" && !field.options.includes(typedText))
        continue;
      // Choices are saved exactly as the admin wrote them, spaces and all.
      const text = field.kind === "choice" ? typedText : typedText.trim();
      result[field.id] =
        field.kind === "number"
          ? Number(text)
          : field.kind === "yesno"
            ? text === "yes"
            : text;
    }
    return result;
  };
  /** Changes one field's typed value. */
  const type = (id: string, text: string) =>
    setTyped((current) => ({ ...current, [id]: text }));

  return (
    <form
      aria-label={name}
      className="space-y-3 rounded-md border border-dashed border-gray-300 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || saving) return;
        setSaving(true);
        setError("");
        onSubmit(values(), added, removed)
          .then((saved) => {
            if (saved && !initial) {
              setTyped({});
              setAdded([]);
            }
          })
          .catch((cause: unknown) =>
            setError(
              cause instanceof Error ? cause.message : "Could not upload.",
            ),
          )
          .finally(() => setSaving(false));
      }}
    >
      {fields.map((field) => {
        const label = (
          <span className="font-medium">
            {labelOf(field)}
            {field.required && (
              <span className="font-normal text-gray-500"> (required)</span>
            )}
          </span>
        );
        const value = typed[field.id] ?? "";
        switch (field.kind) {
          case "short":
          case "number":
          case "date":
            return (
              <label key={field.id} className="block">
                {label}
                <input
                  type={field.kind === "short" ? "text" : field.kind}
                  required={field.required}
                  step={field.kind === "number" ? "any" : undefined}
                  maxLength={field.kind === "short" ? 200 : undefined}
                  value={value}
                  onChange={(event) => type(field.id, event.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            );
          case "long":
            return (
              <label key={field.id} className="block">
                {label}
                <textarea
                  rows={3}
                  required={field.required}
                  maxLength={5000}
                  value={value}
                  onChange={(event) => type(field.id, event.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            );
          case "choice":
            return (
              <label key={field.id} className="block">
                {label}
                <select
                  required={field.required}
                  value={value}
                  onChange={(event) => type(field.id, event.target.value)}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="">Choose…</option>
                  {field.options
                    .filter((option) => option.trim() !== "")
                    .map((option, index) => (
                      // Two choices can be written the same.
                      <option key={index} value={option}>
                        {option}
                      </option>
                    ))}
                </select>
              </label>
            );
          case "yesno":
            return (
              <fieldset key={field.id}>
                <legend>{label}</legend>
                <div className="mt-1 flex gap-4">
                  {(
                    [
                      ["yes", "Yes"],
                      ["no", "No"],
                    ] as const
                  ).map(([answer, text]) => (
                    <label key={answer} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${radioName}-${field.id}`}
                        required={field.required}
                        checked={value === answer}
                        onChange={() => type(field.id, answer)}
                      />
                      {text}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          case "files":
            return (
              <div key={field.id} data-files className="space-y-1">
                <label className="block">
                  {label}
                  <input
                    type="file"
                    multiple
                    required={field.required && fileCount(field.id) === 0}
                    accept={Object.keys(ATTACHMENT_TYPES).join(",")}
                    onChange={(event) => {
                      const picked = [...(event.target.files ?? [])];
                      // Cleared, so picking the same file again still fires.
                      event.target.value = "";
                      if (saving) return;
                      const { accepted, error } = pickAttachments(
                        picked,
                        MAX_FIELD_FILES - fileCount(field.id),
                        `Add at most ${MAX_FIELD_FILES} files to "${labelOf(field)}".`,
                      );
                      setAdded([
                        ...added,
                        ...accepted.map((file) => ({
                          file,
                          fieldId: field.id,
                        })),
                      ]);
                      setError(error);
                    }}
                    className="mt-1 block text-sm"
                  />
                </label>
                <ul className="space-y-1">
                  {kept
                    .filter((file) => file.fieldId === field.id)
                    .map((file) => (
                      <li key={file.id} className="flex gap-2">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={(event) => {
                            focusFileInput(event.currentTarget);
                            setRemoved([...removed, file.id]);
                          }}
                          className="text-red-700"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  {added
                    .filter((each) => each.fieldId === field.id)
                    .map((each) => (
                      <li
                        key={`${each.file.name}-${added.indexOf(each)}`}
                        className="flex gap-2"
                      >
                        <span className="truncate">{each.file.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${each.file.name}`}
                          onClick={(event) => {
                            focusFileInput(event.currentTarget);
                            setAdded(added.filter((other) => other !== each));
                          }}
                          className="text-red-700"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            );
        }
      })}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          aria-disabled={busy || saving}
          className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white aria-disabled:opacity-50"
        >
          {saving ? "Saving…" : submitLabel}
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
