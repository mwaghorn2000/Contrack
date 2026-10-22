"use client";

import { useState } from "react";
import { MESSAGE_MAX_LENGTH, type ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";
import { useMessageCache } from "./message-cache";
import MessageContent from "./messages/registry";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const iconButton =
  "flex size-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900";

export default function MessageItem({
  message,
  compact,
  own,
  canEdit,
  canDelete,
}: {
  message: ChatMessage;
  /** Follows a recent message by the same person, so the header is hidden. */
  compact: boolean;
  /** Sent by the person viewing, so it sits on the right. */
  own: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [draft, setDraft] = useState(message.content);
  const messageCache = useMessageCache(message.channelId);
  const edit = api.message.edit.useMutation({
    onSuccess(updated) {
      messageCache.replace(updated);
      setMode("view");
    },
  });
  const remove = api.message.delete.useMutation({
    onSuccess() {
      messageCache.remove(message.id);
    },
  });
  const error = edit.error ?? remove.error;
  const busy = edit.isPending || remove.isPending;
  // An image's text is its caption, which may be cleared.
  const draftValid = message.type === "IMAGE" || draft.trim().length > 0;

  function save() {
    if (busy || !draftValid) return;
    if (draft.trim() === message.content) setMode("view");
    else edit.mutate({ messageId: message.id, content: draft });
  }

  const name = message.author.name ?? "Unknown";
  const time = (
    <span className="text-xs text-gray-500">
      <time
        dateTime={message.postedAt.toISOString()}
        title={message.postedAt.toLocaleString()}
      >
        {timeFormat.format(message.postedAt)}
      </time>
      {message.editedAt && (
        <span title={`Edited ${message.editedAt.toLocaleString()}`}>
          {" "}
          (edited)
        </span>
      )}
    </span>
  );

  const bubble =
    mode === "edit" ? (
      <form
        className="w-[min(32rem,80vw)] max-w-full space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label htmlFor={`edit-${message.id}`} className="sr-only">
          {message.type === "IMAGE" ? "Edit caption" : "Edit message"}
        </label>
        <textarea
          id={`edit-${message.id}`}
          autoFocus
          rows={Math.min(6, Math.max(2, draft.split("\n").length))}
          value={draft}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setMode("view");
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              save();
            }
          }}
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900"
        />
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="mr-auto text-gray-500">
            Enter to save, Esc to cancel
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("view")}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !draftValid}
            className="rounded-md bg-gray-900 px-3 py-1 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {edit.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    ) : (
      <div
        className={`w-fit max-w-full rounded-2xl ${message.type === "IMAGE" ? "p-1" : "px-3 py-2"} ${
          own
            ? "rounded-br-md bg-gray-900 text-white"
            : "rounded-bl-md bg-gray-100 text-gray-900"
        } ${remove.isPending ? "opacity-50" : ""}`}
      >
        <MessageContent message={message} />
      </div>
    );

  const actions =
    mode === "view" && (canEdit || canDelete) ? (
      // Shown on hover, or when tabbing through the conversation.
      <div className="flex shrink-0 self-center opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setDraft(message.content);
              setMode("edit");
            }}
            aria-label="Edit message"
            title="Edit"
            className={iconButton}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4"
            >
              <path d="M13.6 2.6a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8l-9.7 9.7a2 2 0 0 1-.9.5l-3.6 1a.75.75 0 0 1-.9-.9l1-3.6a2 2 0 0 1 .5-.9l9.8-9.6Z" />
            </svg>
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => setMode("confirm-delete")}
            aria-label="Delete message"
            title="Delete"
            className={`${iconButton} hover:bg-red-50 hover:text-red-700`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4"
            >
              <path
                fillRule="evenodd"
                d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.44c-.8.08-1.57.18-2.34.31a.75.75 0 0 0 .25 1.48l.15-.02.84 10.52A2.75 2.75 0 0 0 7.64 19h4.72a2.75 2.75 0 0 0 2.74-2.54l.84-10.52.15.02a.75.75 0 0 0 .25-1.48A41 41 0 0 0 14 4.19v-.44A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.67.03 2.5.08v-.33c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.33C8.33 4.03 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    ) : null;

  const footer = (
    <>
      {mode === "confirm-delete" && (
        <div
          role="group"
          aria-label="Delete this message?"
          className="mt-1 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-gray-700">
            Delete this message{own ? "" : ` from ${name}`}?
          </span>
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => remove.mutate({ messageId: message.id })}
            className="rounded-md bg-red-700 px-2.5 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("view")}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error.message}
        </p>
      )}
    </>
  );

  // Your own messages mirror other people's: on the right, without an avatar.
  const side = own ? "pr-1" : "pl-1";
  return (
    <div
      className={`group flex gap-2 px-4 ${own ? "flex-row-reverse" : ""} ${compact ? "mt-0.5" : "mt-3"}`}
    >
      {!own && (
        <div className="w-9 shrink-0">
          {!compact && (
            <MemberAvatar name={name} image={message.author.image} />
          )}
        </div>
      )}
      <div
        className={`flex max-w-[min(32rem,80%)] min-w-0 flex-col ${own ? "items-end" : "items-start"}`}
      >
        {!compact && (
          <p className={`mb-1 flex items-baseline gap-2 ${side}`}>
            {!own && (
              <span className="text-sm font-semibold text-gray-900">
                {name}
              </span>
            )}
            {time}
          </p>
        )}
        <div
          className={`flex max-w-full items-start gap-1 ${own ? "flex-row-reverse" : ""}`}
        >
          {bubble}
          {actions}
        </div>
        {compact && message.editedAt && mode === "view" && (
          <p className={`mt-0.5 ${side} text-xs text-gray-500`}>(edited)</p>
        )}
        {footer}
      </div>
    </div>
  );
}
