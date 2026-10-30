"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { isManagerRole } from "~/lib/company-roles";
import { canSeeTile } from "~/lib/job-tiles";
import { api } from "~/trpc/react";
import { definitionFor } from "./tiles/registry";

/**
 * A job as someone on it sees it: its details, who is on it, and only the
 * tiles that person is allowed to see. Owners and admins can edit the job and
 * preview it as one of its members.
 */
export default function JobView({
  companyId,
  jobId,
  viewer,
  photoFailed = false,
}: {
  companyId: string;
  jobId: string;
  viewer: { userId: string; isManager: boolean };
  photoFailed?: boolean;
}) {
  const fetched = api.job.getJob.useQuery({ jobId });
  const members = api.invitation.members.useQuery({ companyId });
  const [previewId, setPreviewId] = useState("");
  const query = new URLSearchParams({ companyId });
  const listHref = `/dashboard/jobs?${query}`;

  if (fetched.isPending)
    return <p className="text-sm text-gray-500">Loading job…</p>;
  if (fetched.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{fetched.error.message}</p>
        <Link href={listHref} className="text-sm underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const job = fetched.data;
  const people = (members.data ?? []).filter(({ user }) =>
    job.memberIds.includes(user.id),
  );
  const previewed = people.find(({ user }) => user.id === previewId);
  // Previewing uses that person's company role, so admins still see it all.
  const shownTo = previewed
    ? {
        userId: previewed.user.id,
        isManager: isManagerRole(previewed.role),
      }
    : viewer;
  const tiles = job.tiles.filter((tile) => canSeeTile(tile, shownTo));

  return (
    <article className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={listHref} className="text-sm text-gray-600 underline">
          ← Jobs
        </Link>
        {viewer.isManager && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Preview as
              <select
                value={previewId}
                onChange={(event) => setPreviewId(event.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">You (every tile)</option>
                {people.map(({ user }) => (
                  <option key={user.id} value={user.id}>
                    {user.name ?? "Unnamed member"}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href={`/dashboard/jobs/${job.id}/edit?${query}`}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Edit
            </Link>
          </div>
        )}
      </div>
      {photoFailed && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          Job saved, but the photo couldn’t be uploaded. Edit the job to try
          again.
        </p>
      )}
      {previewed && (
        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Previewing as {previewed.user.name ?? "Unnamed member"}. You see only
          the tiles they can see.
        </p>
      )}
      <header className="flex flex-col gap-4 sm:flex-row">
        {job.photoUrl && (
          <Image
            src={job.photoUrl}
            alt=""
            width={160}
            height={160}
            unoptimized
            className="size-40 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold break-words text-gray-900">
            {job.title}
          </h1>
          {job.description && (
            <p className="text-sm whitespace-pre-wrap text-gray-700">
              {job.description}
            </p>
          )}
          <p className="text-sm text-gray-500">
            {job.memberIds.length === 0
              ? "No one is on this job yet."
              : members.isPending
                ? "Loading people…"
                : `On this job: ${people.map(({ user }) => user.name ?? "Unnamed member").join(", ")}`}
          </p>
        </div>
      </header>
      {tiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Nothing to show on this job yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {tiles.map((tile) => {
            const { label, icon, View } = definitionFor(tile);
            return (
              <li key={tile.id}>
                <section
                  aria-label={label}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    <span aria-hidden="true">{icon}</span>
                    {label}
                  </h2>
                  <View config={tile.config} />
                </section>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
