"use client";

import { useEffect } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";
import {
  useAddMessageToCache,
  useRemoveMessageFromCache,
  useReplaceMessageInCache,
} from "./message-cache";
import { useRealtime } from "./realtime-provider";

type MessageEvent = ChatMessage & {
  postedAt: string;
  editedAt: string | null;
};

// Events arrive as JSON, so dates are strings.
function parseMessage(data: unknown): ChatMessage {
  const message = data as MessageEvent;
  return {
    ...message,
    postedAt: new Date(message.postedAt),
    editedAt: message.editedAt ? new Date(message.editedAt) : null,
  };
}

/** Receives new, edited and deleted messages for the open conversation. */
export function useConversationEvents(channelId: string) {
  const realtime = useRealtime();
  const utils = api.useUtils();
  const addMessage = useAddMessageToCache(channelId);
  const replaceMessage = useReplaceMessageInCache(channelId);
  const removeMessage = useRemoveMessageFromCache(channelId);

  useEffect(() => {
    if (!realtime) return;
    const name = `private-conversation-${channelId}`;
    let subscribedBefore = false;
    const stops = [
      realtime.listen(name, "message", (data) =>
        addMessage(parseMessage(data)),
      ),
      realtime.listen(name, "message-updated", (data) =>
        replaceMessage(parseMessage(data)),
      ),
      realtime.listen(name, "message-deleted", (data) =>
        removeMessage((data as { id: string }).id),
      ),
      // After a reconnect, fetch anything sent while the connection was down.
      realtime.listen(name, "pusher:subscription_succeeded", () => {
        if (subscribedBefore) void utils.message.list.invalidate({ channelId });
        subscribedBefore = true;
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [realtime, channelId, utils, addMessage, replaceMessage, removeMessage]);

  return { live: realtime !== null };
}
