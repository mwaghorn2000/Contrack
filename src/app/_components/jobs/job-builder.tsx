"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JobTile } from "~/lib/job-tiles";
import { IMAGE_CONTENT_TYPES } from "~/lib/image-upload";
import JobCanvas from "./job-canvas";
import { useAddJob } from "./jobs-store";
import TilePalette from "./tile-palette";
import { createTile } from "./tiles/registry";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/** Creates a job: its details and photo on top, tile palette beside the canvas. */
export default function JobBuilder({ companyId }: { companyId: string }) {
  const router = useRouter();
  const addJob = useAddJob();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [tiles, setTiles] = useState<JobTile[]>([]);
  const listHref = `/dashboard/jobs?${new URLSearchParams({ companyId })}`;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        addJob(companyId, {
          id: crypto.randomUUID(),
          name: name.trim(),
          description: description.trim(),
          photoUrl,
          memberIds: [],
          tiles,
        });
        router.push(listHref);
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">New job</h1>
        <div className="flex gap-3">
          <Link
            href={listHref}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Save job
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row">
        <label className="flex size-28 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-gray-300 text-xs text-gray-500 focus-within:outline-2 focus-within:outline-gray-900">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt="Job photo"
              width={112}
              height={112}
              unoptimized
              className="size-full object-cover"
            />
          ) : (
            "Add photo"
          )}
          <input
            type="file"
            aria-label="Job photo"
            accept={Object.keys(IMAGE_CONTENT_TYPES).join(",")}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              // A local preview only; photos are uploaded once jobs are saved
              // on the server. A cancelled draft's preview is left to the page.
              if (photoUrl) URL.revokeObjectURL(photoUrl);
              setPhotoUrl(URL.createObjectURL(file));
            }}
          />
        </label>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <label htmlFor="job-name" className="block text-sm font-medium">
              Name
            </label>
            <input
              id="job-name"
              required
              maxLength={99}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Roof inspection"
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="job-description"
              className="block text-sm font-medium"
            >
              Description{" "}
              <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <textarea
              id="job-description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <TilePalette
          onAdd={(type) =>
            setTiles((current) => [...current, createTile(type)])
          }
        />
        <JobCanvas tiles={tiles} onChange={setTiles} />
      </div>
    </form>
  );
}
