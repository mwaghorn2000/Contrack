import type { ComponentType } from "react";
import type { ChatMessage, ChatMessageType } from "~/lib/chat-message";
import ImageMessage from "./image-message";
import TextMessage from "./text-message";

type Renderers = {
  [T in ChatMessageType]: ComponentType<{
    message: Extract<ChatMessage, { type: T }>;
  }>;
};

/**
 * One component per message type. Adding a type to ChatMessage without a
 * renderer here is a type error.
 */
const messageRenderers: Renderers = {
  TEXT: TextMessage,
  IMAGE: ImageMessage,
};

export default function MessageContent({ message }: { message: ChatMessage }) {
  const Renderer = messageRenderers[message.type] as ComponentType<{
    message: ChatMessage;
  }>;
  return <Renderer message={message} />;
}
