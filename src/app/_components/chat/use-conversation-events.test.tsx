import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import { useConversationEvents } from "./use-conversation-events";

// A realtime connection where the conversation's channel is already
// subscribed, e.g. by the unread summary, and events are fired by hand.
const realtime = vi.hoisted(() => {
  const handlers = new Map<string, (data: unknown) => void>();
  return {
    handlers,
    listen: (
      _name: string,
      event: string,
      handler: (data: unknown) => void,
    ) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    isSubscribed: () => true,
  };
});

vi.mock("./realtime-provider", () => ({ useRealtime: () => realtime }));

test("refetches on the first subscription success when already subscribed", () => {
  const { Wrapper, queryClient } = createTestProvider(() => null);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  renderHook(() => useConversationEvents("channel-1"), { wrapper: Wrapper });

  act(() => realtime.handlers.get("pusher:subscription_succeeded")?.(null));

  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(invalidate.mock.calls[0]?.[0])).toContain("channel-1");
});
