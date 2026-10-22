"use client";

import Image from "next/image";
import Link from "next/link";
import { canSeeTile } from "~/lib/job-tiles";
import { api } from "~/trpc/react";
import { useJob } from "./jobs-store";
import { definitionFor } from "./tiles/registry";

/**
 * A job as someone on it sees it: its details, who is on it, and only the
 * tiles that person is allowed to see.
 */
export default function JobView({
  companyId,
  jobId,
  viewer,
}: {
  companyId: string;
  jobId: string;
  viewer: { userId: string; isManager: boolean };
}) {
  const job = useJob(companyId, jobId);
  const members = api.invitation.members.useQuery({ companyId });
  const listHref = `/dashboard/jobs?${new URLSearchParams({ companyId })}`;

  if (!job) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Job not found.</p>
        <Link href={listHref} className="text-sm underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const people = (members.data ?? []).filter(({ user }) =>
    job.memberIds.includes(user.id),
  );
  const tiles = job.tiles.filter((tile) => canSeeTile(tile, viewer));

  return (
    <article className="max-w-3xl space-y-6">
      <Link href={listHref} className="text-sm text-gray-600 underline">
        ← Jobs
      </Link>
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
            {job.name}
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
