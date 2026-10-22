"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "~/trpc/react";
import ChatDialog from "./chat-dialog";
import PersonLabel from "./person-label";

export default function NewDirectMessageModal({
  companyId,
  currentUserId,
  onClose,
}: {
  companyId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const members = api.invitation.members.useQuery({ companyId });
  const open = api.directMessage.open.useMutation({
    onSuccess({ id }) {
      void utils.directMessage.list.invalidate({ companyId });
      router.push(`/dashboard/dms/${id}?${new URLSearchParams({ companyId })}`);
      onClose();
    },
  });
  const query = search.trim().toLowerCase();
  const people = (members.data ?? []).filter(
    ({ user }) =>
      user.id !== currentUserId &&
      (!query || (user.name ?? "").toLowerCase().includes(query)),
  );

  return (
    <ChatDialog title="New message" busy={open.isPending} onClose={onClose}>
      <label htmlFor="dm-search" className="sr-only">
        Search people
      </label>
      <input
        id="dm-search"
        type="search"
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search people in this company"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900"
      />
      {members.isPending ? (
        <p role="status" className="mt-3 text-sm text-gray-500">
          Loading people…
        </p>
      ) : people.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No matching people.</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {people.map(({ user, role }) => (
            <li key={user.id}>
              <button
                type="button"
                disabled={open.isPending}
                onClick={() => open.mutate({ companyId, userId: user.id })}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <PersonLabel user={user} role={role} bold />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          Couldn’t open the conversation. Please try again.
        </p>
      )}
    </ChatDialog>
  );
}
