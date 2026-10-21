import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getConversationAccess } from "~/server/chat-access";
import {
  CONVERSATION_CHANNEL_PREFIX,
  USER_CHANNEL_PREFIX,
  authorizeChannel,
  realtimeConfigured,
} from "~/server/realtime";

export const realtimeRouter = createTRPCRouter({
  /** Signs a Pusher subscription the signed-in user is allowed to receive. */
  authorize: protectedProcedure
    .input(
      z.object({
        socketId: z.string().regex(/^\d+\.\d+$/),
        channelName: z.string().max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!realtimeConfigured())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Realtime is not configured.",
        });
      const userId = ctx.session.user.id;
      const { channelName } = input;
      let allowed = false;
      if (channelName.startsWith(USER_CHANNEL_PREFIX)) {
        allowed = channelName.slice(USER_CHANNEL_PREFIX.length) === userId;
      } else if (channelName.startsWith(CONVERSATION_CHANNEL_PREFIX)) {
        const channelId = channelName.slice(CONVERSATION_CHANNEL_PREFIX.length);
        allowed =
          z.string().cuid().safeParse(channelId).success &&
          (await getConversationAccess(ctx.db, userId, channelId)) !== null;
      }
      if (!allowed)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can't subscribe to this channel.",
        });
      return authorizeChannel(input.socketId, channelName);
    }),
});
