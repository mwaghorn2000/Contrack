import type { JWT } from "next-auth/jwt";
import type { PrismaClient } from "../../../generated/prisma";
import { z } from "zod";
import { completeTwoFactor } from "./two-factor";

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
    twoFactorRequired?: boolean;
    challengeId?: string;
    challengeExpiresAt?: number;
    authTime?: number;
    authProvider?: string;
  }
}

export async function securityToken(
  db: PrismaClient,
  token: JWT,
  login?: {
    userId: string;
    provider: string;
    credentialVersion?: number;
  },
  update?: unknown,
): Promise<JWT | null> {
  const userId = login?.userId ?? token.sub;
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { twoFactor: true },
  });
  if (!user) return null;

  if (login) {
    // A password change between authorize() and this callback must invalidate that login.
    if (
      login.provider === "credentials" &&
      login.credentialVersion !== user.sessionVersion
    )
      return null;
    token.sub = user.id;
    token.sessionVersion = user.sessionVersion;
    token.authTime = Date.now();
    token.authProvider = login.provider;
    token.twoFactorRequired = !!user.twoFactor?.secretEncrypted;
    delete token.challengeId;
    delete token.challengeExpiresAt;
    if (token.twoFactorRequired) {
      await db.twoFactorChallenge.deleteMany({
        where: { userId, expiresAt: { lte: new Date() } },
      });
      const challenge = await db.twoFactorChallenge.create({
        data: { userId, expiresAt: new Date(Date.now() + 10 * 60_000) },
      });
      token.challengeId = challenge.id;
      token.challengeExpiresAt = challenge.expiresAt.getTime();
    }
  } else {
    if ((token.sessionVersion ?? 0) !== user.sessionVersion) return null;
    // Fail closed for old or malformed tokens once 2FA is enabled.
    if (user.twoFactor?.secretEncrypted && token.twoFactorRequired !== false)
      token.twoFactorRequired = true;
    if (token.twoFactorRequired) {
      if (
        !token.challengeId ||
        !token.challengeExpiresAt ||
        token.challengeExpiresAt <= Date.now()
      )
        return null;
      const parsed = z
        .object({ twoFactorCode: z.string().trim().min(1).max(128) })
        .safeParse(update);
      // Never trust a client-provided verified flag, version, identity, or timestamp.
      if (
        parsed.success &&
        (await completeTwoFactor(
          db,
          userId,
          token.challengeId,
          user.sessionVersion,
          parsed.data.twoFactorCode,
        ))
      ) {
        token.twoFactorRequired = false;
        delete token.challengeId;
        delete token.challengeExpiresAt;
      }
    }
  }
  return token;
}
