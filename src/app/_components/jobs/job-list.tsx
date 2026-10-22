"use client";

import Link from "next/link";
import JobCard from "./job-card";
import { useCompanyJobs } from "./jobs-store";

/** The Jobs tab: a grid of the company's jobs, with "New job" for admins. */
export default function JobList({
  companyId,
  canManage,
}: {
  companyId: string;
  canManage: boolean;
}) {
  const jobs = useCompanyJobs(companyId);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Jobs</h1>
        {canManage && (
          <Link
            href={`/dashboard/jobs/new?${new URLSearchParams({ companyId })}`}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            New job
          </Link>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No jobs yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/dashboard/jobs/${job.id}?${new URLSearchParams({ companyId })}`}
                className="block rounded-lg hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
              >
                <JobCard job={job} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
