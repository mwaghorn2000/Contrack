import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "../../../../generated/prisma";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { imageFileSchema } from "~/lib/image-upload";
import { messageTextSchema, sendMessageBodySchema } from "~/lib/chat-message";
import {
  ALL_PERMISSIONS,
  getConversationAccess,
  requireConversationAccess,
} from "~/server/chat-access";
import { unreadCounts, visibleConversations } from "~/server/chat-unread";
import { channelImageFolder, createImageUpload } from "~/server/image-uploads";
import {
  cleanUpDeletedMessage,
  messageEditRule,
  messageRowSelect,
  prepareMessage,
  serializeMessage,
} from "~/server/messages/types";
import { publishToConversation } from "~/server/realtime";

export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGES_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 10_000;

const channelIdSchema = z.object({ channelId: z.string().cuid() });

const messageIdSchema = z.object({ messageId: z.string().cuid() });

/** Loads a message the user can see, with their permissions in its conversation. */
async function requireMessage(
  db: Prisma.TransactionClient,
  userId: string,
  messageId: string,
) {
  const row = await db.message.findFirst({
    where: { id: messageId, deletedAt: null },
    select: messageRowSelect,
  });
  // Someone who can't see the conversation can't tell the message exists.
  const access =
    row && (await getConversationAccess(db, userId, row.channelId));
  if (!row || !access)
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
  return { row, access, isAuthor: row.authorChannelMember.user.id === userId };
}

/**
 * Refuses when the user has posted or edited too many messages recently. A
 * message posted and edited in the window counts once.
 */
async function requireMessageRate(
  db: Prisma.TransactionClient,
  userId: string,
) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await db.message.count({
    where: {
      authorChannelMember: { userId },
      OR: [{ postedAt: { gt: since } }, { editedAt: { gt: since } }],
    },
  });
  if (recent >= MESSAGES_PER_WINDOW)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You're sending messages too quickly. Please wait a moment.",
    });
}

