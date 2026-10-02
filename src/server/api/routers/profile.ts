import { TRPCError } from "@trpc/server";
import { updateProfileSchema } from "~/lib/profile-validation";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const profileSelect = {
  id: true,
  name: true,
  description: true,
  email: true,
  image: true,
} as const;

export const profileRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: profileSelect,
    });
    if (!profile)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Please sign in again to continue.",
      });
    return profile;
  }),

  update: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      // The authenticated session is the only source of the user ID.
      return ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { name: input.name, description: input.description },
        select: profileSelect,
      });
    }),
});
