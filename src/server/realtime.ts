import "server-only";

import Pusher from "pusher";
import { env } from "~/env";

export const CONVERSATION_CHANNEL_PREFIX = "private-conversation-";
export const USER_CHANNEL_PREFIX = "private-user-";

export function conversationChannelName(channelId: string) {
  return `${CONVERSATION_CHANNEL_PREFIX}${channelId}`;
}

export function userChannelName(userId: string) {
  return `${USER_CHANNEL_PREFIX}${userId}`;
}

let pusher: Pusher | undefined;

function client() {
  const {
    PUSHER_APP_ID,
    PUSHER_SECRET,
    NEXT_PUBLIC_PUSHER_KEY,
    NEXT_PUBLIC_PUSHER_CLUSTER,
  } = env;
  if (
    !PUSHER_APP_ID ||
    !PUSHER_SECRET ||
    !NEXT_PUBLIC_PUSHER_KEY ||
    !NEXT_PUBLIC_PUSHER_CLUSTER
  )
    return null;
  pusher ??= new Pusher({
    appId: PUSHER_APP_ID,
    key: NEXT_PUBLIC_PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: NEXT_PUBLIC_PUSHER_CLUSTER,
    useTLS: true,
  });
  return pusher;
}

export function realtimeConfigured() {
  return client() !== null;
}

// Publishing is best-effort: the database is the source of truth, and clients
// fetch anything they missed when they reconnect.
async function trigger(channels: string[], event: string, data: unknown) {
  const pusher = client();
  if (!pusher || channels.length === 0) return;
  try {
    // Pusher accepts at most 100 channels per trigger.
    for (let index = 0; index < channels.length; index += 100)
      await pusher.trigger(channels.slice(index, index + 100), event, data);
  } catch (error) {
    console.error(`Failed to publish ${event}`, error);
  }
}

export async function publishToConversation(
  channelId: string,
  event: "message",
  data: unknown,
) {
  await trigger([conversationChannelName(channelId)], event, data);
}

/** Tells these users to refresh their channel and direct message lists. */
export async function publishConversationsChanged(userIds: string[]) {
  await trigger(
    [...new Set(userIds)].map(userChannelName),
    "conversations-changed",
    {},
  );
}

export function authorizeChannel(socketId: string, channelName: string) {
  const pusher = client();
  if (!pusher) throw new Error("Realtime is not configured.");
  return pusher.authorizeChannel(socketId, channelName);
}