export const messageRouter = createTRPCRouter({
  /** Newest first. Pass the returned cursor to load older messages. */
  list: protectedProcedure
    .input(
      channelIdSchema.extend({
        cursor: z
          .object({ postedAt: z.date(), id: z.string().cuid() })
          .nullish(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MESSAGE_PAGE_SIZE)
          .default(MESSAGE_PAGE_SIZE),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireConversationAccess(
        ctx.db,
        ctx.session.user.id,
        input.channelId,
      );
      const { cursor } = input;
      const rows = await ctx.db.message.findMany({
        where: {
          channelId: input.channelId,
          deletedAt: null,
          ...(cursor
            ? {
                OR: [
                  { postedAt: { lt: cursor.postedAt } },
                  { postedAt: cursor.postedAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ postedAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        select: messageRowSelect,
      });
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        items: await Promise.all(page.map(serializeMessage)),
        nextCursor:
          rows.length > input.limit && last
            ? { postedAt: last.postedAt, id: last.id }
            : null,
      };
    }),

  send: protectedProcedure
    .input(channelIdSchema.extend({ body: sendMessageBodySchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { member } = await requireConversationAccess(
        ctx.db,
        userId,
        input.channelId,
        "canSendMessages",
      );
      await requireMessageRate(ctx.db, userId);
      const prepared = await prepareMessage(
        { db: ctx.db, userId, channelId: input.channelId },
        input.body,
      );
      // The owner can post in any channel; their first message adds them to it.
      const authorId =
        member?.id ??
        (
          await ctx.db.channelMember.upsert({
            where: { channelId_userId: { channelId: input.channelId, userId } },
            create: { channelId: input.channelId, userId, ...ALL_PERMISSIONS },
            update: { removedAt: null },
            select: { id: true },
          })
        ).id;
      const row = await ctx.db.message.create({
        data: {
          type: input.body.type,
          content: prepared.content,
          data: prepared.data,
          channelId: input.channelId,
          authorChannelMemberId: authorId,
        },
        select: messageRowSelect,
      });
      const message = await serializeMessage(row);
      await publishToConversation(input.channelId, "message", message);
      return message;
    }),

  /** Changes the text of your own message (an image's caption). */
  edit: protectedProcedure
    .input(messageIdSchema.extend({ content: messageTextSchema }))
    .mutation(async ({ ctx, input }) => {
      const { row, access, isAuthor } = await requireMessage(
        ctx.db,
        ctx.session.user.id,
        input.messageId,
      );
      if (!isAuthor)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only edit your own messages.",
        });
      if (!access.permissions.canSendMessages)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You can't edit messages here because you can no longer send messages in this channel.",
        });
      const rule = messageEditRule(row.type);
      if (!rule)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This kind of message can't be edited.",
        });
      if (!rule.allowEmpty && !input.content)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a message.",
        });
      if (input.content === row.content) return serializeMessage(row);
      await requireMessageRate(ctx.db, ctx.session.user.id);
      // Match on deletedAt too, so a message deleted since it was loaded
      // isn't brought back.
      const result = await ctx.db.message.updateMany({
        where: { id: row.id, deletedAt: null },
        data: { content: input.content, editedAt: new Date() },
      });
      if (result.count === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found.",
        });
      const updated = await ctx.db.message.findUniqueOrThrow({
        where: { id: row.id },
        select: messageRowSelect,
      });
      const message = await serializeMessage(updated);
      await publishToConversation(row.channelId, "message-updated", message);
      return message;
    }),

  /** Deletes your own message, or anyone's if you can moderate the channel. */
  delete: protectedProcedure
    .input(messageIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { row, access, isAuthor } = await requireMessage(
        ctx.db,
        ctx.session.user.id,
        input.messageId,
      );
      if (!isAuthor && !access.permissions.canModerateMessages)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can't delete other people's messages here.",
        });
      // Keep the row so pagination and read positions stay consistent, but
      // remove what was said.
      const deleted = await ctx.db.message.updateMany({
        where: { id: row.id, deletedAt: null },
        data: { deletedAt: new Date(), content: "", data: Prisma.DbNull },
      });
      if (deleted.count === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found.",
        });
      await cleanUpDeletedMessage(row);
      await publishToConversation(row.channelId, "message-deleted", {
        id: row.id,
      });
      return { success: true };
    }),

  /** Marks everything in the conversation up to now as read. */
  markRead: protectedProcedure
    .input(channelIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireConversationAccess(ctx.db, userId, input.channelId);
      // Read up to the newest message, using the database's timestamps so the
      // app server's clock can't make a message look read or unread.
      const newest = await ctx.db.message.findFirst({
        where: { channelId: input.channelId, deletedAt: null },
        orderBy: [{ postedAt: "desc" }, { id: "desc" }],
        select: { postedAt: true },
      });
      const lastReadAt = newest?.postedAt ?? new Date();
      await ctx.db.channelRead.upsert({
        where: { channelId_userId: { channelId: input.channelId, userId } },
        create: { channelId: input.channelId, userId, lastReadAt },
        update: { lastReadAt },
      });
      return { success: true };
    }),

  /** Unread counts for the sidebar badges, plus every conversation to listen to. */
  unreadSummary: protectedProcedure
    .input(z.object({ companyId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const conversations = await visibleConversations(
        ctx.db,
        userId,
        input.companyId,
      );
      const counts = await unreadCounts(
        ctx.db,
        userId,
        conversations.map(({ id }) => id),
      );
      let channels = 0;
      let directMessages = 0;
      for (const { id, kind } of conversations) {
        const unread = counts.get(id) ?? 0;
        if (kind === "CHANNEL") channels += unread;
        else directMessages += unread;
      }
      return {
        channels,
        directMessages,
        conversationIds: conversations.map(({ id }) => id),
      };
    }),

  createImageUpload: protectedProcedure
    .input(channelIdSchema.merge(imageFileSchema))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireConversationAccess(
        ctx.db,
        userId,
        input.channelId,
        "canSendMessages",
      );
      return createImageUpload(
        ctx.db,
        userId,
        channelImageFolder(input.channelId, "messages"),
        "message",
        input,
      );
    }),
});
