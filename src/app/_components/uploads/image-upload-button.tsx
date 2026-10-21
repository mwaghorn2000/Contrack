"use client";

import { useRef, useState } from "react";
import {
  imageFileError,
  type ImageContentType,
  type ImageKind,
} from "~/lib/image-upload";

type UploadTarget = {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

/** Requests an upload URL, sends the file directly to storage, then confirms it. */
export async function uploadImage<T>(
  file: File,
  steps: {
    create: (file: {
      contentType: ImageContentType;
      size: number;
    }) => Promise<UploadTarget>;
    confirm: (key: string) => Promise<T>;
  },
) {
  // The file type was checked by imageFileError before uploading.
  const target = await steps.create({
    contentType: file.type as ImageContentType,
    size: file.size,
  });
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: target.headers,
    body: file,
  });
  if (!response.ok)
    throw new Error("Could not upload the image. Please try again.");
  return steps.confirm(target.key);
}

export default function ImageUploadButton({
  kind,
  label,
  onUpload,
  onRemove,
  hasImage,
  variant = "button",
  iconSize = "md",
  className,
}: {
  kind: ImageKind;
  label: string;
  onUpload: (file: File) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  hasImage?: boolean;
  /** "icon" shows a round pencil button, labelled for screen readers. */
  variant?: "button" | "icon";
  iconSize?: "sm" | "md";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not update the image. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const buttonClass =
    "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      // The error popover needs a positioned wrapper; callers may pass absolute.
      className={variant === "icon" ? (className ?? "relative") : className}
    >
      {variant === "icon" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          aria-label={label}
          title={label}
          aria-busy={pending}
          className={`flex ${iconSize === "sm" ? "size-7" : "size-9"} items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait`}
        >
          {pending ? (
            <span
              aria-hidden="true"
              className={`${iconSize === "sm" ? "size-3" : "size-4"} animate-spin rounded-full border-2 border-white/40 border-t-white`}
            />
          ) : (
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={iconSize === "sm" ? "size-3" : "size-4"}
            >
              <path d="M13.6 2.6a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8l-9.7 9.7a2 2 0 0 1-.9.5l-3.6 1a.75.75 0 0 1-.9-.9l1-3.6a2 2 0 0 1 .5-.9l9.8-9.6Z" />
            </svg>
          )}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className={buttonClass}
          >
            {pending ? "Uploading…" : label}
          </button>
          {onRemove && hasImage && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(onRemove)}
              className={buttonClass}
            >
              Remove
            </button>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const fileError = imageFileError(kind, file);
          if (fileError) {
            setError(fileError);
            return;
          }
          void run(() => onUpload(file));
        }}
      />
      {error && (
        <p
          role="alert"
          className={
            variant === "icon"
              ? "absolute top-full right-0 z-30 mt-2 w-56 rounded-md bg-white p-2 text-left text-xs text-red-700 shadow-md ring-1 ring-gray-200"
              : "mt-1 text-sm text-red-700"
          }
        >
          {error}
        </p>
      )}
    </div>
  );
}
