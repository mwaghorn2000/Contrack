"use client";

import { api } from "~/trpc/react";
import PersonLabel from "../chat/person-label";

/** A collapsible checklist of company members, for choosing who is on a job. */
export default function JobMembers({
  companyId,
  memberIds,
  onChange,
}: {
  companyId: string;
  memberIds: string[];
  onChange: (memberIds: string[]) => void;
}) {
  const members = api.invitation.members.useQuery({ companyId });
  return (
    <details className="rounded-lg border border-gray-200 bg-white" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-900">
        Members{" "}
        <span className="font-normal text-gray-500">
          ({memberIds.length} selected)
        </span>
      </summary>
      <div className="border-t border-gray-100 p-4">
        {members.isPending ? (
          <p role="status" className="text-sm text-gray-500">
            Loading people…
          </p>
        ) : members.isError ? (
          <div className="text-sm text-gray-600">
            <p role="status">Couldn’t load people.</p>
            <button
              type="button"
              onClick={() => void members.refetch()}
              className="mt-2 rounded underline"
            >
              Retry
            </button>
          </div>
        ) : members.data.length === 0 ? (
          <p className="text-sm text-gray-500">
            No one is in this company yet.
          </p>
        ) : (
          <ul
            role="group"
            aria-label="Job members"
            className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2"
          >
            {members.data.map(({ user, role }) => (
              <li key={user.id} className="min-w-0">
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(user.id)}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...memberIds, user.id]
                          : memberIds.filter((id) => id !== user.id),
                      )
                    }
                    className="size-4"
                  />
                  <PersonLabel user={user} role={role} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
