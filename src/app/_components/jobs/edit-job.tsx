"use client";

import Link from "next/link";
import DeleteJob from "./delete-job";
import JobBuilder from "./job-builder";
import { api } from "~/trpc/react";

/** Loads a saved job into the builder, or says why it can't be opened. */
export default function EditJob({
  companyId,
  jobId,
}: {
  companyId: string;
  jobId: string;
}) {
  const job = api.job.getJob.useQuery({ jobId });
  // Checked first, so a failed background refetch can't wipe unsaved edits,
  // unless the job is gone (e.g. deleted) and there's nothing left to save.
  if (job.data && job.error?.data?.code !== "NOT_FOUND")
    return (
      <div className="space-y-8">
        <JobBuilder companyId={companyId} job={job.data} />
        <DeleteJob companyId={companyId} jobId={jobId} />
      </div>
    );
  if (job.isPending)
    return <p className="text-sm text-gray-500">Loading job…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{job.error?.message}</p>
      <Link
        href={`/dashboard/jobs?${new URLSearchParams({ companyId })}`}
        className="text-sm underline"
      >
        Back to jobs
      </Link>
    </div>
  );
}
