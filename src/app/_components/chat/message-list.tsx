"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";
import MessageItem from "./message-item";

export type PendingMessage = {
  id: string;
  label: string;
  failed: boolean;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function MessageList({
  channelId,
  currentUserId,
  live,
  pending,
  emptyText,
  onNewestChange,
}: {
  channelId: string;
  currentUserId: string;
  live: boolean;
  pending: PendingMessage[];
  emptyText: string;
  /** Called when the newest loaded message changes, e.g. to mark it read. */
  onNewestChange: (messageId: string) => void;
}) {
  const messages = api.message.list.useInfiniteQuery(
    { channelId },
    {
      getNextPageParam: (page) => page.nextCursor,
      // Without realtime, check for new messages regularly instead.
      refetchInterval: live ? false : 5_000,
    },
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const heightBeforeOlder = useRef<number | null>(null);

  // Pages are newest first; show the conversation oldest first.
  const items = useMemo(
    () => (messages.data?.pages.flatMap((page) => page.items) ?? []).reverse(),
    [messages.data],
  );
  const newestId = items.at(-1)?.id;
  const oldestId = items[0]?.id;

  // Load older messages when the top of the conversation scrolls into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages;
  useEffect(() => {
    const top = topRef.current;
    if (!top || !hasNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || isFetchingNextPage) return;
      heightBeforeOlder.current = scrollRef.current?.scrollHeight ?? null;
      void fetchNextPage();
    });
    observer.observe(top);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Keep the same messages in view after older ones are added above them.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || heightBeforeOlder.current === null) return;
    scroll.scrollTop += scroll.scrollHeight - heightBeforeOlder.current;
    heightBeforeOlder.current = null;
  }, [oldestId]);

  useEffect(() => {
    if (newestId) onNewestChange(newestId);
  }, [newestId, onNewestChange]);

  // Follow new messages while the reader is at the bottom.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && nearBottom.current) scroll.scrollTop = scroll.scrollHeight;
  }, [newestId, pending.length]);

  if (messages.isPending)
    return (
      <p role="status" className="flex-1 p-4 text-sm text-gray-500">
        Loading messages…
      </p>
    );
  if (messages.isError)
    return (
      <div role="status" className="flex-1 p-4 text-sm text-gray-600">
        <p>Couldn’t load messages.</p>
        <button
          type="button"
          onClick={() => void messages.refetch()}
          className="mt-1 rounded font-medium underline"
        >
          Retry
        </button>
      </div>
    );

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const scroll = event.currentTarget;
        nearBottom.current =
          scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto py-4"
      aria-live="polite"
    >
      <div ref={topRef} />
      {isFetchingNextPage && (
        <p
          role="status"
          className="px-4 py-2 text-center text-xs text-gray-500"
        >
          Loading older messages…
        </p>
      )}
      {!hasNextPage && items.length > 0 && (
        <p className="px-4 pb-2 text-center text-xs text-gray-400">
          This is the start of the conversation.
        </p>
      )}
      {items.length === 0 && pending.length === 0 && (
        <p className="px-4 text-sm text-gray-500">{emptyText}</p>
      )}
      <ol aria-label="Messages">
        {items.map((message, index) => {
          const previous: ChatMessage | undefined = items[index - 1];
          const newDay =
            !previous || !sameDay(previous.postedAt, message.postedAt);
          const compact =
            !newDay &&
            previous?.author.id === message.author.id &&
            message.postedAt.getTime() - previous.postedAt.getTime() <
              GROUP_WINDOW_MS;
          return (
            <li key={message.id} className="list-none">
              {newDay && (
                <div
                  className="my-3 flex items-center gap-3 px-4"
                  role="separator"
                >
                  <span className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs font-medium text-gray-500">
                    {dayFormat.format(message.postedAt)}
                  </span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              )}
              <MessageItem
                message={message}
                compact={compact}
                own={message.author.id === currentUserId}
              />
            </li>
          );
        })}
      </ol>
      {pending.length > 0 && (
        <ul aria-label="Sending" className="mt-0.5 space-y-0.5">
          {pending.map((message) => (
            <li key={message.id} className="flex justify-end px-4">
              <p
                className={`max-w-[min(32rem,80%)] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.failed
                    ? "bg-red-50 text-red-800"
                    : "bg-gray-900 text-white opacity-50"
                }`}
              >
                {message.label}
                {message.failed && " — not sent"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
