"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useCallback } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";

type Update = (items: ChatMessage[], pageIndex: number) => ChatMessage[];

function useUpdatePages(channelId: string) {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  return useCallback(
    (update: Update) => {
      // A fetch that started before this change would overwrite it with
      // stale messages, so cancel it and fetch again afterwards.
      const queryKey = getQueryKey(api.message.list, { channelId }, "infinite");
      const stale = queryClient.isFetching({ queryKey }) > 0;
      if (stale) void utils.message.list.cancel({ channelId });
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
      );
      if (stale) void utils.message.list.invalidate({ channelId });
    },
    [utils, queryClient, channelId],
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
