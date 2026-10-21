import { z } from "zod";
import type { MessageType, Prisma } from "../../../generated/prisma";
import type { ChatMessage, SendMessageBody } from "~/lib/chat-message";
import {
  channelImageFolder,
  confirmPrivateImageUpload,
  imageKeySchema,
} from "~/server/image-uploads";
import { signedReadUrl, storageConfigured } from "~/server/storage";

type SendContext = {
  db: Prisma.TransactionClient;
  userId: string;
  channelId: string;
};

export const messageRowSelect = {
  id: true,
  type: true,
  content: true,
  data: true,
  postedAt: true,
  channelId: true,
  authorChannelMember: {
    select: { user: { select: { id: true, name: true, image: true } } },
  },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageRowSelect }>;

type MessageHandler<T extends MessageType> = {
  /** Validates the send input and returns what to store. */
  prepare: (
    context: SendContext,
    body: Extract<SendMessageBody, { type: T }>,
  ) => Promise<{ content: string; data?: Prisma.InputJsonValue }>;
  /** Adds the type-specific fields for the UI. */
  serialize: (
    row: MessageRow,
  ) => Promise<
    Omit<Extract<ChatMessage, { type: T }>, keyof ChatMessageBaseOf>
  >;
};

type ChatMessageBaseOf = Pick<
  ChatMessage,
  "id" | "channelId" | "content" | "postedAt" | "author"
>;

const imageDataSchema = z.object({
  key: z.string(),
  width: z.number(),
  height: z.number(),
});

const handlers: { [T in MessageType]: MessageHandler<T> } = {
  TEXT: {
    prepare: async (_context, body) => ({ content: body.content }),
    serialize: async () => ({ type: "TEXT" }),
  },
  IMAGE: {
    prepare: async ({ db, userId, channelId }, body) => {
      const key = await confirmPrivateImageUpload(
        db,
        userId,
        channelImageFolder(channelId, "messages"),
        "message",
        imageKeySchema.parse(body.key),
      );
      return {
        content: body.caption,
        data: { key, width: body.width, height: body.height },
      };
    },
    serialize: async (row) => {
      const data = imageDataSchema.safeParse(row.data);
      if (!data.success)
        return { type: "IMAGE", image: { url: null, width: 1, height: 1 } };
      return {
        type: "IMAGE",
        image: {
          url: await signedImageUrl(data.data.key),
          width: data.data.width,
          height: data.data.height,
        },
      };
    },
  },
};

export async function signedImageUrl(key: string | null) {
  return key && storageConfigured() ? signedReadUrl(key) : null;
}

export function prepareMessage(context: SendContext, body: SendMessageBody) {
  // The discriminated union guarantees body matches its handler.
  const handler = handlers[body.type] as MessageHandler<MessageType>;
  return handler.prepare(context, body);
}

export async function serializeMessage(row: MessageRow): Promise<ChatMessage> {
  const handler = handlers[row.type] as MessageHandler<MessageType>;
  return {
    id: row.id,
    channelId: row.channelId,
    content: row.content,
    postedAt: row.postedAt,
    author: row.authorChannelMember.user,
    ...(await handler.serialize(row)),
  } as ChatMessage;
}
