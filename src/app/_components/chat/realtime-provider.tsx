"use client";

import Pusher from "pusher-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { env } from "~/env";
import { api } from "~/trpc/react";

type Handler = (data: unknown) => void;

type Realtime = {
  /**
   * Listens for an event on a channel. Several components can listen to the
   * same channel; it is unsubscribed when the last one stops.
   */
  listen: (channelName: string, event: string, handler: Handler) => () => void;
  /** Whether a channel is already subscribed, e.g. for another listener. */
  isSubscribed: (channelName: string) => boolean;
};

const RealtimeContext = createContext<Realtime | null>(null);

/** The shared realtime connection, or null when realtime is not configured. */
export function useRealtime() {
  return useContext(RealtimeContext);
}

function createRealtime(pusher: Pusher): Realtime {
  const listeners = new Map<string, number>();
  return {
    listen(channelName, event, handler) {
      const channel = pusher.subscribe(channelName);
      listeners.set(channelName, (listeners.get(channelName) ?? 0) + 1);
      channel.bind(event, handler);
      return () => {
        channel.unbind(event, handler);
        const remaining = (listeners.get(channelName) ?? 1) - 1;
        if (remaining > 0) {
          listeners.set(channelName, remaining);
        } else {
          listeners.delete(channelName);
          pusher.unsubscribe(channelName);
        }
      };
    },
    isSubscribed: (channelName) =>
      pusher.channel(channelName)?.subscribed ?? false,
  };
}

export default function RealtimeProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const utils = api.useUtils();
  const [realtime, setRealtime] = useState<Realtime | null>(null);

  // Connect in an effect rather than during render, so Strict Mode's extra
  // cleanup and re-run ends with a fresh, connected instance.
  useEffect(() => {
    const key = env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = env.NEXT_PUBLIC_PUSHER_CLUSTER;
    if (!key || !cluster) return;
    const pusher = new Pusher(key, {
      cluster,
      // Subscriptions are signed by the server only for people allowed to see them.
      channelAuthorization: {
        endpoint: "",
        transport: "ajax",
        customHandler: ({ socketId, channelName }, callback) => {
          utils.client.realtime.authorize
            .mutate({ socketId, channelName })
            .then((auth) => callback(null, auth))
            .catch((error: Error) => callback(error, null));
        },
      },
    });
    setRealtime(createRealtime(pusher));
    return () => {
      setRealtime(null);
      pusher.disconnect();
    };
  }, [utils]);

  // Channel or direct message lists changed, e.g. you were added to a channel.
  useEffect(
    () =>
      realtime?.listen(
        `private-user-${userId}`,
        "conversations-changed",
        () => {
          void utils.channel.listChannels.invalidate();
          void utils.directMessage.list.invalidate();
          void utils.channel.getChannel.invalidate();
          void utils.message.unreadSummary.invalidate();
        },
      ),
    [realtime, userId, utils],
  );

  return (
    <RealtimeContext.Provider value={realtime}>
      {children}
    </RealtimeContext.Provider>
  );
}
