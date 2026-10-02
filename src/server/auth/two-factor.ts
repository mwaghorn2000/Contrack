import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { env } from "~/env";
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "../../../generated/prisma";

export function authenticator(secret?: string, label = "Contrack") {
  return new TOTP({
    issuer: "Contrack",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secret ?? new Secret({ size: 20 }),
  });
}

function encryptionKey() {
  if (!env.AUTH_SECRET)
    throw new Error(
      "AUTH_SECRET must be set to use two-factor authentication.",
    );
  return createHash("sha256")
    .update(`contrack:two-factor:v1:${env.AUTH_SECRET}`)
    .digest();
}

export function encryptSecret(secret: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(value: string, userId: string) {
  const [iv, tag, encrypted] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted)
    throw new Error("Invalid encrypted authenticator secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

export function recoveryHash(code: string) {
  return createHash("sha256")
    .update(code.replace(/[-\s]/g, "").toLowerCase())
    .digest("hex");
}

export function createRecoveryCodes() {
  // Each single-use code has 128 bits of random entropy. Only hashes are stored.
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
  );
}

export type SecurityUser = Prisma.UserGetPayload<{
  include: { twoFactor: true };
}>;

// Serialize attempts, recovery-code consumption, setup, and password changes per user.
// Return failures instead of throwing inside this transaction so attempt counts commit.
export async function withSecurityLock<T>(
  db: PrismaClient,
  userId: string,
  operation: (tx: Prisma.TransactionClient, user: SecurityUser) => Promise<T>,
  expectedVersion?: number,
) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { twoFactor: true },
      });
      if (
        expectedVersion !== undefined &&
        user.sessionVersion !== expectedVersion
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Your security settings changed. Please sign in again.",
        });
      }
      return operation(tx, user);
    },
    { timeout: 15_000 },
  );
}

export async function takeSecurityAttempt(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const state = await tx.twoFactor.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  const now = new Date();
  const expired =
    now.getTime() - state.windowStartedAt.getTime() >= 10 * 60_000;
  if (!expired && state.attempts >= 10) return false;
  await tx.twoFactor.update({
    where: { userId },
    data: {
      attempts: expired ? 1 : state.attempts + 1,
      ...(expired ? { windowStartedAt: now } : {}),
    },
  });
  return true;
}

export function matchingStep(
  encrypted: string,
  userId: string,
  code: string,
  lastStep: number | null,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const timestamp = Date.now();
  const delta = authenticator(decryptSecret(encrypted, userId)).validate({
    token: code,
    timestamp,
    window: 1,
  });
  if (delta === null) return null;
  const step = Math.floor(timestamp / 30_000) + delta;
  return lastStep === null || step > lastStep ? step : null;
}

export async function consumeFactor(
  tx: Prisma.TransactionClient,
  user: SecurityUser,
  code: string,
) {
  const state = user.twoFactor;
  if (!state?.secretEncrypted) return false;
  const step = matchingStep(
    state.secretEncrypted,
    user.id,
    code,
    state.lastUsedStep,
  );
  if (step !== null) {
    await tx.twoFactor.update({
      where: { userId: user.id },
      data: { lastUsedStep: step },
    });
    return true;
  }
  const hash = recoveryHash(code);
  if (!state.recoveryHashes.includes(hash)) return false;
  await tx.twoFactor.update({
    where: { userId: user.id },
    data: {
      recoveryHashes: state.recoveryHashes.filter((entry) => entry !== hash),
    },
  });
  return true;
}

export async function completeTwoFactor(
  db: PrismaClient,
  userId: string,
  challengeId: string,
  version: number,
  code: string,
) {
  return withSecurityLock(db, userId, async (tx, user) => {
    if (user.sessionVersion !== version) return false;
    const challenge = await tx.twoFactorChallenge.findUnique({
      where: { id: challengeId },
    });
    if (
      challenge?.userId !== userId ||
      challenge.expiresAt.getTime() <= Date.now()
    )
      return false;
    if (!(await takeSecurityAttempt(tx, userId))) return false;
    if (!(await consumeFactor(tx, user, code))) return false;
    await tx.twoFactorChallenge.delete({ where: { id: challengeId } });
    return true;
  });
}
