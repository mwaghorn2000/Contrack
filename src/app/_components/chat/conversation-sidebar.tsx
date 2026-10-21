"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "~/trpc/react";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";
import ChannelIcon from "./channel-icon";
import CreateChannelModal from "./create-channel-modal";
import NewDirectMessageModal from "./new-direct-message-modal";
import { useRealtime } from "./realtime-provider";

export type ChatMode = "channels" | "dms";

const rowClass = (active: boolean) =>
  `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-gray-900 ${
    active
      ? "bg-gray-200 font-medium text-gray-900"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;

export default function ConversationSidebar({
  mode,
  companyId,
  activeId,
  canCreateChannels,
  currentUserId,
}: {
  mode: ChatMode;
  companyId: string;
  activeId: string | null;
  canCreateChannels: boolean;
  currentUserId: string;
}) {
  const [dialog, setDialog] = useState(false);
  const live = useRealtime() !== null;
  // With realtime, lists refresh when something changes; otherwise poll.
  const refetchInterval = live ? 60_000 : 10_000;
  const channels = api.channel.listChannels.useQuery(
    { companyId },
    { enabled: mode === "channels", refetchInterval },
  );
  const directMessages = api.directMessage.list.useQuery(
    { companyId },
    { enabled: mode === "dms", refetchInterval },
  );
  const query = mode === "channels" ? channels : directMessages;
  const href = (id: string) =>
    `/dashboard/${mode === "channels" ? "chat" : "dms"}/${id}?${new URLSearchParams({ companyId })}`;
  const canAdd = mode === "dms" || canCreateChannels;

  return (
    <nav
      aria-label={mode === "channels" ? "Channels" : "Direct messages"}
      className="flex min-h-0 w-full flex-col border-gray-200 bg-gray-50 md:w-64 md:border-r"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">
          {mode === "channels" ? "Channels" : "Direct messages"}
        </h2>
        {canAdd && (
          <button
            type="button"
            onClick={() => setDialog(true)}
            aria-label={mode === "channels" ? "Create channel" : "New message"}
            title={mode === "channels" ? "Create channel" : "New message"}
            className="flex size-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4"
            >
              <path d="M10 3a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 10 3Z" />
            </svg>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {query.isPending ? (
          <p role="status" className="px-2 py-1.5 text-sm text-gray-500">
            Loading…
          </p>
        ) : query.isError ? (
          <div role="status" className="px-2 py-1.5 text-sm text-gray-600">
            <p>Couldn’t load conversations.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-1 rounded font-medium underline"
            >
              Retry
            </button>
          </div>
        ) : mode === "channels" ? (
          channels.data?.length ? (
            <ul className="space-y-0.5">
              {channels.data.map((channel) => (
                <li key={channel.id}>
                  <Link
                    href={href(channel.id)}
                    aria-current={channel.id === activeId ? "page" : undefined}
                    className={rowClass(channel.id === activeId)}
                  >
                    <ChannelIcon
                      name={channel.name}
                      imageUrl={channel.imageUrl}
                      size="sm"
                    />
                    <span className="min-w-0 truncate">{channel.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-1.5 text-sm text-gray-500">
              {canCreateChannels
                ? "No channels yet. Create one with +."
                : "You haven’t been added to any channels yet."}
            </p>
          )
        ) : directMessages.data?.length ? (
          <ul className="space-y-0.5">
            {directMessages.data.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={href(conversation.id)}
                  aria-current={
                    conversation.id === activeId ? "page" : undefined
                  }
                  className={rowClass(conversation.id === activeId)}
                >
                  <MemberAvatar
                    name={conversation.user.name ?? "Member"}
                    image={conversation.user.image}
                  />
                  <span className="min-w-0 truncate">
                    {conversation.user.name ?? "Unnamed member"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-1.5 text-sm text-gray-500">
            No conversations yet. Start one with +.
          </p>
        )}
      </div>
      {dialog &&
        (mode === "channels" ? (
          <CreateChannelModal
            companyId={companyId}
            currentUserId={currentUserId}
            onClose={() => setDialog(false)}
          />
        ) : (
          <NewDirectMessageModal
            companyId={companyId}
            currentUserId={currentUserId}
            onClose={() => setDialog(false)}
          />
        ))}
    </nav>
  );
}
