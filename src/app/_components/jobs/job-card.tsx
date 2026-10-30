import Image from "next/image";
import type { RouterOutputs } from "~/trpc/react";

type ListedJob = RouterOutputs["job"]["listCompanyJobs"][number];

/** A summary of one job: photo, title, first line of description and team size. */
export default function JobCard({ job }: { job: ListedJob }) {
  const summary = job.description?.split("\n")[0];
  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {job.photoUrl ? (
        <Image
          src={job.photoUrl}
          alt=""
          width={640}
          height={256}
          unoptimized
          className="h-32 w-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-32 items-center justify-center bg-gray-100 text-3xl font-semibold text-gray-400"
        >
          {job.title.trim()[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <div className="space-y-1 p-4">
        <h2 className="truncate font-medium text-gray-900">{job.title}</h2>
        {summary && <p className="truncate text-sm text-gray-600">{summary}</p>}
        <p className="text-xs text-gray-500">
          {plural(job.memberCount, "member")}
        </p>
      </div>
    </article>
  );
}

/** Formats a count with its noun, e.g. "1 tile" or "3 tiles". */
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
