import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "../../../../generated/prisma";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { unreadCounts } from "~/server/chat-unread";
import { publishConversationsChanged } from "~/server/realtime";

function directKey(companyId: string, userIds: [string, string]) {
  return [companyId, ...[...userIds].sort()].join(":");
}

export const directMessageRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ companyId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const membership = await ctx.db.companyMember.findUnique({
        where: { userId_companyId: { companyId: input.companyId, userId } },
      });
      if (!membership)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Company not found.",
        });
      const conversations = await ctx.db.channel.findMany({
        where: {
          companyId: input.companyId,
          kind: "DIRECT",
          channelMembers: { some: { userId, removedAt: null } },
        },
        select: {
          id: true,
          createdAt: true,
          channelMembers: {
            where: { userId: { not: userId } },
            select: { user: { select: { id: true, name: true, image: true } } },
          },
          messages: {
            where: { deletedAt: null },
            orderBy: [{ postedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { postedAt: true },
          },
        },
      });
      const unread = await unreadCounts(
        ctx.db,
        userId,
        conversations.map(({ id }) => id),
      );
      return conversations
        .flatMap((conversation) => {
          const user = conversation.channelMembers[0]?.user;
          if (!user) return [];
          return [
            {
              id: conversation.id,
              user,
              lastMessageAt: conversation.messages[0]?.postedAt ?? null,
              createdAt: conversation.createdAt,
              unreadCount: unread.get(conversation.id) ?? 0,
            },
          ];
        })
        .sort(
          (a, b) =>
            (b.lastMessageAt ?? b.createdAt).getTime() -
            (a.lastMessageAt ?? a.createdAt).getTime(),
        );
    }),

  /** Returns the direct message with this person, creating it if needed. */
  open: protectedProcedure
    .input(
      z.object({ companyId: z.string().cuid(), userId: z.string().cuid() }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.userId === userId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't message yourself.",
        });
      const members = await ctx.db.companyMember.count({
        where: {
          companyId: input.companyId,
          userId: { in: [userId, input.userId] },
        },
      });
      if (members !== 2)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That person is not in this company.",
        });
      const key = directKey(input.companyId, [userId, input.userId]);
      let channel = await ctx.db.channel.findUnique({
        where: { directKey: key },
        select: { id: true },
      });
      let created = false;
      if (!channel) {
        try {
          channel = await ctx.db.channel.create({
            data: {
              kind: "DIRECT",
              name: "",
              companyId: input.companyId,
              directKey: key,
            },
            select: { id: true },
          });
          created = true;
        } catch (error) {
          // Both people opened the conversation at the same time.
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== "P2002"
          )
            throw error;
          channel = await ctx.db.channel.findUniqueOrThrow({
            where: { directKey: key },
            select: { id: true },
          });
        }
      }
      // Restores access for someone who left the company and rejoined.
      for (const memberId of [userId, input.userId])
        await ctx.db.channelMember.upsert({
          where: {
            channelId_userId: { channelId: channel.id, userId: memberId },
          },
          create: {
            channelId: channel.id,
            userId: memberId,
            canSendMessages: true,
          },
          update: { removedAt: null, canSendMessages: true },
        });
      if (created) await publishConversationsChanged([input.userId]);
      return { id: channel.id };
    }),
});
