// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useState } from "react";
import type { z } from "zod";
import type { photosAnswer, photosConfig } from ".";
import { ATTACHMENT_TYPES, pickAttachments } from "~/lib/attachments";
import AnswerByline from "../../answers/answer-byline";
import ConfirmDelete from "../../answers/confirm-delete";
import type { AnswersProps, TileAnswer } from "../define-tile";

type PhotosConfig = z.infer<typeof photosConfig>;
type Data = z.infer<typeof photosAnswer>;
type Entry = TileAnswer<Data>;

const MAX_FILES = 10;

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/** "1.4 MB": a file size people can read. */
function readableSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Tells the job's author that photos are added on the job page. */
export function PhotosTileEditor(_props: {
  config: PhotosConfig;
  onChange: (config: PhotosConfig) => void;
}) {
  return (
    <p className="text-sm text-gray-500">
      People on the job add photos and PDFs on the job page, each batch with an
      optional caption. Use the description to say what to capture.
    </p>
  );
}

/** Nothing to show without photos; the description says it all. */
export function PhotosTileView(_props: { config: PhotosConfig }) {
  return null;
}

/**
 * The gallery on the job page: a form to upload photos or PDFs with a
 * caption, then each batch, newest first, with who added it.
 */
export function PhotosTileAnswers({
  answers,
  readOnly,
  busy,
  onCreate,
  onUpdate,
  onDelete,
  uploadFile,
}: AnswersProps<PhotosConfig, Data>) {
  const entries = [...answers].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return (
    <div className="space-y-4 text-sm">
      {!readOnly && (
        <AddFiles
          onAdd={async (files, caption) => {
            const uploaded = [];
            for (const file of files) uploaded.push(await uploadFile(file));
            return onCreate({}, caption, uploaded);
          }}
        />
      )}
      {entries.length > 0 && (
        <ul aria-label="Photos and files" className="space-y-4">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              readOnly={readOnly}
              busy={busy}
              onUpdate={(caption) => onUpdate(entry.id, {}, caption)}
              onDelete={() => onDelete(entry.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Picks up to ten photos or PDFs (checked when picked) and a caption, then
 * uploads them. A failed upload keeps the files to try again.
 */
function AddFiles({
  onAdd,
}: {
  onAdd: (files: File[], caption: string) => Promise<boolean>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  return (
    <form
      aria-label="Add photos or files"
      className="space-y-2 rounded-md border border-dashed border-gray-300 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (uploading || files.length === 0) return;
        setUploading(true);
        setError("");
        onAdd(files, caption)
          .then((saved) => {
            if (!saved) return;
            setFiles([]);
            setCaption("");
          })
          .catch((cause: unknown) =>
            setError(
              cause instanceof Error ? cause.message : "Could not upload.",
            ),
          )
          .finally(() => setUploading(false));
      }}
    >
      <label className="block">
        <span className="font-medium">Photos or files</span>
        <input
          type="file"
          multiple
          aria-disabled={uploading}
          accept={Object.keys(ATTACHMENT_TYPES).join(",")}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            // Cleared, so picking the same file again still fires onChange.
            event.target.value = "";
            // The files being uploaded can't change part way.
            if (uploading) return;
            const { accepted, error } = pickAttachments(
              picked,
              MAX_FILES - files.length,
              `Add at most ${MAX_FILES} files at a time.`,
            );
            setFiles([...files, ...accepted]);
            setError(error);
          }}
          className="mt-1 block text-sm"
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex gap-2">
              <span className="truncate">{file.name}</span>
              <span className="text-gray-500">{readableSize(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                aria-disabled={uploading}
                onClick={() =>
                  uploading ||
                  setFiles(files.filter((_, other) => other !== index))
                }
                className="text-red-700"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="block">
        <span className="font-medium">Caption</span>{" "}
        <span className="text-gray-500">(optional)</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={files.length === 0}
        aria-disabled={uploading}
        className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 aria-disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}

/**
 * One batch: photos as thumbnails that open full size, PDFs as links, its
 * caption and who added it. Its author can change the caption; its author
 * or an admin can delete it, after confirming.
 */
function EntryCard({
  entry,
  readOnly,
  busy,
  onUpdate,
  onDelete,
}: {
  entry: Entry;
  readOnly: boolean;
  busy: boolean;
  onUpdate: (caption: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"view" | "caption" | "delete">("view");
  const [caption, setCaption] = useState(entry.note ?? "");
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {entry.files.map((file) =>
          !file.url ? (
            <span key={file.id} className="text-gray-500">
              {file.name}
            </span>
          ) : file.contentType.startsWith("image/") ? (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* Signed links change hourly, so next/image can't cache them. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={file.url}
                alt={file.name}
                className="size-28 rounded-md object-cover"
              />
            </a>
          ) : (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-28 flex-col items-center justify-center gap-1 rounded-md border border-gray-200 p-2 text-center text-xs underline"
            >
              <span aria-hidden="true" className="text-2xl">
                📄
              </span>
              <span className="line-clamp-2 break-all">{file.name}</span>
              <span className="text-gray-500 no-underline">
                {readableSize(file.size)}
              </span>
            </a>
          ),
        )}
      </div>
      {mode === "caption" ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            void onUpdate(caption).then((saved) => saved && setMode("view"));
          }}
        >
          <input
            aria-label="Caption for these files"
            autoFocus
            maxLength={2000}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            className={inputClass}
          />
          <button type="submit" aria-disabled={busy} className="underline">
            Save
          </button>
        </form>
      ) : (
        entry.note && (
          <p className="whitespace-pre-wrap text-gray-700">{entry.note}</p>
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <AnswerByline answer={entry} />
        {!readOnly && entry.canEdit && mode === "view" && (
          <button
            type="button"
            onClick={() => setMode("caption")}
            className="text-xs underline"
          >
            Edit caption
          </button>
        )}
        {!readOnly && entry.canDelete && mode === "view" && (
          <button
            type="button"
            onClick={() => setMode("delete")}
            className="text-xs text-red-700 underline"
          >
            Delete
          </button>
        )}
      </div>
      {mode === "delete" && (
        <ConfirmDelete
          label="Confirm deleting these files"
          question="Delete these files?"
          busy={busy}
          onDelete={onDelete}
          onCancel={() => setMode("view")}
        />
      )}
    </li>
  );
}
