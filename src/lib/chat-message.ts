import { z } from "zod";

/**
 * Message types shared by the server and the chat UI. To add a type: add it to
 * the MessageType enum in prisma/schema.prisma, then add its send input below,
 * its ChatMessage shape, a handler in src/server/messages/types.ts and a
 * renderer in src/app/_components/chat/messages/registry.tsx. TypeScript
 * reports any of these that are missing.
 */

export const MESSAGE_MAX_LENGTH = 4000;

export const messageTextSchema = z
  .string()
  .trim()
  .max(
    MESSAGE_MAX_LENGTH,
    `Messages must be ${MESSAGE_MAX_LENGTH} characters or fewer.`,
  )
  .refine(
    (text) => !text.includes("\0"),
    "Message contains an unsupported character.",
  );

const dimensionSchema = z.number().int().positive().max(10_000);

export const sendMessageBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("TEXT"),
    content: messageTextSchema.pipe(z.string().min(1, "Enter a message.")),
  }),
  z.object({
    type: z.literal("IMAGE"),
    key: z.string().max(200),
    width: dimensionSchema,
    height: dimensionSchema,
    caption: messageTextSchema.default(""),
  }),
]);

export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

type ChatMessageBase = {
  id: string;
  channelId: string;
  content: string;
  postedAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string | null; image: string | null };
};

export type ChatMessage = ChatMessageBase &
  (
    | { type: "TEXT" }
    | {
        type: "IMAGE";
        // Null when the image cannot be shown, e.g. storage is not configured.
        image: { url: string | null; width: number; height: number };
      }
  );

export type ChatMessageType = ChatMessage["type"];
