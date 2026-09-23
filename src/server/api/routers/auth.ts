import { TRPCError } from "@trpc/server";
import { publicProcedure, createTRPCRouter } from "../trpc";
import { z } from "zod";
import * as argon2 from "argon2";
import { email } from "zod/v4";

const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1)
    .refine(
      (name) => [...name].length <= 100,
      "Name must be 100 characters or fewer.",
    )
    .refine(
      (name) =>
        ![...name].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || (code >= 127 && code <= 159);
        }),
      "Name cannot contain control characters.",
    ),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address.")
    .max(254, "Email mmust be 254 characters or fewer."),
  password: z
    .string()
    .regex(/\p{Nd}/u, "include at least one number.")
    .regex(/[\p{P}\p{S}]/u, "include at least one symbol")
    .refine((password) => {
      const length = [...password].length;
      return length >= 12 && length <= 128;
    }, "Password must be between 12 and 128 characters"),
});

export const authRouter = createTRPCRouter({
  signup: publicProcedure
    .input(signupSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findFirst({
        where: {
          email: input.email,
        },
      });

      if (user) {
        if (user.emailVerified !== null) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "An account with this email already exists. Sign in instead.",
          });
        } else {
          return {
            success: true,
            requiresEmailVerification: true,
          };
        }
      }

      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
      });

      const newUser = await ctx.db.user.create({
        data: {
          name: input.fullName,
          email: input.email,
          passwordHash: passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
        },
      });

      return {
        success: true,
        newUser,
      };
    }),
});
