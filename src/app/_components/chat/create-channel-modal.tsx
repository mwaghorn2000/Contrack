"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "~/trpc/react";
import ChatDialog from "./chat-dialog";
import PersonLabel from "./person-label";

export default function CreateChannelModal({
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
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const members = api.invitation.members.useQuery({ companyId });
  const create = api.channel.createChannel.useMutation({
    onSuccess(channel) {
      void utils.channel.listChannels.invalidate({ companyId });
      router.push(
        `/dashboard/chat/${channel.id}?${new URLSearchParams({ companyId })}`,
      );
      onClose();
    },
  });
  const others = (members.data ?? []).filter(
    ({ user }) => user.id !== currentUserId,
  );

  return (
    <ChatDialog
      title="Create channel"
      description="People you add can send messages. You can change permissions later."
      busy={create.isPending}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || create.isPending) return;
          create.mutate({
            companyId,
            name: name.trim(),
            memberIds: [...selected],
          });
        }}
      >
        <div>
          <label htmlFor="channel-name" className="block text-sm font-medium">
            Channel name
          </label>
          <input
            id="channel-name"
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={create.isPending}
            placeholder="e.g. site-updates"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50"
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">
            Members{" "}
            <span className="font-normal text-gray-500">(optional)</span>
          </legend>
          <p className="text-xs text-gray-500">
            The company owner can always see every channel.
          </p>
          {members.isPending ? (
            <p role="status" className="mt-2 text-sm text-gray-500">
              Loading people…
            </p>
          ) : others.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              No one else is in this company yet.
            </p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-1">
              {others.map(({ user, role }) => (
                <li key={user.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selected.has(user.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(user.id);
                          else next.delete(user.id);
                          return next;
                        })
                      }
                      className="size-4"
                    />
                    <PersonLabel user={user} role={role} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        {create.isError && (
          <p role="alert" className="text-sm text-red-600">
            {create.error.data?.code === "CONFLICT"
              ? "A channel with this name already exists."
              : "Couldn’t create the channel. Please try again."}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create channel"}
          </button>
        </div>
      </form>
    </ChatDialog>
  );
}
