import type { ChannelKind, Prisma } from "../../generated/prisma";
import { visibleChannelsWhere } from "~/server/chat-access";

/**
 * Unread messages per conversation: messages from other people posted after
 * the user last read it. Before a first read, that is after they joined (or
 * everything, for the owner reading a channel they never joined). Also gives
 * when the latest message was posted, by anyone. Conversations without
 * messages are left out.
 */
export async function unreadCounts(
  db: Prisma.TransactionClient,
  userId: string,
  channelIds: string[],
) {
  type Summary = { unread: number; lastMessageAt: Date };
  if (channelIds.length === 0) return new Map<string, Summary>();
  const rows = await db.$queryRaw<({ channelId: string } & Summary)[]>`
    SELECT m."channelId",
      (COUNT(*) FILTER (
        WHERE author."userId" <> ${userId}
          AND m."postedAt" > COALESCE(r."lastReadAt", me."joinedAt", '-infinity'::timestamp)
      ))::int AS unread,
      MAX(m."postedAt") AS "lastMessageAt"
    FROM "Message" m
    JOIN "ChannelMember" author ON author."id" = m."authorChannelMemberId"
    LEFT JOIN "ChannelRead" r
      ON r."channelId" = m."channelId" AND r."userId" = ${userId}
    LEFT JOIN "ChannelMember" me
      ON me."channelId" = m."channelId" AND me."userId" = ${userId}
    WHERE m."channelId" = ANY(${channelIds}::text[])
      AND m."deletedAt" IS NULL
    GROUP BY m."channelId"`;
  return new Map(
    rows.map(({ channelId, unread, lastMessageAt }) => [
      channelId,
      { unread, lastMessageAt },
    ]),
  );
}

/** Channels and direct messages in a company that this user can read. */
export async function visibleConversations(
  db: Prisma.TransactionClient,
  userId: string,
  companyId: string,
): Promise<{ id: string; kind: ChannelKind }[]> {
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { companyId, userId } },
    select: { role: true },
  });
  if (!membership) return [];
  return db.channel.findMany({
    where: {
      companyId,
      OR: [
        visibleChannelsWhere(userId, membership.role),
        {
          kind: "DIRECT",
          channelMembers: { some: { userId, removedAt: null } },
        },
      ],
    },
    select: { id: true, kind: true },
  });
}
