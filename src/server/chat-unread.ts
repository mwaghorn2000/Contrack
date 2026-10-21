import type { ChannelKind, Prisma } from "../../generated/prisma";

/**
 * Unread messages per conversation: messages from other people posted after
 * the user last read it. Before a first read, that is after they joined (or
 * everything, for the owner reading a channel they never joined).
 */
export async function unreadCounts(
  db: Prisma.TransactionClient,
  userId: string,
  channelIds: string[],
) {
  if (channelIds.length === 0) return new Map<string, number>();
  const rows = await db.$queryRaw<{ channelId: string; unread: number }[]>`
    SELECT m."channelId", COUNT(*)::int AS unread
    FROM "Message" m
    JOIN "ChannelMember" author ON author."id" = m."authorChannelMemberId"
    LEFT JOIN "ChannelRead" r
      ON r."channelId" = m."channelId" AND r."userId" = ${userId}
    LEFT JOIN "ChannelMember" me
      ON me."channelId" = m."channelId" AND me."userId" = ${userId}
    WHERE m."channelId" = ANY(${channelIds}::text[])
      AND m."deletedAt" IS NULL
      AND author."userId" <> ${userId}
      AND m."postedAt" > COALESCE(r."lastReadAt", me."joinedAt", '-infinity'::timestamp)
    GROUP BY m."channelId"`;
  return new Map(rows.map(({ channelId, unread }) => [channelId, unread]));
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
  const isMember = { channelMembers: { some: { userId, removedAt: null } } };
  return db.channel.findMany({
    where: {
      companyId,
      OR: [
        {
          kind: "CHANNEL",
          ...(membership.role === "OWNER" ? {} : isMember),
        },
        { kind: "DIRECT", ...isMember },
      ],
    },
    select: { id: true, kind: true },
  });
}
