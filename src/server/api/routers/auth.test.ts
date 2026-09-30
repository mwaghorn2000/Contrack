import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { authRouter } from "./auth";
import { Prisma, type PrismaClient } from "../../../../generated/prisma";
import * as argon2 from "argon2";
import { sendVerificationEmail } from "~/server/email";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
// Only email delivery is fake. Password/code hashing and PostgreSQL are real.
vi.mock("~/server/email", () => ({ sendVerificationEmail: vi.fn() }));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let caller: ReturnType<typeof authRouter.createCaller>;
const email = "person@example.com";
const password = "a-secure-pass1";
const signup = { fullName: "Test User", email, password };

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  await clearTestDatabase(db);
  vi.mocked(sendVerificationEmail).mockReset();
  vi.mocked(sendVerificationEmail).mockResolvedValue(undefined);
  caller = authRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

it("signup stores a trimmed unverified user with a real password hash", async () => {
  const result = await caller.signup({
    fullName: " Test User ",
    email: ` ${email} `,
    password,
  });
  expect(result.success).toBe(true);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.name).toBe("Test User");
  expect(user.emailVerified).toBeNull();
  expect(user.passwordHash).not.toBe(password);
  expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  expect(await argon2.verify(user.passwordHash!, password)).toBe(true);
  expect(result).toHaveProperty("newUser.id", user.id);
  expect(result).not.toHaveProperty("newUser.passwordHash");
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("signup rejects an already verified email without creating another user", async () => {
  await db.user.create({
    data: { email, emailVerified: new Date(), name: "Original" },
  });
  await expect(
    caller.signup({ fullName: "Replacement", email, password }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.user.count()).toBe(1);
  expect((await db.user.findUniqueOrThrow({ where: { email } })).name).toBe(
    "Original",
  );
});

it("signup preserves an existing unverified account and asks for verification", async () => {
  const user = await db.user.create({
    data: { email, name: "Original", passwordHash: "unchanged" },
  });
  expect(
    await caller.signup({ fullName: "Replacement", email, password }),
  ).toEqual({ success: true, requiresEmailVerification: true });
  expect(await db.user.count()).toBe(1);
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    name: "Original",
    passwordHash: "unchanged",
  });
});

it("signup accepts a one-character name", async () => {
  const input = { ...signup, fullName: "A" };
  expect((await caller.signup(input)).success).toBe(true);
  expect(await db.user.count()).toBe(1);
});

it("signup accepts a 100-character Unicode name", async () => {
  const input = { ...signup, fullName: "😀".repeat(100) };
  expect((await caller.signup(input)).success).toBe(true);
  expect(await db.user.count()).toBe(1);
});

it("signup accepts a 12-character password", async () => {
  const input = { ...signup, password: "a".repeat(10) + "1!" };
  expect((await caller.signup(input)).success).toBe(true);
  expect(await db.user.count()).toBe(1);
});

it("signup accepts a 128-character Unicode password", async () => {
  const input = { ...signup, password: "😀".repeat(126) + "١!" };
  expect((await caller.signup(input)).success).toBe(true);
  expect(await db.user.count()).toBe(1);
});

it("signup accepts a 254-character email", async () => {
  const input = {
    ...signup,
    email:
      "a".repeat(64) +
      "@" +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(57) +
      ".com",
  };
  expect((await caller.signup(input)).success).toBe(true);
  expect(await db.user.count()).toBe(1);
});

