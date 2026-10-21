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
  className = "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50",
}: {
  kind: ImageKind;
  label: string;
  onUpload: (file: File) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  hasImage?: boolean;
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className={className}
        >
          {pending ? "Uploading…" : label}
        </button>
        {onRemove && hasImage && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(onRemove)}
            className={className}
          >
            Remove
          </button>
        )}
      </div>
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
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
