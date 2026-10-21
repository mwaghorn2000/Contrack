import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { imageFileSchema } from "~/lib/image-upload";
import { updateProfileSchema } from "~/lib/profile-validation";
import {
  confirmImageUpload,
  createImageUpload,
  deleteReplacedImage,
  imageKeySchema,
  userImageFolder,
} from "~/server/image-uploads";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import type { PrismaClient } from "../../../../generated/prisma";

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

  createAvatarUpload: protectedProcedure
    .input(imageFileSchema)
    .mutation(async ({ ctx, input }) => {
      return createImageUpload(
        ctx.db,
        ctx.session.user.id,
        userImageFolder(ctx.session.user.id),
        "avatar",
        input,
      );
    }),

  setAvatar: protectedProcedure
    .input(z.object({ key: imageKeySchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const folder = userImageFolder(ctx.session.user.id);
      const image = await confirmImageUpload(
        ctx.db,
        ctx.session.user.id,
        folder,
        "avatar",
        input.key,
      );
      return replaceAvatar(ctx.db, ctx.session.user.id, folder, image);
    }),

  removeAvatar: protectedProcedure.mutation(async ({ ctx }) => {
    return replaceAvatar(
      ctx.db,
      ctx.session.user.id,
      userImageFolder(ctx.session.user.id),
      null,
    );
  }),
});

async function replaceAvatar(
  db: PrismaClient,
  userId: string,
  folder: string,
  image: string | null,
) {
  const previous = await db.user.findUnique({
    where: { id: userId },
    select: { image: true },
  });
  if (!previous)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Please sign in again to continue.",
    });
  const profile = await db.user.update({
    where: { id: userId },
    data: { image },
    select: profileSelect,
  });
  await deleteReplacedImage(folder, previous.image, image);
  return profile;
}
