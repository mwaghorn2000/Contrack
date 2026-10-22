import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { z } from "zod";
import type { Prisma } from "../../../../generated/prisma";
import { imageFileSchema, imageKeySchema } from "~/lib/image-upload";
import {
  ALL_PERMISSIONS,
  permissionsFor,
  requireCompanyRole,
  requireConversationAccess,
  visibleChannelsWhere,
  type ChannelPermissions,
} from "~/server/chat-access";
import {
  channelFolder,
  channelImageFolder,
  confirmPrivateImageUpload,
  createImageUpload,
  deleteReplacedKey,
} from "~/server/image-uploads";
import { unreadCounts } from "~/server/chat-unread";
import { signedImageUrl } from "~/server/messages/types";
import { publishConversationsChanged } from "~/server/realtime";
import { deletePrefix, storageConfigured } from "~/server/storage";
import { serializableTransaction } from "~/server/transactions";

const channelNameSchema = z
  .string()
  .trim()
  .min(1, "Channel name is required")
  .max(100, "Channel name must be less than 100 characters");

const createChannelSchema = z.object({
  name: channelNameSchema,
  companyId: z.string().cuid(),
  // Company members to add with permission to send messages.
  memberIds: z.array(z.string().cuid()).max(200).optional(),
});

const channelIdSchema = z.object({ channelId: z.string().cuid() });

const permissionsSchema = z.object({
  canSendMessages: z.boolean(),
  canManageMembers: z.boolean(),
  canManageChannel: z.boolean(),
  canModerateMessages: z.boolean(),
});

async function requireUniqueName(
  db: Prisma.TransactionClient,
  companyId: string,
  name: string,
  exceptChannelId?: string,
) {
  const existing = await db.channel.findFirst({
    where: {
      companyId,
      kind: "CHANNEL",
      name: { equals: name, mode: "insensitive" },
      ...(exceptChannelId ? { id: { not: exceptChannelId } } : {}),
    },
    select: { id: true },
  });
  if (existing)
    throw new TRPCError({
      code: "CONFLICT",
      message: "A channel with this name already exists.",
    });
}

function requireChannelKind(kind: string) {
  if (kind !== "CHANNEL")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Direct messages cannot be changed.",
    });
}

/** Users who should see a channel list change: its members and the owner. */
async function channelAudience(
  db: Prisma.TransactionClient,
  channelId: string,
) {
  const channel = await db.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: {
      channelMembers: { where: { removedAt: null }, select: { userId: true } },
      company: {
        select: {
          members: { where: { role: "OWNER" }, select: { userId: true } },
        },
      },
    },
  });
  return [
    ...channel.channelMembers.map(({ userId }) => userId),
    ...channel.company.members.map(({ userId }) => userId),
  ];
}

