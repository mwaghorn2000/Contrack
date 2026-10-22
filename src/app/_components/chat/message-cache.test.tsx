import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ChatMessage } from "~/lib/chat-message";
import { createTestProvider, deferred, textMessage } from "~/test/ui";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  useAddMessageToCache,
  useRemoveMessageFromCache,
  useReplaceMessageInCache,
} from "./message-cache";

type Page = RouterOutputs["message"]["list"];
type Cache = {
  add: (message: ChatMessage) => void;
  replace: (message: ChatMessage) => void;
  remove: (messageId: string) => void;
};

const channelId = "channel-1";
const page = (items: ChatMessage[]): Page => ({ items, nextCursor: null });

// Renders a conversation's message list next to the cache helpers, answering
// message.list from `responses` in order.
async function setup(first: ChatMessage[]) {
  const responses: (Page | Promise<Page>)[] = [page(first)];
  const listCalls = vi.fn();
  const { Wrapper } = createTestProvider((path) => {
    if (path !== "message.list") throw new Error(`Unexpected call: ${path}`);
    listCalls();
    return responses.shift();
  });
  const hook = renderHook(
    () => {
      const cache: Cache = {
        add: useAddMessageToCache(channelId),
        replace: useReplaceMessageInCache(channelId),
        remove: useRemoveMessageFromCache(channelId),
      };
      const list = api.message.list.useInfiniteQuery(
        { channelId },
        { getNextPageParam: (last) => last.nextCursor },
      );
      return { cache, list };
    },
    { wrapper: Wrapper },
  );
  await waitFor(() => expect(hook.result.current.list.isSuccess).toBe(true));
  const ids = () =>
    hook.result.current.list.data?.pages.flatMap((p) =>
      p.items.map(({ id, content }) => `${id}:${content}`),
    );
  return { hook, responses, listCalls, ids };
}

const m1 = textMessage("m1");
const m2 = textMessage("m2");
const m1Edited = textMessage("m1", "Edited");

describe("message cache during an in-flight message.list fetch", () => {
  test.each([
    {
      name: "add",
      first: [m1],
      apply: (cache: Cache) => cache.add(m2),
      fresh: [m2, m1],
      expected: ["m2:Message m2", "m1:Message m1"],
    },
    {
      name: "replace",
      first: [m1],
      apply: (cache: Cache) => cache.replace(m1Edited),
      fresh: [m1Edited],
      expected: ["m1:Edited"],
    },
    {
      name: "remove",
      first: [m2, m1],
      apply: (cache: Cache) => cache.remove("m2"),
      fresh: [m1],
      expected: ["m1:Message m1"],
    },
  ])("$name is not overwritten by the stale response", async (c) => {
    const { hook, responses, ids } = await setup(c.first);
    const stale = deferred<Page>();
    // The fetch already in flight answers with the old messages; any fetch
    // started after the update sees the new ones.
    responses.push(stale.promise, page(c.fresh));
    act(() => void hook.result.current.list.refetch());
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(true));

    act(() => c.apply(hook.result.current.cache));
    await act(async () => stale.resolve(page(c.first)));

    await waitFor(() =>
      expect(hook.result.current.list.isFetching).toBe(false),
    );
    expect(ids()).toEqual(c.expected);
  });

  test("a duplicate add does not start another fetch", async () => {
    const { hook, responses, listCalls, ids } = await setup([m1]);
    const stale = deferred<Page>();
    responses.push(stale.promise);
    act(() => void hook.result.current.list.refetch());
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2));

    act(() => hook.result.current.cache.add(m1));
    await act(async () => stale.resolve(page([m1])));

    await waitFor(() =>
      expect(hook.result.current.list.isFetching).toBe(false),
    );
    expect(listCalls).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(["m1:Message m1"]);
  });
});
