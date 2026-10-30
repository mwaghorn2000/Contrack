"use client";

import Link from "next/link";
import JobBuilder from "./job-builder";
import { useJob } from "./jobs-store";

/** Opens a saved job in the builder, or says it can't be found. */
export default function EditJob({
  companyId,
  jobId,
}: {
  companyId: string;
  jobId: string;
}) {
  const job = useJob(companyId, jobId);
  if (!job) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Job not found.</p>
        <Link
          href={`/dashboard/jobs?${new URLSearchParams({ companyId })}`}
          className="text-sm underline"
        >
          Back to jobs
        </Link>
      </div>
    );
  }
  return <JobBuilder companyId={companyId} job={job} />;
}
