import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { z } from "zod";

const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Channel name is required")
    .max(100, "Channel name must be less than 100 characters"),
  companyId: z.string().cuid(),
});

export const channelRouter = createTRPCRouter({
  createChannel: protectedProcedure
    .input(createChannelSchema)
    .mutation(async ({ ctx, input }) => {
      const { name } = input;

      const membership = await ctx.db.companyMember.findFirst({
        where: {
          companyId: input.companyId,
          userId: ctx.session.user.id,
        },
        select: {
          role: true,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this company.",
        });
      }

      if (membership?.role !== "ADMIN" && membership?.role !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and owners can create channels.",
        });
      }

      // Check if a channel with the same name already exists
      const existingChannel = await ctx.db.channel.findFirst({
        where: {
          name,
          companyId: input.companyId,
        },
      });

      if (existingChannel) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A channel with this name already exists.",
        });
      }

      const newChannel = await ctx.db.channel.create({
        data: {
          name: name,
          companyId: input.companyId,
          channelMembers: {
            create: {
              userId: ctx.session.user.id,
              canSendMessages: true,
              canManageMembers: true,
              canManageChannel: true,
              canModerateMessages: true,
            },
          },
        },
      });

      return newChannel;
    }),

  getChannel: protectedProcedure
    .input(z.object({ channelId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const channel = await ctx.db.channel.findUnique({
        where: {
          id: input.channelId,
          company: {
            members: {
              some: {
                userId: ctx.session.user.id,
              },
            },
          },
          channelMembers: {
            some: {
              userId: ctx.session.user.id,
            },
          },
        },
        include: {
          channelMembers: true,
        },
      });

      if (!channel) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Channel not found.",
        });
      }

      return channel;
    }),
});
