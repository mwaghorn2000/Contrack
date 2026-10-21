"use client";

import Link from "next/link";
import { useState } from "react";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";
import ChannelIcon from "./channel-icon";
import ChannelSettingsModal from "./channel-settings-modal";
import { useAddMessageToCache } from "./message-cache";
import MessageComposer from "./message-composer";
import MessageList, { type PendingMessage } from "./message-list";
import { useConversationEvents } from "./use-conversation-events";

type Conversation = RouterOutputs["channel"]["getChannel"];

export default function ConversationView({
  initialConversation,
  backHref,
  currentUserId,
  isCompanyOwner,
}: {
  initialConversation: Conversation;
  backHref: string;
  currentUserId: string;
  isCompanyOwner: boolean;
}) {
  const channelId = initialConversation.id;
  const conversation =
    api.channel.getChannel.useQuery(
      { channelId },
      { initialData: initialConversation },
    ).data ?? initialConversation;
  const { live } = useConversationEvents(channelId);
  const addMessage = useAddMessageToCache(channelId);
  const utils = api.useUtils();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isDirect = conversation.kind === "DIRECT";
  const title = isDirect
    ? (conversation.directUser?.name ?? "Direct message")
    : conversation.name;
  const { permissions } = conversation;
  const canManage =
    permissions.canManageChannel || permissions.canManageMembers;

  return (
    <section
      aria-label={isDirect ? `Conversation with ${title}` : `#${title}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-white"
    >
      <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <Link
          href={backHref}
          className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 md:hidden"
        >
          ← Back
        </Link>
        {isDirect ? (
          <MemberAvatar
            name={title}
            image={conversation.directUser?.image ?? null}
          />
        ) : (
          <ChannelIcon name={title} imageUrl={conversation.imageUrl} />
        )}
        <h1 className="min-w-0 flex-1 truncate font-semibold text-gray-900">
          {title}
        </h1>
        {!isDirect && canManage && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Channel settings"
            title="Channel settings"
            className="flex size-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-5"
            >
              <path
                fillRule="evenodd"
                d="M7.84 1.8A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.8l.3 1.5c.47.2.9.45 1.3.75l1.45-.49a1 1 0 0 1 1.18.45l1.18 2.04a1 1 0 0 1-.2 1.25l-1.15 1.01a6.1 6.1 0 0 1 0 1.5l1.15 1.01a1 1 0 0 1 .2 1.25l-1.18 2.04a1 1 0 0 1-1.18.45l-1.45-.49c-.4.3-.83.55-1.3.75l-.3 1.5a1 1 0 0 1-.98.8H8.82a1 1 0 0 1-.98-.8l-.3-1.5a6 6 0 0 1-1.3-.75l-1.45.49a1 1 0 0 1-1.18-.45L2.43 13.1a1 1 0 0 1 .2-1.25l1.15-1.01a6.1 6.1 0 0 1 0-1.5L2.63 8.33a1 1 0 0 1-.2-1.25l1.18-2.04a1 1 0 0 1 1.18-.45l1.45.49c.4-.3.83-.55 1.3-.75l.3-1.5ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </header>
      <MessageList
        channelId={channelId}
        live={live}
        pending={pending}
        emptyText={
          isDirect
            ? `This is the beginning of your conversation with ${title}.`
            : `No messages in #${title} yet.`
        }
      />
      {permissions.canSendMessages ? (
        <MessageComposer
          channelId={channelId}
          placeholder={isDirect ? `Message ${title}` : `Message #${title}`}
          onPending={setPending}
          onSent={(message) => {
            addMessage(message);
            void utils.channel.listChannels.invalidate();
            void utils.directMessage.list.invalidate();
          }}
        />
      ) : (
        <p className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          You can read this channel but not send messages in it.
        </p>
      )}
      {settingsOpen && (
        <ChannelSettingsModal
          conversation={conversation}
          currentUserId={currentUserId}
          isCompanyOwner={isCompanyOwner}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  );
}
