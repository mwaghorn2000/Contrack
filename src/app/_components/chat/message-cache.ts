"use client";

import { useCallback } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";

type Update = (items: ChatMessage[], pageIndex: number) => ChatMessage[];

function useUpdatePages(channelId: string) {
  const utils = api.useUtils();
  return useCallback(
    (update: Update) =>
      utils.message.list.setInfiniteData({ channelId }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page, index) => ({
                ...page,
                items: update(page.items, index),
              })),
            }
          : data,
      ),
    [utils, channelId],
  );
}

/** Adds a message to the newest page of a conversation, ignoring duplicates. */
export function useAddMessageToCache(channelId: string) {
  const utils = api.useUtils();
  const updatePages = useUpdatePages(channelId);
  return useCallback(
    (message: ChatMessage) => {
      const data = utils.message.list.getInfiniteData({ channelId });
      if (
        data?.pages.some((page) =>
          page.items.some(({ id }) => id === message.id),
        )
      )
        return;
      updatePages((items, index) =>
        index === 0 ? [message, ...items] : items,
      );
    },
    [utils, channelId, updatePages],
  );
}

/** Replaces a message that was edited. */
export function useReplaceMessageInCache(channelId: string) {
  const updatePages = useUpdatePages(channelId);
  return useCallback(
    (message: ChatMessage) =>
      updatePages((items) =>
        items.map((item) => (item.id === message.id ? message : item)),
      ),
    [updatePages],
  );
}

/** Removes a message that was deleted. */
export function useRemoveMessageFromCache(channelId: string) {
  const updatePages = useUpdatePages(channelId);
  return useCallback(
    (messageId: string) =>
      updatePages((items) => items.filter(({ id }) => id !== messageId)),
    [updatePages],
  );
}
