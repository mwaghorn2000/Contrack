import { TRPCError } from "@trpc/server";
import { publicProcedure, createTRPCRouter } from "../trpc";
import { z } from "zod";
import * as argon2 from "argon2";
import { Prisma, type PrismaClient } from "../../../../generated/prisma";
import { randomInt } from "node:crypto";
import { sendVerificationEmail } from "~/server/email";

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

const sendEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address.")
    .max(254, "Email mmust be 254 characters or fewer."),
});

const verifyEmailSchema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});

// Retry only database work. Email delivery must stay outside this callback.
async function withSerializableTransaction<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      ) {
        throw error;
      }

      if (attempt >= maxAttempts) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Please try again in a moment.",
          cause: error,
        });
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 50 * attempt + randomInt(0, 50)),
      );
    }
  }
}

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
  verificationEmail: publicProcedure
    .input(sendEmailSchema)
    .mutation(async ({ ctx, input }) => {
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const hashedCode = await argon2.hash(code, {
        type: argon2.argon2id,
      });

      const result = await withSerializableTransaction(ctx.db, async (tx) => {
        const user = await tx.user.findUnique({
          where: { email: input.email },
          select: {
            id: true,
            email: true,
            emailVerified: true,
            emailVerificationCode: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No account was found with this email. Sign up first.",
          });
        }

        if (!user.email) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This account has no email address.",
          });
        }

        if (user.emailVerified !== null) {
          return { status: "alreadyVerified" as const };
        }

        const now = new Date();
        const existingCode = user.emailVerificationCode;
        if (existingCode) {
          const elapsed = now.getTime() - existingCode.lastSentAt.getTime();
          if (elapsed < 60_000) {
            const secondsRemaining = Math.ceil((60_000 - elapsed) / 1000);
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: `Please wait ${secondsRemaining} seconds before requesting another code.`,
            });
          }
        }

        const data = {
          codeHash: hashedCode,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          attempts: 0,
          lastSentAt: now,
        };

        await tx.emailVerificationCode.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...data },
          update: data,
        });

        return { status: "send" as const, email: user.email };
      });

      if (result.status === "alreadyVerified") {
        return { success: true, alreadyVerified: true };
      }

      try {
        await sendVerificationEmail(result.email, code);
      } catch {
        // Retain the code and cooldown if delivery fails; a later resend replaces it.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn't send your verification code. Please try again.",
        });
      }

      return { success: true, alreadyVerified: false };
    }),
  verifyEmail: publicProcedure
    .input(verifyEmailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await withSerializableTransaction(ctx.db, async (tx) => {
        const user = await tx.user.findUnique({
          where: { email: input.email },
          select: {
            id: true,
            emailVerificationCode: true,
            emailVerified: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No account was found with this email.",
          });
        }

        if (user.emailVerified !== null) {
          return { status: "alreadyVerified" as const };
        }

        const verification = user.emailVerificationCode;
        if (!verification) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No verification code found. Request a new one.",
          });
        }

        if (verification.expiresAt.getTime() <= Date.now()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Your verification code has expired. Request a new one.",
          });
        }

        if (verification.attempts >= 5) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many incorrect attempts. Request a new code.",
          });
        }

        const matches = await argon2.verify(verification.codeHash, input.code);
        if (!matches) {
          await tx.emailVerificationCode.update({
            where: { userId: user.id },
            data: { attempts: { increment: 1 } },
          });
          // Commit the failed attempt before throwing outside the transaction.
          return { status: "invalid" as const };
        }

        await tx.user.update({
          where: { id: user.id },
          data: { emailVerified: new Date() },
        });
        await tx.emailVerificationCode.delete({
          where: { userId: user.id },
        });

        return { status: "verified" as const };
      });

      if (result.status === "invalid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code.",
        });
      }

      return {
        success: true,
        alreadyVerified: result.status === "alreadyVerified",
      };
    }),
});
