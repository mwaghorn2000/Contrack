"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadImage } from "~/app/_components/uploads/image-upload-button";
import { keepJobMembers } from "~/lib/job-tiles";
import type { JobTile } from "./tiles/registry";
import { IMAGE_CONTENT_TYPES } from "~/lib/image-upload";
import { api, type RouterOutputs } from "~/trpc/react";
import JobMembers from "./job-members";
import TileBoard from "./tile-board";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/**
 * Creates a job, or edits `job` when given: its details and photo on top, tile
 * palette beside the canvas. A chosen photo is uploaded once the job is saved.
 */
export default function JobBuilder({
  companyId,
  job,
}: {
  companyId: string;
  job?: RouterOutputs["job"]["getJob"];
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const createJob = api.job.createJob.useMutation();
  const updateJob = api.job.updateJob.useMutation();
  const createPhotoUpload = api.job.createPhotoUpload.useMutation();
  const setPhoto = api.job.setPhoto.useMutation();
  // The ref stops a second submit before the disabled button re-renders.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(job?.title ?? "");
  const [description, setDescription] = useState(job?.description ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState(job?.photoUrl ?? null);
  const [memberIds, setMemberIds] = useState(job?.memberIds ?? []);
  const [tiles, setTiles] = useState<JobTile[]>(job?.tiles ?? []);
  const companyMembers = api.invitation.members.useQuery({ companyId });
  const people = (companyMembers.data ?? [])
    .filter(({ user }) => memberIds.includes(user.id))
    .map(({ user }) => user);
  const query = new URLSearchParams({ companyId });
  const cancelHref = job
    ? `/dashboard/jobs/${job.id}?${query}`
    : `/dashboard/jobs?${query}`;

  return (
    <form
      className="space-y-6"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving.current || !title.trim()) return;
        saving.current = true;
        setBusy(true);
        const fields = {
          title: title.trim(),
          description: description.trim(),
          memberIds,
          tiles,
        };
        let id: string;
        try {
          ({ id } = job
            ? await updateJob.mutateAsync({ jobId: job.id, ...fields })
            : await createJob.mutateAsync({ companyId, ...fields }));
        } catch {
          // Shown from the mutation's error below; the user can try again.
          saving.current = false;
          setBusy(false);
          return;
        }
        const opened = new URLSearchParams(query);
        if (photoFile) {
          try {
            await uploadImage(photoFile, "banner", {
              create: (file) =>
                createPhotoUpload.mutateAsync({ jobId: id, ...file }),
              confirm: (key) => setPhoto.mutateAsync({ jobId: id, key }),
            });
          } catch {
            // The job is saved, so open it and say the photo is missing.
            opened.set("photo", "failed");
          }
        }
        // Refreshed first, so the job page doesn't flash the old details.
        await utils.job.invalidate();
        // Stays busy until the job page opens, so it can't be saved twice.
        router.push(`/dashboard/jobs/${id}?${opened}`);
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">
          {job ? "Edit job" : "New job"}
        </h1>
        <div className="flex gap-3">
          <Link
            href={cancelHref}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!title.trim() || busy}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save job"}
          </button>
        </div>
      </div>
      {(createJob.error ?? updateJob.error) && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {(createJob.error ?? updateJob.error)?.message}
        </p>
      )}
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
              // A local preview until the job is saved. A cancelled draft's
              // preview is left to the page. The saved job's own photo stays,
              // in case the edit is cancelled.
              if (photoUrl && photoUrl !== job?.photoUrl)
                URL.revokeObjectURL(photoUrl);
              setPhotoFile(file);
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
              value={title}
              onChange={(event) => setTitle(event.target.value)}
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
      <JobMembers
        companyId={companyId}
        memberIds={memberIds}
        onChange={(ids) => {
          setMemberIds(ids);
          // People taken off the job can no longer be picked for tiles.
          setTiles((current) => keepJobMembers(current, ids));
        }}
      />
      <TileBoard tiles={tiles} people={people} onChange={setTiles} />
    </form>
  );
}
