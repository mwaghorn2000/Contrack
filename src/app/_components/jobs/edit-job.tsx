"use client";

import Link from "next/link";
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
  if (job.isPending)
    return <p className="text-sm text-gray-500">Loading job…</p>;
  if (job.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{job.error.message}</p>
        <Link
          href={`/dashboard/jobs?${new URLSearchParams({ companyId })}`}
          className="text-sm underline"
        >
          Back to jobs
        </Link>
      </div>
    );
  }
  return <JobBuilder companyId={companyId} job={job.data} />;
}
