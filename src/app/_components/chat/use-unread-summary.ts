"use client";

import { skipToken } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "~/trpc/react";
import { useRealtime } from "./realtime-provider";

/**
 * Unread totals for the company, kept current by listening for new messages in
 * every conversation the user can read.
 */
export function useUnreadSummary(companyId: string | null) {
  const realtime = useRealtime();
  const utils = api.useUtils();
  const summary = api.message.unreadSummary.useQuery(
    companyId ? { companyId } : skipToken,
    // With realtime, refresh when a message arrives; otherwise poll.
    { refetchInterval: realtime ? 60_000 : 15_000 },
  );
  const conversationKey = summary.data?.conversationIds.join(",") ?? "";

  useEffect(() => {
    if (!realtime || !conversationKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several messages in quick succession need only one refresh.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void utils.message.unreadSummary.invalidate();
        void utils.channel.listChannels.invalidate();
        void utils.directMessage.list.invalidate();
      }, 300);
    };
    const stops = conversationKey
      .split(",")
      .map((id) =>
        realtime.listen(`private-conversation-${id}`, "message", refresh),
      );
    return () => {
      clearTimeout(timer);
      for (const stop of stops) stop();
    };
  }, [realtime, conversationKey, utils]);

  return summary.data;
}
