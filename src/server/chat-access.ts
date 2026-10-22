import { TRPCError } from "@trpc/server";
import type { CompanyRole, Prisma } from "../../generated/prisma";

export type ChannelPermissions = {
  canSendMessages: boolean;
  canManageMembers: boolean;
  canManageChannel: boolean;
  canModerateMessages: boolean;
};

const NO_PERMISSIONS: ChannelPermissions = {
  canSendMessages: false,
  canManageMembers: false,
  canManageChannel: false,
  canModerateMessages: false,
};

export const ALL_PERMISSIONS: ChannelPermissions = {
  canSendMessages: true,
  canManageMembers: true,
  canManageChannel: true,
  canModerateMessages: true,
};

/**
 * Everything for the company owner; otherwise the flags on the user's channel
 * membership, or nothing without one.
 */
export function permissionsFor(
  isOwner: boolean,
  member: ChannelPermissions | null | undefined,
): ChannelPermissions {
  if (isOwner) return { ...ALL_PERMISSIONS };
  if (!member) return { ...NO_PERMISSIONS };
  return {
    canSendMessages: member.canSendMessages,
    canManageMembers: member.canManageMembers,
    canManageChannel: member.canManageChannel,
    canModerateMessages: member.canModerateMessages,
  };
}

/**
 * What a user can do in a channel or direct message.
 *
 * - The company owner can see and manage every channel (not direct messages).
 * - Everyone else needs an active channel membership and the relevant flag.
 * - Direct messages are visible only to their two members.
 */
export async function getConversationAccess(
  db: Prisma.TransactionClient,
  userId: string,
  channelId: string,
) {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      kind: true,
      name: true,
      image: true,
      companyId: true,
      company: {
        select: { members: { where: { userId }, select: { role: true } } },
      },
      channelMembers: {
        where: { userId, removedAt: null },
        select: {
          id: true,
          canSendMessages: true,
          canManageMembers: true,
          canManageChannel: true,
          canModerateMessages: true,
        },
      },
    },
  });
  const companyRole = channel?.company.members[0]?.role;
  if (!channel || !companyRole) return null;
  const { channelMembers, ...rest } = channel;
  const details = {
    id: rest.id,
    kind: rest.kind,
    name: rest.name,
    image: rest.image,
    companyId: rest.companyId,
  };
  const member = channelMembers[0] ?? null;
  const isOwner = companyRole === "OWNER" && channel.kind === "CHANNEL";
  if (!isOwner && !member) return null;
  const permissions = permissionsFor(isOwner, member);
  return { channel: details, companyRole, isOwner, member, permissions };
}

export type ConversationAccess = NonNullable<
  Awaited<ReturnType<typeof getConversationAccess>>
>;

const PERMISSION_MESSAGES: Record<keyof ChannelPermissions, string> = {
  canSendMessages: "You can't send messages in this channel.",
  canManageMembers: "You can't manage this channel's members.",
  canManageChannel: "You can't change this channel.",
  canModerateMessages: "You can't moderate this channel.",
};

export async function requireConversationAccess(
  db: Prisma.TransactionClient,
  userId: string,
  channelId: string,
  permission?: keyof ChannelPermissions,
) {
  const access = await getConversationAccess(db, userId, channelId);
  if (!access)
    throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found." });
  if (permission && !access.permissions[permission])
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PERMISSION_MESSAGES[permission],
    });
  return access;
}

/**
 * Refuses when the target's channel membership has a permission the actor
 * lacks, so a manager can't remove or demote someone with more power.
 */
export async function requireCanManageMember(
  db: Prisma.TransactionClient,
  channelId: string,
  actorPermissions: ChannelPermissions,
  userId: string,
) {
  const target = await db.channelMember.findFirst({
    where: { channelId, userId, removedAt: null },
    select: {
      canSendMessages: true,
      canManageMembers: true,
      canManageChannel: true,
      canModerateMessages: true,
    },
  });
  const permissions = Object.keys(
    ALL_PERMISSIONS,
  ) as (keyof ChannelPermissions)[];
  if (
    target &&
    permissions.some((key) => target[key] && !actorPermissions[key])
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can't change someone who has permissions you don't.",
    });
}

/** The user's role in the company; NOT_FOUND if they aren't a member. */
export async function requireCompanyRole(
  db: Prisma.TransactionClient,
  companyId: string,
  userId: string,
) {
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { companyId, userId } },
    select: { role: true },
  });
  if (!membership)
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
  return membership.role;
}

/** Filters to the channels (not direct messages) this user can see. */
export function visibleChannelsWhere(
  userId: string,
  role: CompanyRole,
): Prisma.ChannelWhereInput {
  return {
    kind: "CHANNEL",
    ...(role === "OWNER"
      ? {}
      : { channelMembers: { some: { userId, removedAt: null } } }),
  };
}
