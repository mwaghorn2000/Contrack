import type { ChatMessage } from "~/lib/chat-message";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";
import MessageContent from "./messages/registry";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export default function MessageItem({
  message,
  compact,
}: {
  message: ChatMessage;
  /** Follows a recent message by the same person, so the header is hidden. */
  compact: boolean;
}) {
  const name = message.author.name ?? "Unknown";
  const time = timeFormat.format(message.postedAt);
  return (
    <div
      className={`group flex gap-3 rounded-md px-4 hover:bg-gray-50 ${compact ? "py-0.5" : "mt-3 py-1"}`}
    >
      <div className="w-9 shrink-0">
        {compact ? (
          <time
            dateTime={message.postedAt.toISOString()}
            className="invisible block pt-1 text-right text-[10px] text-gray-400 group-hover:visible"
          >
            {time}
          </time>
        ) : (
          <MemberAvatar name={name} image={message.author.image} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-900">{name}</span>
            <time
              dateTime={message.postedAt.toISOString()}
              className="text-xs text-gray-500"
            >
              {time}
            </time>
          </p>
        )}
        <MessageContent message={message} />
      </div>
    </div>
  );
}
