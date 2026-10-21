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

const RealtimeContext = createContext<Pusher | null>(null);

/** The shared Pusher connection, or null when realtime is not configured. */
export function useRealtime() {
  return useContext(RealtimeContext);
}

export default function RealtimeProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const utils = api.useUtils();
  const [pusher] = useState(() => {
    const key = env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = env.NEXT_PUBLIC_PUSHER_CLUSTER;
    if (typeof window === "undefined" || !key || !cluster) return null;
    return new Pusher(key, {
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
  });

  useEffect(() => () => pusher?.disconnect(), [pusher]);

  // Channel or direct message lists changed, e.g. you were added to a channel.
  useEffect(() => {
    if (!pusher) return;
    const channel = pusher.subscribe(`private-user-${userId}`);
    const refresh = () => {
      void utils.channel.listChannels.invalidate();
      void utils.directMessage.list.invalidate();
      void utils.channel.getChannel.invalidate();
    };
    channel.bind("conversations-changed", refresh);
    return () => {
      channel.unbind("conversations-changed", refresh);
      pusher.unsubscribe(`private-user-${userId}`);
    };
  }, [pusher, userId, utils]);

  return (
    <RealtimeContext.Provider value={pusher}>
      {children}
    </RealtimeContext.Provider>
  );
}
