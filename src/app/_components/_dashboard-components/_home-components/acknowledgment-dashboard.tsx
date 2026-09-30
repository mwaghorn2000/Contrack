"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "~/trpc/react";
import MemberAvatar from "./member-avatar";

export default function AcknowledgmentDashboard({
  companyId,
  postId,
  title,
  onClose,
}: {
  companyId: string;
  postId: string;
  title: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [filter, setFilter] = useState<"acknowledged" | "pending">(
    "acknowledged",
  );
  const [search, setSearch] = useState("");
  const members = api.company.getPostAcknowledgments.useQuery(
    { companyId, postId },
    {
      refetchOnMount: "always",
      refetchInterval: 15_000,
    },
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const all = members.data ?? [];
  const acknowledged = all.filter(
    (member) => member.acknowledgedAt !== null,
  ).length;
  const visible = all.filter(
    (member) =>
      (filter === "acknowledged"
        ? member.acknowledgedAt !== null
        : member.acknowledgedAt === null) &&
      `${member.name ?? ""} ${member.email ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-xl backdrop:bg-black/40 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold">
            Post acknowledgments
          </h2>
          <p className="mt-1 text-sm break-words text-gray-600">{title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
        >
          Close
        </button>
      </div>

      {members.isPending && (
        <p role="status" className="mt-6 text-sm text-gray-500">
          Loading acknowledgments…
        </p>
      )}
      {members.isError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <p>Could not load acknowledgments.</p>
          <button
            type="button"
            onClick={() => void members.refetch()}
            disabled={members.isFetching}
            className="mt-2 rounded font-medium underline focus-visible:outline-2 disabled:opacity-50"
          >
            {members.isFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}
      {members.data && !members.isError && (
        <>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium">
              {acknowledged} of {all.length} members acknowledged
            </p>
            <progress
              value={acknowledged}
              max={Math.max(all.length, 1)}
              aria-label="Acknowledgment progress"
              className="mt-3 h-2 w-full accent-gray-900"
            />
            <p className="mt-2 text-xs text-gray-500">
              Based on current company membership. Updates every 15 seconds.
            </p>
          </div>
          <div
            className="mt-5 flex flex-wrap gap-2"
            role="group"
            aria-label="Filter acknowledgment status"
          >
            {(["acknowledged", "pending"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 ${filter === value ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {value === "acknowledged"
                  ? `Acknowledged (${acknowledged})`
                  : `Not yet (${all.length - acknowledged})`}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm font-medium">
            Search members
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or email"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal focus-visible:outline-2 focus-visible:outline-gray-900"
            />
          </label>
          <ul className="mt-4 divide-y divide-gray-200">
            {visible.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3">
                <MemberAvatar
                  name={member.name ?? member.email ?? "Company member"}
                  image={member.image}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium break-words">
                    {member.name ?? member.email ?? "Company member"}
                  </p>
                  {member.name && member.email && (
                    <p className="break-words text-gray-500">{member.email}</p>
                  )}
                  {member.acknowledgedAt && (
                    <time
                      dateTime={member.acknowledgedAt.toISOString()}
                      className="text-xs text-gray-500"
                    >
                      Acknowledged{" "}
                      {member.acknowledgedAt.toLocaleString("en-AU")}
                    </time>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {visible.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">
              {search.trim()
                ? "No members match your search."
                : filter === "acknowledged"
                  ? "No one has acknowledged this post yet."
                  : "Everyone has acknowledged this post."}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
