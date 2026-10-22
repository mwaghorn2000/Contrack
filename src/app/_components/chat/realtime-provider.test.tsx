import { render, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import RealtimeProvider, { useRealtime } from "./realtime-provider";

// A stand-in for pusher-js that records whether each instance is connected.
const { FakePusher, pushers } = vi.hoisted(() => {
  const pushers: { connected: boolean; subscribed: string[] }[] = [];
  class FakePusher {
    connected = true;
    subscribed: string[] = [];
    constructor() {
      pushers.push(this);
    }
    subscribe(name: string) {
      this.subscribed.push(name);
      return { bind: () => undefined, unbind: () => undefined };
    }
    unsubscribe() {
      return undefined;
    }
    channel() {
      return undefined;
    }
    disconnect() {
      this.connected = false;
    }
  }
  return { FakePusher, pushers };
});

vi.mock("pusher-js", () => ({ default: FakePusher }));
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_PUSHER_KEY: "key", NEXT_PUBLIC_PUSHER_CLUSTER: "ap4" },
}));

// Listens on a channel once realtime is available, like the chat views do.
function Listener() {
  const realtime = useRealtime();
  useEffect(
    () => realtime?.listen("private-test", "message", () => undefined),
    [realtime],
  );
  return null;
}

test("Strict Mode leaves the connection in use connected", async () => {
  const { Wrapper } = createTestProvider(() => null);
  render(
    <StrictMode>
      <Wrapper>
        <RealtimeProvider userId="user-1">
          <Listener />
        </RealtimeProvider>
      </Wrapper>
    </StrictMode>,
  );

  await waitFor(() =>
    expect(pushers.some((p) => p.subscribed.includes("private-test"))).toBe(
      true,
    ),
  );
  const connected = pushers.filter((p) => p.connected);
  expect(connected).toHaveLength(1);
  expect(connected[0]?.subscribed).toContain("private-test");
});
