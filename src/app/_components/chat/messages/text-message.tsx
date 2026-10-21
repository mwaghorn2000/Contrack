import { Fragment } from "react";

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

/** Plain text with line breaks kept and web links made clickable. */
export function MessageText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="text-sm leading-6 break-words whitespace-pre-wrap">
      {text.split(URL_PATTERN).map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

export default function TextMessage({
  message,
}: {
  message: { content: string };
}) {
  return <MessageText text={message.content} />;
}
