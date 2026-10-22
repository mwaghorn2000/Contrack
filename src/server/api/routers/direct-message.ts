import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "../../../../generated/prisma";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireCompanyRole } from "~/server/chat-access";
import { unreadCounts } from "~/server/chat-unread";
import { publishConversationsChanged } from "~/server/realtime";
import { serializableTransaction } from "~/server/transactions";

function directKey(companyId: string, userIds: [string, string]) {
  return [companyId, ...[...userIds].sort()].join(":");
}

export const directMessageRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ companyId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireCompanyRole(ctx.db, input.companyId, userId);
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
        },
      });
      const summary = await unreadCounts(
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
              lastMessageAt:
                summary.get(conversation.id)?.lastMessageAt ?? null,
              createdAt: conversation.createdAt,
              unreadCount: summary.get(conversation.id)?.unread ?? 0,
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
      const findOrCreate = () =>
        serializableTransaction(ctx.db, async (tx) => {
          const existing = await tx.channel.findUnique({
            where: { directKey: key },
            select: { id: true },
          });
          const channel =
            existing ??
            (await tx.channel.create({
              data: {
                kind: "DIRECT",
                name: "",
                companyId: input.companyId,
                directKey: key,
              },
              select: { id: true },
            }));
          // Adds both people, and restores access for someone who left the
          // company and rejoined. Rows that are already right aren't written,
          // so opening an existing conversation doesn't conflict with others.
          const memberIds = [userId, input.userId];
          await tx.channelMember.createMany({
            data: memberIds.map((memberId) => ({
              channelId: channel.id,
              userId: memberId,
              canSendMessages: true,
            })),
            skipDuplicates: true,
          });
          await tx.channelMember.updateMany({
            where: {
              channelId: channel.id,
              userId: { in: memberIds },
              OR: [{ removedAt: { not: null } }, { canSendMessages: false }],
            },
            data: { removedAt: null, canSendMessages: true },
          });
          return { channel, created: !existing };
        });
      let result;
      try {
        result = await findOrCreate();
      } catch (error) {
        // Both people opened the conversation at the same time. The failed
        // transaction was rolled back, and a second try finds the other one.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
        result = await findOrCreate();
      }
      const { channel, created } = result;
      if (created) await publishConversationsChanged([input.userId]);
      return { id: channel.id };
    }),
});
