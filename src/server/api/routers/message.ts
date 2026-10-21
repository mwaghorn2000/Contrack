import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { imageFileSchema } from "~/lib/image-upload";
import { sendMessageBodySchema } from "~/lib/chat-message";
import { requireConversationAccess } from "~/server/chat-access";
import { unreadCounts, visibleConversations } from "~/server/chat-unread";
import { channelImageFolder, createImageUpload } from "~/server/image-uploads";
import {
  messageRowSelect,
  prepareMessage,
  serializeMessage,
} from "~/server/messages/types";
import { publishToConversation } from "~/server/realtime";

export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGES_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 10_000;

const channelIdSchema = z.object({ channelId: z.string().cuid() });

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
      const recent = await ctx.db.message.count({
        where: {
          authorChannelMember: { userId },
          postedAt: { gt: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
        },
      });
      if (recent >= MESSAGES_PER_WINDOW)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "You're sending messages too quickly. Please wait a moment.",
        });
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
            create: {
              channelId: input.channelId,
              userId,
              canSendMessages: true,
              canManageMembers: true,
              canManageChannel: true,
              canModerateMessages: true,
            },
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
