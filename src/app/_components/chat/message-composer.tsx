"use client";

import { useRef, useState } from "react";
import { imageSelectionError } from "~/lib/image-upload";
import { MESSAGE_MAX_LENGTH, type ChatMessage } from "~/lib/chat-message";
import { api } from "~/trpc/react";
import { uploadImage } from "../uploads/image-upload-button";
import type { PendingMessage } from "./message-list";

export default function MessageComposer({
  channelId,
  placeholder,
  onPending,
  onSent,
}: {
  channelId: string;
  placeholder: string;
  onPending: (update: (pending: PendingMessage[]) => PendingMessage[]) => void;
  onSent: (message: ChatMessage) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = api.message.send.useMutation();
  const createUpload = api.message.createImageUpload.useMutation();

  async function deliver(label: string, action: () => Promise<ChatMessage>) {
    const id = crypto.randomUUID();
    onPending((pending) => [...pending, { id, label, failed: false }]);
    setError("");
    try {
      onSent(await action());
      onPending((pending) => pending.filter((item) => item.id !== id));
      return true;
    } catch (cause) {
      onPending((pending) =>
        pending.map((item) =>
          item.id === id ? { ...item, failed: true } : item,
        ),
      );
      setError(
        cause instanceof Error ? cause.message : "Couldn’t send your message.",
      );
      // Clear the failed preview after a moment; the error message stays.
      setTimeout(
        () => onPending((pending) => pending.filter((item) => item.id !== id)),
        5_000,
      );
      return false;
    }
  }

  async function sendText() {
    const content = text.trim();
    if (!content) return;
    setText("");
    if (textRef.current) textRef.current.style.height = "auto";
    const sent = await deliver(content, () =>
      send.mutateAsync({ channelId, body: { type: "TEXT", content } }),
    );
    // Give the text back so it isn't lost.
    if (!sent) setText((current) => current || content);
    textRef.current?.focus();
  }

  async function sendImage(file: File) {
    const caption = text.trim();
    setText("");
    const sent = await deliver(
      caption ? `Uploading image: ${caption}` : "Uploading image…",
      () =>
        uploadImage(file, "message", {
          create: (details) =>
            createUpload.mutateAsync({ channelId, ...details }),
          confirm: (key, size) =>
            send.mutateAsync({
              channelId,
              body: { type: "IMAGE", key, ...size, caption },
            }),
        }),
    );
    // Give the caption back so it isn't lost.
    if (!sent) setText((current) => current || caption);
  }

  return (
    <form
      className="border-t border-gray-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void sendText();
      }}
    >
      {error && (
        <p role="alert" className="mb-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-gray-300 bg-white px-2 py-1.5 focus-within:border-gray-900">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach an image"
          title="Attach an image"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-5"
          >
            <path d="M10 3a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 10 3Z" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const fileError = imageSelectionError("message", file);
            if (fileError) setError(fileError);
            else void sendImage(file);
          }}
        />
        <label htmlFor={`composer-${channelId}`} className="sr-only">
          Message
        </label>
        <textarea
          ref={textRef}
          id={`composer-${channelId}`}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            setError("");
            // Grow with the text, up to a few lines.
            const area = event.target;
            area.style.height = "auto";
            area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void sendText();
            }
          }}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-sm text-gray-900 outline-none placeholder:text-gray-400"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
      <p className="mt-1 hidden text-xs text-gray-400 sm:block">
        Enter to send, Shift + Enter for a new line.
      </p>
    </form>
  );
}
