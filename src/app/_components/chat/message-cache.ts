"use client";

import { useCallback } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";

/** Adds a message to the newest page of a conversation, ignoring duplicates. */
export function useAddMessageToCache(channelId: string) {
  const utils = api.useUtils();
  return useCallback(
    (message: ChatMessage) => {
      utils.message.list.setInfiniteData({ channelId }, (data) => {
        if (!data) return data;
        if (
          data.pages.some((page) =>
            page.items.some(({ id }) => id === message.id),
          )
        )
          return data;
        const [first, ...rest] = data.pages;
        if (!first) return data;
        return {
          ...data,
          pages: [{ ...first, items: [message, ...first.items] }, ...rest],
        };
      });
    },
    [utils, channelId],
  );
}