export const channelRouter = createTRPCRouter({
  createChannel: protectedProcedure
    .input(createChannelSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const memberIds = [...new Set(input.memberIds ?? [])].filter(
        (id) => id !== userId,
      );
      const channel = await serializableTransaction(ctx.db, async (tx) => {
        const role = await requireCompanyRole(tx, input.companyId, userId);
        if (role !== "ADMIN" && role !== "OWNER")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins and owners can create channels.",
          });
        await requireUniqueName(tx, input.companyId, input.name);
        const companyMembers = await tx.companyMember.count({
          where: { companyId: input.companyId, userId: { in: memberIds } },
        });
        if (companyMembers !== memberIds.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only company members can be added to a channel.",
          });
        return tx.channel.create({
          data: {
            name: input.name,
            companyId: input.companyId,
            channelMembers: {
              create: [
                { userId, ...ALL_PERMISSIONS },
                ...memberIds.map((id) => ({
                  userId: id,
                  canSendMessages: true,
                })),
              ],
            },
          },
        });
      });
      await publishConversationsChanged(
        await channelAudience(ctx.db, channel.id),
      );
      return channel;
    }),

  getChannel: protectedProcedure
    .input(channelIdSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { channel, permissions } = await requireConversationAccess(
        ctx.db,
        userId,
        input.channelId,
      );
      const directUser =
        channel.kind === "DIRECT"
          ? ((
              await ctx.db.channelMember.findFirst({
                where: { channelId: channel.id, userId: { not: userId } },
                select: {
                  user: { select: { id: true, name: true, image: true } },
                },
              })
            )?.user ?? null)
          : null;
      return {
        id: channel.id,
        kind: channel.kind,
        name: channel.name,
        companyId: channel.companyId,
        imageUrl: await signedImageUrl(channel.image),
        permissions,
        directUser,
      };
    }),

  listChannels: protectedProcedure
    .input(z.object({ companyId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const role = await requireCompanyRole(ctx.db, input.companyId, userId);
      const isOwner = role === "OWNER";
      const channels = await ctx.db.channel.findMany({
        where: {
          companyId: input.companyId,
          ...visibleChannelsWhere(userId, role),
        },
        select: {
          id: true,
          name: true,
          image: true,
          createdAt: true,
          channelMembers: {
            where: { userId, removedAt: null },
            select: {
              canSendMessages: true,
              canManageMembers: true,
              canManageChannel: true,
              canModerateMessages: true,
            },
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
        channels.map(({ id }) => id),
      );
      const summaries = await Promise.all(
        channels.map(async (channel) => {
          const permissions = permissionsFor(
            isOwner,
            channel.channelMembers[0],
          );
          return {
            id: channel.id,
            name: channel.name,
            imageUrl: await signedImageUrl(channel.image),
            lastMessageAt: channel.messages[0]?.postedAt ?? null,
            unreadCount: unread.get(channel.id) ?? 0,
            permissions,
          };
        }),
      );
      // Most recent activity first; channels without messages go last.
      return summaries.sort((a, b) => {
        const aLastMessage = a.lastMessageAt?.getTime() ?? -Infinity;
        const bLastMessage = b.lastMessageAt?.getTime() ?? -Infinity;
        if (aLastMessage === bLastMessage) return a.id.localeCompare(b.id);
        return aLastMessage > bLastMessage ? -1 : 1;
      });
    }),

  updateChannel: protectedProcedure
    .input(channelIdSchema.extend({ name: channelNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await serializableTransaction(ctx.db, async (tx) => {
        const { channel } = await requireConversationAccess(
          tx,
          userId,
          input.channelId,
          "canManageChannel",
        );
        requireChannelKind(channel.kind);
        await requireUniqueName(tx, channel.companyId, input.name, channel.id);
        await tx.channel.update({
          where: { id: channel.id },
          data: { name: input.name },
        });
      });
      await publishConversationsChanged(
        await channelAudience(ctx.db, input.channelId),
      );
      return { success: true };
    }),

  deleteChannel: protectedProcedure
    .input(channelIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { channel } = await requireConversationAccess(
        ctx.db,
        ctx.session.user.id,
        input.channelId,
        "canManageChannel",
      );
      requireChannelKind(channel.kind);
      const audience = await channelAudience(ctx.db, channel.id);
      await ctx.db.channel.delete({ where: { id: channel.id } });
      if (storageConfigured()) {
        try {
          await deletePrefix(channelFolder(channel.id));
        } catch (error) {
          // The channel is already deleted; leftover files are harmless.
          console.error("Failed to delete channel files", error);
        }
      }
      await publishConversationsChanged(audience);
      return { success: true };
    }),

  createImageUpload: protectedProcedure
    .input(channelIdSchema.merge(imageFileSchema))
    .mutation(async ({ ctx, input }) => {
      const { channel } = await requireConversationAccess(
        ctx.db,
        ctx.session.user.id,
        input.channelId,
        "canManageChannel",
      );
      requireChannelKind(channel.kind);
      return createImageUpload(
        ctx.db,
        ctx.session.user.id,
        channelImageFolder(channel.id, "icon"),
        "logo",
        input,
      );
    }),

  setImage: protectedProcedure
    .input(channelIdSchema.extend({ key: imageKeySchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { channel } = await requireConversationAccess(
        ctx.db,
        userId,
        input.channelId,
        "canManageChannel",
      );
      requireChannelKind(channel.kind);
      const folder = channelImageFolder(channel.id, "icon");
      const key = input.key
        ? await confirmPrivateImageUpload(
            ctx.db,
            userId,
            folder,
            "logo",
            input.key,
          )
        : null;
      await ctx.db.channel.update({
        where: { id: channel.id },
        data: { image: key },
      });
      await deleteReplacedKey(folder, channel.image, key);
      await publishConversationsChanged(
        await channelAudience(ctx.db, channel.id),
      );
      return { imageUrl: await signedImageUrl(key) };
    }),

  /** Company members with their permissions in this channel, if any. */
  listMembers: protectedProcedure
    .input(channelIdSchema)
    .query(async ({ ctx, input }) => {
      const { channel } = await requireConversationAccess(
        ctx.db,
        ctx.session.user.id,
        input.channelId,
        "canManageMembers",
      );
      requireChannelKind(channel.kind);
      const members = await ctx.db.companyMember.findMany({
        where: { companyId: channel.companyId },
        orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        select: {
          role: true,
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              channelMemberships: {
                where: { channelId: channel.id, removedAt: null },
                select: {
                  canSendMessages: true,
                  canManageMembers: true,
                  canManageChannel: true,
                  canModerateMessages: true,
                },
              },
            },
          },
        },
      });
      return members.map(({ role, user }) => ({
        role,
        user: { id: user.id, name: user.name, image: user.image },
        permissions: user.channelMemberships[0] ?? null,
      }));
    }),

  /** Adds a company member to the channel, or changes their permissions. */
  setMember: protectedProcedure
    .input(
      channelIdSchema.extend({
        userId: z.string().cuid(),
        permissions: permissionsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorId = ctx.session.user.id;
      await serializableTransaction(ctx.db, async (tx) => {
        const { channel, isOwner, permissions } =
          await requireConversationAccess(
            tx,
            actorId,
            input.channelId,
            "canManageMembers",
          );
        requireChannelKind(channel.kind);
        if (!isOwner) {
          if (input.userId === actorId)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You can't change your own channel permissions.",
            });
          const granted = Object.entries(input.permissions)
            .filter(([, value]) => value)
            .map(([key]) => key as keyof ChannelPermissions);
          if (granted.some((permission) => !permissions[permission]))
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You can only grant permissions you have yourself.",
            });
        }
        const target = await tx.companyMember.findUnique({
          where: {
            userId_companyId: {
              companyId: channel.companyId,
              userId: input.userId,
            },
          },
        });
        if (!target)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Only company members can be added to a channel.",
          });
        await tx.channelMember.upsert({
          where: {
            channelId_userId: { channelId: channel.id, userId: input.userId },
          },
          create: {
            channelId: channel.id,
            userId: input.userId,
            ...input.permissions,
          },
          update: { ...input.permissions, removedAt: null },
        });
      });
      await publishConversationsChanged([input.userId]);
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(channelIdSchema.extend({ userId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const actorId = ctx.session.user.id;
      const { channel, isOwner } = await requireConversationAccess(
        ctx.db,
        actorId,
        input.channelId,
        "canManageMembers",
      );
      requireChannelKind(channel.kind);
      if (!isOwner && input.userId === actorId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can't remove yourself from a channel.",
        });
      // Keep the membership row so the person's past messages keep their author.
      const result = await ctx.db.channelMember.updateMany({
        where: { channelId: channel.id, userId: input.userId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (result.count === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This person is not in the channel.",
        });
      await publishConversationsChanged([input.userId]);
      return { success: true };
    }),
});
