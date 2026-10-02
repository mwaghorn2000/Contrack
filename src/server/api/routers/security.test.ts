import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { PrismaClient } from "../../../../generated/prisma";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { securityRouter } from "./security";
import { profileRouter } from "./profile";
import {
  authenticator,
  completeTwoFactor,
  decryptSecret,
  encryptSecret,
  recoveryHash,
} from "~/server/auth/two-factor";
import { securityToken } from "~/server/auth/security-token";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/env", () => ({
  env: { AUTH_SECRET: "test-only-secret-not-used-outside-disposable-database" },
}));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let userId: string;
let session: Session;
let caller: ReturnType<typeof securityRouter.createCaller>;
const password = "original-password1!";
const newPassword = "replacement-password2!";

function context(value: Session | null = session) {
  return { db, session: value, headers: new Headers() };
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);
beforeEach(async () => {
  await clearTestDatabase(db);
  const user = await db.user.create({
    data: {
      email: "secure@example.com",
      emailVerified: new Date(),
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  userId = user.id;
  session = {
    user: { id: userId, email: user.email },
    expires: "2099-01-01",
    sessionVersion: 0,
    authProvider: "credentials",
    authTime: Date.now(),
    twoFactorRequired: false,
  };
  caller = securityRouter.createCaller(context());
});
afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

async function setup() {
  const result = await caller.beginSetup({ currentPassword: password });
  const secret = result.secret!;
  const enabled = await caller.enable({
    currentPassword: password,
    code: authenticator(secret).generate(),
  });
  return { secret, codes: enabled.recoveryCodes! };
}

function freshCaller(version = 1) {
  return securityRouter.createCaller(
    context({ ...session, sessionVersion: version }),
  );
}

async function login(provider = "credentials") {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return (await securityToken(
    db,
    {},
    { userId, provider, credentialVersion: user.sessionVersion },
  ))!;
}

it("changes a password after checking the current one and invalidates existing sessions", async () => {
  const oldToken = await login();
  await caller.changePassword({ currentPassword: password, newPassword });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(await argon2.verify(user.passwordHash!, newPassword)).toBe(true);
  expect(await argon2.verify(user.passwordHash!, password)).toBe(false);
  expect(user.sessionVersion).toBe(1);
  expect(await securityToken(db, oldToken)).toBeNull();
  await expect(caller.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rejects incorrect, unchanged, and weak passwords without changing the account", async () => {
  await expect(
    caller.changePassword({ currentPassword: "incorrect", newPassword }),
  ).rejects.toThrow();
  await expect(
    caller.changePassword({ currentPassword: password, newPassword: password }),
  ).rejects.toThrow();
  await expect(
    caller.changePassword({ currentPassword: password, newPassword: "weak" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(await argon2.verify(user.passwordHash!, password)).toBe(true);
  expect(user.sessionVersion).toBe(0);
});

it("does not add a password to a Google-only account", async () => {
  await db.user.update({ where: { id: userId }, data: { passwordHash: null } });
  await expect(
    caller.changePassword({ currentPassword: password, newPassword }),
  ).rejects.toThrow(/provider/);
  expect((await caller.get()).hasPassword).toBe(false);
});

it("encrypts the pending setup secret and requires confirmation before enabling", async () => {
  const result = await caller.beginSetup({ currentPassword: password });
  expect(result.qrCode).toMatch(/^data:image\/png;base64,/);
  const state = await db.twoFactor.findUniqueOrThrow({ where: { userId } });
  expect(state.secretEncrypted).toBeNull();
  expect(state.pendingEncrypted).not.toContain(result.secret);
  expect(decryptSecret(state.pendingEncrypted!, userId)).toBe(result.secret);
  expect(() =>
    decryptSecret(state.pendingEncrypted!, "another-user"),
  ).toThrow();
  expect((await caller.get()).enabled).toBe(false);
  await expect(
    caller.enable({ currentPassword: password, code: "bad" }),
  ).rejects.toThrow();
  expect((await caller.get()).enabled).toBe(false);
});

it("rejects expired setup and replacement setup invalidates the previous key", async () => {
  const first = await caller.beginSetup({ currentPassword: password });
  const second = await caller.beginSetup({ currentPassword: password });
  expect(second.secret).not.toBe(first.secret);
  await db.twoFactor.update({
    where: { userId },
    data: { pendingExpiresAt: new Date(0) },
  });
  await expect(
    caller.enable({
      currentPassword: password,
      code: authenticator(second.secret).generate(),
    }),
  ).rejects.toThrow(/expired/);
});

it("enables 2FA with hashed recovery codes, revokes sessions, and hides secrets from settings", async () => {
  const { codes } = await setup();
  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);
  const state = await db.twoFactor.findUniqueOrThrow({ where: { userId } });
  expect(state.pendingEncrypted).toBeNull();
  expect(state.recoveryHashes).toEqual(codes.map(recoveryHash));
  await expect(caller.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await freshCaller().get()).toEqual({
    hasPassword: true,
    enabled: true,
    recoveryCodesRemaining: 10,
    needsRecentSignIn: false,
  });
  await expect(
    freshCaller().beginSetup({ currentPassword: password }),
  ).rejects.toThrow(/already enabled/);
});

it.each(["credentials", "google"])(
  "requires a second factor after %s sign-in",
  async (provider) => {
    const { codes } = await setup();
    const token = await login(provider);
    expect(token.twoFactorRequired).toBe(true);
    expect(token.challengeId).toBeTruthy();
    const verified = await securityToken(db, { ...token }, undefined, {
      twoFactorCode: codes[0],
    });
    expect(verified?.twoFactorRequired).toBe(false);
    expect(verified?.challengeId).toBeUndefined();
    expect(await db.twoFactorChallenge.count()).toBe(0);
    expect(
      (await db.twoFactor.findUniqueOrThrow({ where: { userId } }))
        .recoveryHashes,
    ).toHaveLength(9);
  },
);

it("ignores client-supplied security flags, identity, version, and timestamps", async () => {
  await setup();
  const token = await login();
  const result = await securityToken(db, { ...token }, undefined, {
    twoFactorRequired: false,
    sessionVersion: 999,
    sub: "another-user",
    authTime: Date.now() + 1000000,
  });
  expect(result).toEqual(token);
});

it("blocks pending sessions from protected APIs", async () => {
  const pending = { ...session, twoFactorRequired: true };
  await expect(
    securityRouter.createCaller(context(pending)).get(),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    profileRouter.createCaller(context(pending)).get(),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rejects expired, missing, wrong-user, and already consumed challenges", async () => {
  const { codes } = await setup();
  const token = await login();
  const challengeId = token.challengeId!;
  expect(await completeTwoFactor(db, userId, "missing", 1, codes[0]!)).toBe(
    false,
  );
  const other = await db.user.create({ data: { email: "other@example.com" } });
  expect(await completeTwoFactor(db, other.id, challengeId, 0, codes[0]!)).toBe(
    false,
  );
  await db.twoFactorChallenge.update({
    where: { id: challengeId },
    data: { expiresAt: new Date(0) },
  });
  expect(await completeTwoFactor(db, userId, challengeId, 1, codes[0]!)).toBe(
    false,
  );
  expect(
    await securityToken(db, { ...token, challengeExpiresAt: 0 }),
  ).toBeNull();
  const fresh = await login();
  expect(
    await completeTwoFactor(db, userId, fresh.challengeId!, 1, codes[0]!),
  ).toBe(true);
  expect(
    await completeTwoFactor(db, userId, fresh.challengeId!, 1, codes[1]!),
  ).toBe(false);
});

it("allows only one concurrent use of a recovery code across separate logins", async () => {
  const { codes } = await setup();
  const a = await login();
  const b = await login("google");
  const results = await Promise.all(
    [a, b].map((token) =>
      completeTwoFactor(db, userId, token.challengeId!, 1, codes[0]!),
    ),
  );
  expect(results.sort()).toEqual([false, true]);
});

it("accepts a fresh authenticator code and rejects reuse", async () => {
  const { secret } = await setup();
  // Setup consumes the current step. A fresh next-window code is accepted within the drift window.
  const code = authenticator(secret).generate({
    timestamp: Date.now() + 30_000,
  });
  const first = await login();
  expect(await completeTwoFactor(db, userId, first.challengeId!, 1, code)).toBe(
    true,
  );
  const second = await login();
  expect(
    await completeTwoFactor(db, userId, second.challengeId!, 1, code),
  ).toBe(false);
});

it("limits attempts across new sign-in challenges and resumes after the cooldown", async () => {
  const { codes } = await setup();
  await db.twoFactor.update({ where: { userId }, data: { attempts: 9 } });
  const first = await login();
  expect(
    await completeTwoFactor(db, userId, first.challengeId!, 1, "wrong"),
  ).toBe(false);
  const second = await login();
  expect(
    await completeTwoFactor(db, userId, second.challengeId!, 1, codes[0]!),
  ).toBe(false);
  await db.twoFactor.update({
    where: { userId },
    data: { windowStartedAt: new Date(Date.now() - 11 * 60_000) },
  });
  expect(
    await completeTwoFactor(db, userId, second.challengeId!, 1, codes[0]!),
  ).toBe(true);
});

it("requires current password and second factor for password changes when enabled", async () => {
  const { codes } = await setup();
  const active = freshCaller();
  await expect(
    active.changePassword({ currentPassword: password, newPassword }),
  ).rejects.toThrow();
  await expect(
    active.changePassword({
      currentPassword: "bad",
      newPassword,
      code: codes[0],
    }),
  ).rejects.toThrow();
  await active.changePassword({
    currentPassword: password,
    newPassword,
    code: codes[0],
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion,
  ).toBe(2);
});

it("replaces recovery codes only after proof and makes the old codes unusable", async () => {
  const { codes } = await setup();
  const result = await freshCaller().regenerateRecoveryCodes({
    currentPassword: password,
    code: codes[0],
  });
  const token = await login();
  expect(
    await completeTwoFactor(db, userId, token.challengeId!, 1, codes[1]!),
  ).toBe(false);
  expect(
    await completeTwoFactor(
      db,
      userId,
      token.challengeId!,
      1,
      result.recoveryCodes![0]!,
    ),
  ).toBe(true);
});

it("disables 2FA only after proof, clears secrets and challenges, and revokes sessions", async () => {
  const { codes } = await setup();
  const token = await login();
  const active = freshCaller();
  await expect(
    active.disable({ currentPassword: password, code: "bad" }),
  ).rejects.toThrow();
  await active.disable({ currentPassword: password, code: codes[0] });
  const state = await db.twoFactor.findUniqueOrThrow({ where: { userId } });
  expect(state.secretEncrypted).toBeNull();
  expect(state.recoveryHashes).toEqual([]);
  expect(await db.twoFactorChallenge.count()).toBe(0);
  expect(await securityToken(db, token)).toBeNull();
  expect((await login()).twoFactorRequired).toBe(false);
});

it("requires recent provider sign-in to set up a Google-only account", async () => {
  await db.user.update({ where: { id: userId }, data: { passwordHash: null } });
  const old = securityRouter.createCaller(
    context({ ...session, authProvider: "google", authTime: 0 }),
  );
  expect((await old.get()).needsRecentSignIn).toBe(true);
  await expect(old.beginSetup({})).rejects.toThrow(
    /sign in with your provider/,
  );
  const recent = securityRouter.createCaller(
    context({ ...session, authProvider: "google", authTime: Date.now() }),
  );
  const result = await recent.beginSetup({});
  expect(
    (await recent.enable({ code: authenticator(result.secret).generate() }))
      .recoveryCodes,
  ).toHaveLength(10);
});

it("rejects anonymous access and attempts to choose another user", async () => {
  const anonymous = securityRouter.createCaller(context(null));
  await expect(anonymous.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    anonymous.beginSetup({ currentPassword: password }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    caller.changePassword({
      currentPassword: password,
      newPassword,
      userId: "other",
    } as Parameters<typeof caller.changePassword>[0]),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rejects a credential login if its password was changed before the JWT was issued", async () => {
  await caller.changePassword({ currentPassword: password, newPassword });
  expect(
    await securityToken(
      db,
      {},
      { userId, provider: "credentials", credentialVersion: 0 },
    ),
  ).toBeNull();
});

it("rejects legacy tokens without second-factor proof once 2FA is enabled", async () => {
  await setup();
  const old: JWT = { sub: userId };
  expect(await securityToken(db, old)).toBeNull();
  expect(await securityToken(db, { ...old, sessionVersion: 1 })).toBeNull();
});

it("does not change account security through an already revoked session", async () => {
  await caller.changePassword({ currentPassword: password, newPassword });
  await expect(
    caller.beginSetup({ currentPassword: newPassword }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("detects changes to encrypted authenticator data", () => {
  const encrypted = encryptSecret("TEST", userId);
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  expect(() => decryptSecret(parts.join("."), userId)).toThrow();
});