it("signup rejects empty name without saving a user", async () => {
  const input = { ...signup, fullName: "" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects whitespace name without saving a user", async () => {
  const input = { ...signup, fullName: " " };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects 101-character name without saving a user", async () => {
  const input = { ...signup, fullName: "A".repeat(101) };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects control character in name without saving a user", async () => {
  const input = { ...signup, fullName: "a\u0000b" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects DEL character in name without saving a user", async () => {
  const input = { ...signup, fullName: "a\u007fb" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects C1 control character in name without saving a user", async () => {
  const input = { ...signup, fullName: "a\u009fb" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects invalid email without saving a user", async () => {
  const input = { ...signup, email: "invalid" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects empty email without saving a user", async () => {
  const input = { ...signup, email: "" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects 255-character email without saving a user", async () => {
  const input = {
    ...signup,
    email:
      "a".repeat(64) +
      "@" +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(58) +
      ".com",
  };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects 11-character password without saving a user", async () => {
  const input = { ...signup, password: "a".repeat(9) + "1!" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects 129-character password without saving a user", async () => {
  const input = { ...signup, password: "a".repeat(127) + "1!" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects password without a number without saving a user", async () => {
  const input = { ...signup, password: "long-password!" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("signup rejects password without a symbol without saving a user", async () => {
  const input = { ...signup, password: "longpassword123" };
  await expect(caller.signup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.user.count()).toBe(0);
});

it("verificationEmail saves a hashed six-digit code before sending it", async () => {
  const user = await db.user.create({ data: { email } });
  const before = Date.now();
  vi.mocked(sendVerificationEmail).mockImplementationOnce(
    async (recipient, code) => {
      expect(recipient).toBe(email);
      expect(code).toMatch(/^\d{6}$/);
      const saved = await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(saved.codeHash).not.toBe(code);
      expect(await argon2.verify(saved.codeHash, code)).toBe(true);
      expect(saved.attempts).toBe(0);
      expect(saved.expiresAt.getTime() - saved.lastSentAt.getTime()).toBe(
        600_000,
      );
      expect(saved.lastSentAt.getTime()).toBeGreaterThanOrEqual(before);
    },
  );
  expect(await caller.verificationEmail({ email: ` ${email} ` })).toEqual({
    success: true,
    alreadyVerified: false,
  });
  expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
});

it("verificationEmail rejects a missing account", async () => {
  await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.emailVerificationCode.count()).toBe(0);
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail skips already verified accounts", async () => {
  await db.user.create({ data: { email, emailVerified: new Date() } });
  expect(await caller.verificationEmail({ email })).toEqual({
    success: true,
    alreadyVerified: true,
  });
  expect(await db.emailVerificationCode.count()).toBe(0);
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail rejects a resend before 60 seconds without replacing the code", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  const previous = await db.emailVerificationCode.update({
    where: { userId: user.id },
    data: { lastSentAt: new Date() },
  });
  await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  expect(
    await db.emailVerificationCode.findUnique({ where: { userId: user.id } }),
  ).toEqual(previous);
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail replaces the code and resets attempts at the 60-second boundary", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  const now = new Date("2026-09-30T00:00:00Z");
  await db.emailVerificationCode.update({
    where: { userId: user.id },
    data: { lastSentAt: new Date(now.getTime() - 60_000), attempts: 5 },
  });
  // Fake only Date; database sockets and retry timers continue working normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  expect(await caller.verificationEmail({ email })).toEqual({
    success: true,
    alreadyVerified: false,
  });
  const saved = await db.emailVerificationCode.findUniqueOrThrow({
    where: { userId: user.id },
  });
  expect(saved.attempts).toBe(0);
  expect(saved.lastSentAt).toEqual(now);
  expect(saved.expiresAt).toEqual(new Date(now.getTime() + 600_000));
  expect(await db.emailVerificationCode.count()).toBe(1);
  const sentCode = vi.mocked(sendVerificationEmail).mock.calls[0]![1];
  expect(await argon2.verify(saved.codeHash, sentCode)).toBe(true);
});

it("verificationEmail retains the saved code and cooldown when email delivery fails", async () => {
  const user = await db.user.create({ data: { email } });
  vi.mocked(sendVerificationEmail).mockRejectedValueOnce(
    new Error("Email unavailable"),
  );
  await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(
    await db.emailVerificationCode.findUnique({ where: { userId: user.id } }),
  ).not.toBeNull();
  await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
});

it("verificationEmail retries a serialization conflict and sends only one email", async () => {
  await db.user.create({ data: { email } });
  // Inject one database conflict; the next attempt runs a real transaction.
  const conflict = new Prisma.PrismaClientKnownRequestError("Conflict", {
    code: "P2034",
    clientVersion: "test",
  });
  const transaction = vi
    .spyOn(db, "$transaction")
    .mockRejectedValueOnce(conflict);
  expect((await caller.verificationEmail({ email })).success).toBe(true);
  expect(transaction).toHaveBeenCalledTimes(2);
  expect(await db.emailVerificationCode.count()).toBe(1);
  expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
});

it("verificationEmail stops after three serialization conflicts without sending email", async () => {
  await db.user.create({ data: { email } });
  const conflict = new Prisma.PrismaClientKnownRequestError("Conflict", {
    code: "P2034",
    clientVersion: "test",
  });
  const transaction = vi.spyOn(db, "$transaction").mockRejectedValue(conflict);
  await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  expect(transaction).toHaveBeenCalledTimes(3);
  expect(await db.emailVerificationCode.count()).toBe(0);
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail does not retry unrelated transaction failures", async () => {
  await db.user.create({ data: { email } });
  const transaction = vi
    .spyOn(db, "$transaction")
    .mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(await db.emailVerificationCode.count()).toBe(0);
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail rejects invalid email", async () => {
  await expect(
    caller.verificationEmail({ email: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail rejects empty email", async () => {
  await expect(caller.verificationEmail({ email: "" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verificationEmail rejects 255-character email", async () => {
  await expect(
    caller.verificationEmail({
      email:
        "a".repeat(64) +
        "@" +
        "b".repeat(63) +
        "." +
        "c".repeat(63) +
        "." +
        "d".repeat(58) +
        ".com",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("verifyEmail verifies the account and deletes the used code", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  expect(
    await caller.verifyEmail({ email: ` ${email} `, code: "012345" }),
  ).toEqual({ success: true, alreadyVerified: false });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).toBeInstanceOf(Date);
  expect(
    await db.emailVerificationCode.findUnique({ where: { userId: user.id } }),
  ).toBeNull();
});

it("verifyEmail accepts a code delivered by verificationEmail", async () => {
  const user = await db.user.create({ data: { email } });
  await caller.verificationEmail({ email });
  const sentCode = vi.mocked(sendVerificationEmail).mock.calls[0]![1];
  expect(await caller.verifyEmail({ email, code: sentCode })).toEqual({
    success: true,
    alreadyVerified: false,
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).not.toBeNull();
});

it("verifyEmail is idempotent for an already verified account", async () => {
  const verifiedAt = new Date("2026-01-01");
  const user = await db.user.create({
    data: { email, emailVerified: verifiedAt },
  });
  expect(await caller.verifyEmail({ email, code: "012345" })).toEqual({
    success: true,
    alreadyVerified: true,
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).toEqual(verifiedAt);
});

it("verifyEmail rejects a missing account", async () => {
  await expect(
    caller.verifyEmail({ email, code: "012345" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("verifyEmail rejects an account without a verification code", async () => {
  const user = await db.user.create({ data: { email } });
  await expect(
    caller.verifyEmail({ email, code: "012345" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).toBeNull();
});

it("verifyEmail rejects an expired code", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  const now = new Date("2026-09-30T00:00:00Z");
  await db.emailVerificationCode.update({
    where: { userId: user.id },
    data: { expiresAt: new Date(now.getTime() + -1) },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await expect(
    caller.verifyEmail({ email, code: "012345" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).toBeNull();
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects a code at the exact expiry time", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  const now = new Date("2026-09-30T00:00:00Z");
  await db.emailVerificationCode.update({
    where: { userId: user.id },
    data: { expiresAt: new Date(now.getTime() + 0) },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await expect(
    caller.verifyEmail({ email, code: "012345" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).toBeNull();
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail accepts a correct code after four failed attempts", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await db.emailVerificationCode.update({
    where: { userId: user.id },
    data: { attempts: 4 },
  });
  expect((await caller.verifyEmail({ email, code: "012345" })).success).toBe(
    true,
  );
  expect(await db.emailVerificationCode.count()).toBe(0);
});

it("verifyEmail commits incorrect attempts and blocks a correct code after five failures", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(
      caller.verifyEmail({ email, code: "999999" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid verification code.",
    });
    expect(
      (
        await db.emailVerificationCode.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).attempts,
    ).toBe(attempt);
  }
  await expect(
    caller.verifyEmail({ email, code: "012345" }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).toBeNull();
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(5);
});

it("verifyEmail rolls back the user update when deleting the code fails", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  // Force PostgreSQL to reject this transaction's DELETE after its user UPDATE.
  // Both SQL statements run only against this file's disposable container.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_code_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated delete failure'; END; $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_code_delete BEFORE DELETE ON "EmailVerificationCode" FOR EACH ROW EXECUTE FUNCTION fail_code_delete()`,
  );
  try {
    await expect(
      caller.verifyEmail({ email, code: "012345" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailVerified,
    ).toBeNull();
    expect(
      await db.emailVerificationCode.findUnique({ where: { userId: user.id } }),
    ).not.toBeNull();
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER fail_code_delete ON "EmailVerificationCode"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION fail_code_delete()`);
  }
});

it("verifyEmail retries a serialization conflict and completes verification", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  const conflict = new Prisma.PrismaClientKnownRequestError("Conflict", {
    code: "P2034",
    clientVersion: "test",
  });
  const transaction = vi
    .spyOn(db, "$transaction")
    .mockRejectedValueOnce(conflict);
  expect((await caller.verifyEmail({ email, code: "012345" })).success).toBe(
    true,
  );
  expect(transaction).toHaveBeenCalledTimes(2);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
  ).not.toBeNull();
  expect(await db.emailVerificationCode.count()).toBe(0);
});

it("verifyEmail rejects empty code without consuming an attempt", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await expect(caller.verifyEmail({ email, code: "" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects five-digit code without consuming an attempt", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await expect(
    caller.verifyEmail({ email, code: "12345" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects seven-digit code without consuming an attempt", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await expect(
    caller.verifyEmail({ email, code: "1234567" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects letters in code without consuming an attempt", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await expect(
    caller.verifyEmail({ email, code: "abcdef" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects whitespace around code without consuming an attempt", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await expect(
    caller.verifyEmail({ email, code: " 012345 " }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects non-ASCII digits without consuming an attempt", async () => {
  const user = await db.user.create({ data: { email } });
  await db.emailVerificationCode.create({
    data: {
      userId: user.id,
      codeHash: await argon2.hash("012345", { type: argon2.argon2id }),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(Date.now() - 120_000),
      attempts: 0,
    },
  });
  await expect(
    caller.verifyEmail({ email, code: "１２３４５６" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (
      await db.emailVerificationCode.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).attempts,
  ).toBe(0);
});

it("verifyEmail rejects a malformed email", async () => {
  await expect(
    caller.verifyEmail({ email: "invalid", code: "012345" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
