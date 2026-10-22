"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useMemo } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api, type RouterOutputs } from "~/trpc/react";

type Page = RouterOutputs["message"]["list"];

/** Adds, replaces and removes messages in a conversation's cached pages, e.g. for realtime events. */
export function useMessageCache(channelId: string) {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  return useMemo(() => {
    // Applies an update to the cached pages, if the conversation is loaded.
    function updatePages(update: (pages: Page[]) => Page[]) {
      // A fetch that started before this change would overwrite it with
      // stale messages. Invalidating after the update cancels that fetch
      // synchronously (silently, so the update isn't reverted) and starts a
      // fresh one, so it must run after setInfiniteData, not before.
      const queryKey = getQueryKey(api.message.list, { channelId }, "infinite");
      const stale = queryClient.isFetching({ queryKey }) > 0;
      utils.message.list.setInfiniteData({ channelId }, (data) =>
        data ? { ...data, pages: update(data.pages) } : data,
      );
      if (stale) void utils.message.list.invalidate({ channelId });
    }

    // Applies an update to every page's messages.
    function updateItems(update: (items: ChatMessage[]) => ChatMessage[]) {
      updatePages((pages) =>
        pages.map((page) => ({ ...page, items: update(page.items) })),
      );
    }

    return {
      /** Adds a message to the newest page, ignoring duplicates. */
      add(message: ChatMessage) {
        updatePages((pages) =>
          pages.some((page) => page.items.some(({ id }) => id === message.id))
            ? pages
            : pages.map((page, index) =>
                index === 0
                  ? { ...page, items: [message, ...page.items] }
                  : page,
              ),
        );
      },
      /** Replaces a message that was edited. */
      replace(message: ChatMessage) {
        updateItems((items) =>
          items.map((item) => (item.id === message.id ? message : item)),
        );
      },
      /** Removes a message that was deleted. */
      remove(messageId: string) {
        updateItems((items) => items.filter(({ id }) => id !== messageId));
      },
    };
  }, [utils, queryClient, channelId]);
}
