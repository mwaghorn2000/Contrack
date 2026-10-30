"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "~/trpc/react";

/**
 * A "Delete job" button that asks for confirmation, then deletes the job and
 * goes back to the company's job list.
 */
export default function DeleteJob({
  companyId,
  jobId,
}: {
  companyId: string;
  jobId: string;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const deleteJob = api.job.deleteJob.useMutation({
    onSuccess: async () => {
      // Refreshed first, so the list doesn't flash the deleted job.
      await utils.job.listCompanyJobs.invalidate({ companyId });
      router.push(`/dashboard/jobs?${new URLSearchParams({ companyId })}`);
    },
  });
  // Stays busy after success, until the list opens.
  const busy = deleteJob.isPending || deleteJob.isSuccess;

  return (
    <div className="space-y-3">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={confirming}
        aria-controls="delete-job"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete job
      </button>
      {confirming && (
        <div
          id="delete-job"
          role="group"
          aria-label="Confirm deleting this job"
          className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm text-gray-800">
            Delete this job? Its tiles, photo and acknowledgments will be
            deleted too. This can’t be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => deleteJob.mutate({ jobId })}
              className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {deleteJob.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              // Focus moves here, the safe choice, rather than being lost.
              autoFocus
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                deleteJob.reset();
                triggerRef.current?.focus();
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {deleteJob.error && (
            <p role="alert" className="text-sm text-red-700">
              {deleteJob.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
