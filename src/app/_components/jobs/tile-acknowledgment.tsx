"use client";

import { useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";

type Status = RouterOutputs["job"]["getJob"]["acknowledgments"][string];

/**
 * Shown under a tile that asks for acknowledgment: a button for the people it
 * asks, and for owners and admins, how many have acknowledged and who.
 */
export default function TileAcknowledgment({
  jobId,
  tileId,
  status,
}: {
  jobId: string;
  tileId: string;
  status: Status;
}) {
  const utils = api.useUtils();
  const [listOpen, setListOpen] = useState(false);
  const mutation = api.job.setTileAcknowledgment.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.job.getJob.invalidate({ jobId }),
        utils.job.getTileAcknowledgments.invalidate({ tileId }),
      ]),
  });
  // Shows the choice straight away, while it saves.
  const acknowledged = mutation.isPending
    ? mutation.variables.acknowledged
    : status.acknowledged;
  if (!status.needed && !status.summary) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {status.needed && (
          <button
            type="button"
            aria-pressed={acknowledged}
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({ tileId, acknowledged: !acknowledged })
            }
            className={`rounded-md border px-3 py-1.5 font-medium disabled:opacity-50 ${
              acknowledged
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            {acknowledged ? "Acknowledged" : "Acknowledge"}
          </button>
        )}
        {status.summary && (
          <button
            type="button"
            aria-expanded={listOpen}
            onClick={() => setListOpen((open) => !open)}
            className="text-gray-600 underline"
          >
            {status.summary.acknowledged} of {status.summary.total} acknowledged
          </button>
        )}
      </div>
      {mutation.error && (
        <p role="alert" className="text-red-700">
          Could not update your acknowledgment. Please try again.
        </p>
      )}
      {listOpen && <AcknowledgmentList tileId={tileId} />}
    </div>
  );
}

/** Who a tile asks to acknowledge it, split into who has and who hasn't. */
function AcknowledgmentList({ tileId }: { tileId: string }) {
  // Polled like the job, so it keeps up with the count above it.
  const list = api.job.getTileAcknowledgments.useQuery(
    { tileId },
    { refetchInterval: 7_500 },
  );
  if (list.isPending)
    return (
      <p role="status" className="text-gray-500">
        Loading…
      </p>
    );
  if (list.isError)
    return (
      <p role="alert" className="text-gray-600">
        Could not load acknowledgments.
      </p>
    );
  const names = (done: boolean) =>
    list.data
      .filter(({ acknowledgedAt }) => (acknowledgedAt !== null) === done)
      .map(({ user }) => user.name ?? "Unnamed member")
      .join(", ") || "No one";
  return (
    <div className="space-y-1 text-gray-600">
      <p>Acknowledged: {names(true)}</p>
      <p>Waiting on: {names(false)}</p>
    </div>
  );
}
