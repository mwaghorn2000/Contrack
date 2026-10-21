import Image from "next/image";
import type { ChatMessage } from "~/lib/chat-message";
import { MessageText } from "./text-message";

const MAX_HEIGHT = 320;
const MAX_WIDTH = 480;

export default function ImageMessage({
  message,
}: {
  message: Extract<ChatMessage, { type: "IMAGE" }>;
}) {
  const { url, width, height } = message.image;
  // Reserve the displayed size up front so the conversation doesn't jump.
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  const size = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  return (
    <div className="space-y-1">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-fit max-w-full overflow-hidden rounded-xl"
        >
          <Image
            src={url}
            alt={message.content || "Shared image"}
            width={size.width}
            height={size.height}
            unoptimized
            className="h-auto max-w-full bg-gray-100"
          />
        </a>
      ) : (
        <p className="px-2 py-1 text-sm opacity-70">Image unavailable</p>
      )}
      {message.content && (
        <div className="px-2 pb-1">
          <MessageText text={message.content} />
        </div>
      )}
    </div>
  );
}
