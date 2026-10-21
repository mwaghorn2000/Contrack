"use client";

import { useEffect } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";
import { useAddMessageToCache } from "./message-cache";
import { useRealtime } from "./realtime-provider";

/** Receives new messages for the open conversation as they are sent. */
export function useConversationEvents(channelId: string) {
  const realtime = useRealtime();
  const utils = api.useUtils();
  const addMessage = useAddMessageToCache(channelId);

  useEffect(() => {
    if (!realtime) return;
    const name = `private-conversation-${channelId}`;
    let subscribedBefore = false;
    const stopMessages = realtime.listen(name, "message", (data) => {
      const message = data as ChatMessage & { postedAt: string };
      // Events arrive as JSON, so dates are strings.
      addMessage({ ...message, postedAt: new Date(message.postedAt) });
    });
    // After a reconnect, fetch anything sent while the connection was down.
    const stopSubscribed = realtime.listen(
      name,
      "pusher:subscription_succeeded",
      () => {
        if (subscribedBefore) void utils.message.list.invalidate({ channelId });
        subscribedBefore = true;
      },
    );
    return () => {
      stopMessages();
      stopSubscribed();
    };
  }, [realtime, channelId, utils, addMessage]);

  return { live: realtime !== null };
}
