import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import { z } from "zod";
import QRCode from "qrcode";
import {
  currentPasswordSchema,
  passwordSchema,
} from "~/lib/password-validation";
import {
  authenticator,
  consumeFactor,
  createRecoveryCodes,
  encryptSecret,
  matchingStep,
  recoveryHash,
  takeSecurityAttempt,
  withSecurityLock,
  type SecurityUser,
} from "~/server/auth/two-factor";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import type { Session } from "next-auth";

const proofSchema = z
  .object({
    currentPassword: currentPasswordSchema,
    code: z.string().trim().max(128).default(""),
  })
  .strict();
const invalidProof =
  "Could not verify your password or security code. Use a fresh code and try again.";
const tooMany = "Too many attempts. Please wait 10 minutes and try again.";

async function primaryProof(
  user: SecurityUser,
  password: string,
  session: Session,
) {
  if (user.passwordHash)
    return (
      password.length > 0 && (await argon2.verify(user.passwordHash, password))
    );
  return (
    session.authProvider !== "credentials" &&
    typeof session.authTime === "number" &&
    Date.now() - session.authTime < 10 * 60_000
  );
}

function unwrap<T extends { error?: string }>(result: T) {
  if (result.error)
    throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
  return result;
}

export const securityRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      include: { twoFactor: true },
    });
    return {
      hasPassword: !!user.passwordHash,
      enabled: !!user.twoFactor?.secretEncrypted,
      recoveryCodesRemaining: user.twoFactor?.recoveryHashes.length ?? 0,
      needsRecentSignIn:
        !user.passwordHash && !(await primaryProof(user, "", ctx.session)),
    };
  }),

  changePassword: protectedProcedure
    .input(proofSchema.extend({ newPassword: passwordSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await withSecurityLock(
        ctx.db,
        ctx.session.user.id,
        async (tx, user) => {
          if (!user.passwordHash)
            return {
              error:
                "This account uses a sign-in provider. Manage your password with that provider.",
            };
          if (!(await takeSecurityAttempt(tx, user.id)))
            return { error: tooMany };
          if (!(await primaryProof(user, input.currentPassword, ctx.session)))
            return { error: invalidProof };
          if (input.newPassword === input.currentPassword)
            return { error: "Choose a different new password." };
          if (
            user.twoFactor?.secretEncrypted &&
            !(await consumeFactor(tx, user, input.code))
          )
            return { error: invalidProof };
          const passwordHash = await argon2.hash(input.newPassword, {
            type: argon2.argon2id,
          });
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, sessionVersion: { increment: 1 } },
          });
          await tx.twoFactor.update({
            where: { userId: user.id },
            data: { pendingEncrypted: null, pendingExpiresAt: null },
          });
          await tx.twoFactorChallenge.deleteMany({
            where: { userId: user.id },
          });
          return { error: undefined, success: true };
        },
        ctx.session.sessionVersion ?? 0,
      );
      return unwrap(result);
    }),

  beginSetup: protectedProcedure
    .input(z.object({ currentPassword: currentPasswordSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await withSecurityLock(
        ctx.db,
        ctx.session.user.id,
        async (tx, user) => {
          if (user.twoFactor?.secretEncrypted)
            return { error: "Two-factor authentication is already enabled." };
          if (!(await takeSecurityAttempt(tx, user.id)))
            return { error: tooMany };
          if (!(await primaryProof(user, input.currentPassword, ctx.session)))
            return {
              error:
                "Verify your current password, or sign in with your provider again before setting up two-factor authentication.",
            };
          const totp = authenticator(undefined, user.email ?? user.id);
          const secret = totp.secret.base32;
          const qrCode = await QRCode.toDataURL(totp.toString());
          await tx.twoFactor.update({
            where: { userId: user.id },
            data: {
              pendingEncrypted: encryptSecret(secret, user.id),
              pendingExpiresAt: new Date(Date.now() + 10 * 60_000),
            },
          });
          return { error: undefined, secret, qrCode };
        },
        ctx.session.sessionVersion ?? 0,
      );
      return unwrap(result);
    }),

  enable: protectedProcedure
    .input(proofSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await withSecurityLock(
        ctx.db,
        ctx.session.user.id,
        async (tx, user) => {
          const state = user.twoFactor;
          if (state?.secretEncrypted)
            return { error: "Two-factor authentication is already enabled." };
          if (
            !state?.pendingEncrypted ||
            !state.pendingExpiresAt ||
            state.pendingExpiresAt.getTime() <= Date.now()
          )
            return { error: "Setup expired. Start setup again." };
          if (!(await takeSecurityAttempt(tx, user.id)))
            return { error: tooMany };
          if (!(await primaryProof(user, input.currentPassword, ctx.session)))
            return { error: invalidProof };
          const step = matchingStep(
            state.pendingEncrypted,
            user.id,
            input.code,
            null,
          );
          if (step === null) return { error: invalidProof };
          const recoveryCodes = createRecoveryCodes();
          await tx.twoFactor.update({
            where: { userId: user.id },
            data: {
              secretEncrypted: state.pendingEncrypted,
              pendingEncrypted: null,
              pendingExpiresAt: null,
              lastUsedStep: step,
              recoveryHashes: recoveryCodes.map(recoveryHash),
            },
          });
          await tx.user.update({
            where: { id: user.id },
            data: { sessionVersion: { increment: 1 } },
          });
          await tx.twoFactorChallenge.deleteMany({
            where: { userId: user.id },
          });
          return { error: undefined, recoveryCodes };
        },
        ctx.session.sessionVersion ?? 0,
      );
      return unwrap(result);
    }),

  disable: protectedProcedure
    .input(proofSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await withSecurityLock(
        ctx.db,
        ctx.session.user.id,
        async (tx, user) => {
          if (!(await takeSecurityAttempt(tx, user.id)))
            return { error: tooMany };
          if (
            user.passwordHash &&
            !(await primaryProof(user, input.currentPassword, ctx.session))
          )
            return { error: invalidProof };
          if (!(await consumeFactor(tx, user, input.code)))
            return { error: invalidProof };
          await tx.twoFactor.update({
            where: { userId: user.id },
            data: {
              secretEncrypted: null,
              pendingEncrypted: null,
              pendingExpiresAt: null,
              lastUsedStep: null,
              recoveryHashes: [],
            },
          });
          await tx.user.update({
            where: { id: user.id },
            data: { sessionVersion: { increment: 1 } },
          });
          await tx.twoFactorChallenge.deleteMany({
            where: { userId: user.id },
          });
          return { error: undefined, success: true };
        },
        ctx.session.sessionVersion ?? 0,
      );
      return unwrap(result);
    }),

  regenerateRecoveryCodes: protectedProcedure
    .input(proofSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await withSecurityLock(
        ctx.db,
        ctx.session.user.id,
        async (tx, user) => {
          if (!(await takeSecurityAttempt(tx, user.id)))
            return { error: tooMany };
          if (
            user.passwordHash &&
            !(await primaryProof(user, input.currentPassword, ctx.session))
          )
            return { error: invalidProof };
          if (!(await consumeFactor(tx, user, input.code)))
            return { error: invalidProof };
          const recoveryCodes = createRecoveryCodes();
          await tx.twoFactor.update({
            where: { userId: user.id },
            data: { recoveryHashes: recoveryCodes.map(recoveryHash) },
          });
          return { error: undefined, recoveryCodes };
        },
        ctx.session.sessionVersion ?? 0,
      );
      return unwrap(result);
    }),
});
