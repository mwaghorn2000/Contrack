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
  own,
}: {
  message: ChatMessage;
  /** Follows a recent message by the same person, so the header is hidden. */
  compact: boolean;
  /** Sent by the person viewing, so it sits on the right. */
  own: boolean;
}) {
  const name = message.author.name ?? "Unknown";
  const time = (
    <time
      dateTime={message.postedAt.toISOString()}
      title={message.postedAt.toLocaleString()}
      className="text-xs text-gray-500"
    >
      {timeFormat.format(message.postedAt)}
    </time>
  );
  const bubble = (
    <div
      className={`w-fit max-w-full rounded-2xl ${message.type === "IMAGE" ? "p-1" : "px-3 py-2"} ${
        own
          ? "rounded-br-md bg-gray-900 text-white"
          : "rounded-bl-md bg-gray-100 text-gray-900"
      }`}
    >
      <MessageContent message={message} />
    </div>
  );

  if (own)
    return (
      <div
        className={`flex flex-col items-end px-4 ${compact ? "mt-0.5" : "mt-3"}`}
      >
        {!compact && <p className="mb-1 pr-1">{time}</p>}
        <div className="flex max-w-[min(32rem,80%)] justify-end">{bubble}</div>
      </div>
    );

  return (
    <div className={`flex gap-2 px-4 ${compact ? "mt-0.5" : "mt-3"}`}>
      <div className="w-9 shrink-0">
        {!compact && <MemberAvatar name={name} image={message.author.image} />}
      </div>
      <div className="flex max-w-[min(32rem,80%)] min-w-0 flex-col items-start">
        {!compact && (
          <p className="mb-1 flex items-baseline gap-2 pl-1">
            <span className="text-sm font-semibold text-gray-900">{name}</span>
            {time}
          </p>
        )}
        {bubble}
      </div>
    </div>
  );
}
