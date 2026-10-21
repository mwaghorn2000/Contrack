"use client";

import { useEffect } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";
import { useRealtime } from "./realtime-provider";
import { useAddMessageToCache } from "./message-cache";

/** Receives new messages for the open conversation as they are sent. */
export function useConversationEvents(channelId: string) {
  const pusher = useRealtime();
  const utils = api.useUtils();
  const addMessage = useAddMessageToCache(channelId);

  useEffect(() => {
    if (!pusher) return;
    const name = `private-conversation-${channelId}`;
    const channel = pusher.subscribe(name);
    let subscribedBefore = false;
    const onMessage = (message: ChatMessage & { postedAt: string | Date }) => {
      // Events arrive as JSON, so dates are strings.
      addMessage({ ...message, postedAt: new Date(message.postedAt) });
      void utils.channel.listChannels.invalidate();
      void utils.directMessage.list.invalidate();
    };
    // After a reconnect, fetch anything sent while the connection was down.
    const onSubscribed = () => {
      if (subscribedBefore) void utils.message.list.invalidate({ channelId });
      subscribedBefore = true;
    };
    channel.bind("message", onMessage);
    channel.bind("pusher:subscription_succeeded", onSubscribed);
    return () => {
      channel.unbind("message", onMessage);
      channel.unbind("pusher:subscription_succeeded", onSubscribed);
      pusher.unsubscribe(name);
    };
  }, [pusher, channelId, utils, addMessage]);

  return { live: pusher !== null };
}
