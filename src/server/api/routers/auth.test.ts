import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as argon2 from "argon2";
import { Prisma } from "../../../../generated/prisma";
import { sendVerificationEmail } from "~/server/email";
import { createTestContext } from "~/test/helpers";
import { authRouter } from "./auth";

const now = new Date("2026-09-30T00:00:00Z");
const email = "person@example.com";
const signup = { fullName: "Test Person", email, password: "a-secure-pass1" };
const verification = {
  codeHash: "hashed-code",
  expiresAt: new Date(now.getTime() + 600_000),
  lastSentAt: new Date(now.getTime() - 60_000),
  attempts: 0,
};
const user = {
  id: "cltestuser0000000000000001",
  email,
  emailVerified: null,
  emailVerificationCode: verification,
};

function setup() {
  const context = createTestContext({ session: null });
  return { ...context, caller: authRouter.createCaller(context.ctx) };
}

function conflict() {
  return new Prisma.PrismaClientKnownRequestError("Serialization conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.mocked(argon2.hash).mockResolvedValue("hashed-code");
  vi.mocked(argon2.verify).mockResolvedValue(true);
  vi.mocked(sendVerificationEmail).mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("auth.signup", () => {
  it("creates an unverified user with a trimmed name/email and an Argon2id password", async () => {
    const { caller, db } = setup();
    db.user.findFirst.mockResolvedValue(null);
    const created = {
      id: user.id,
      name: signup.fullName,
      email,
      emailVerified: null,
    };
    db.user.create.mockResolvedValue(created);
    await expect(
      caller.signup({
        ...signup,
        fullName: "  Test Person  ",
        email: ` ${email} `,
      }),
    ).resolves.toEqual({ success: true, newUser: created });
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { email } });
    expect(argon2.hash).toHaveBeenCalledWith(signup.password, {
      type: argon2.argon2id,
    });
    expect(db.user.create).toHaveBeenCalledWith({
      data: { name: signup.fullName, email, passwordHash: "hashed-code" },
      select: { id: true, name: true, email: true, emailVerified: true },
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns the verification requirement for an existing unverified account", async () => {
    const { caller, db } = setup();
    db.user.findFirst.mockResolvedValue(user);
    await expect(caller.signup(signup)).resolves.toEqual({
      success: true,
      requiresEmailVerification: true,
    });
    expect(argon2.hash).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("rejects an existing verified account without modifying it", async () => {
    const { caller, db } = setup();
    db.user.findFirst.mockResolvedValue({ ...user, emailVerified: now });
    await expect(caller.signup(signup)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(argon2.hash).not.toHaveBeenCalled();
  });

  it.each([
    { fullName: "   " },
    { fullName: "x".repeat(101) },
    { fullName: "a\u0000b" },
    { fullName: "a\u007fb" },
    { fullName: "a\u009fb" },
    { email: "invalid" },
    { email: "" },
    { email: `${"x".repeat(243)}@example.com` },
    { password: "abc123!" },
    { password: "x".repeat(127) + "1!" },
    { password: "letters-only!" },
    { password: "lettersand123" },
  ])(
    "rejects invalid signup input %j before database access",
    async (invalid) => {
      const { caller, db } = setup();
      await expect(
        caller.signup({ ...signup, ...invalid }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.user.findFirst).not.toHaveBeenCalled();
      expect(argon2.hash).not.toHaveBeenCalled();
    },
  );

  it.each(["a".repeat(10) + "1!", "😀".repeat(126) + "١!"])(
    "accepts password character-count boundaries and Unicode: %s",
    async (password) => {
      const { caller, db } = setup();
      db.user.findFirst.mockResolvedValue(null);
      db.user.create.mockResolvedValue(user);
      await expect(
        caller.signup({ ...signup, fullName: "😀".repeat(100), password }),
      ).resolves.toMatchObject({ success: true });
    },
  );

  it("propagates hashing failure without creating a user", async () => {
    const { caller, db } = setup();
    db.user.findFirst.mockResolvedValue(null);
    vi.mocked(argon2.hash).mockRejectedValueOnce(new Error("hash failed"));
    await expect(caller.signup(signup)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "hash failed",
    });
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

describe("auth.verificationEmail", () => {
  it("replaces an old code at the cooldown boundary and emails it after committing", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue(user);
    tx.emailVerificationCode.upsert.mockResolvedValue({});
    vi.mocked(sendVerificationEmail).mockImplementationOnce(async () => {
      await expect(db.$transaction.mock.results[0]!.value).resolves.toEqual({
        status: "send",
        email,
      });
    });
    await expect(
      caller.verificationEmail({ email: ` ${email} ` }),
    ).resolves.toEqual({ success: true, alreadyVerified: false });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(tx.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email } }),
    );
    const data = {
      codeHash: "hashed-code",
      expiresAt: verification.expiresAt,
      attempts: 0,
      lastSentAt: now,
    };
    expect(tx.emailVerificationCode.upsert).toHaveBeenCalledWith({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      email,
      expect.stringMatching(/^\d{6}$/),
    );
    expect(argon2.hash).toHaveBeenCalledWith(
      vi.mocked(sendVerificationEmail).mock.calls[0]![1],
      { type: argon2.argon2id },
    );
  });

  it("creates the first verification code", async () => {
    const { caller, tx } = setup();
    tx.user.findUnique.mockResolvedValue({
      ...user,
      emailVerificationCode: null,
    });
    tx.emailVerificationCode.upsert.mockResolvedValue({});
    await expect(caller.verificationEmail({ email })).resolves.toMatchObject({
      success: true,
    });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, "NOT_FOUND"],
    [{ ...user, email: null }, "BAD_REQUEST"],
    [
      {
        ...user,
        emailVerificationCode: {
          ...verification,
          lastSentAt: new Date(now.getTime() - 59_999),
        },
      },
      "TOO_MANY_REQUESTS",
    ],
  ])("rejects unavailable or throttled accounts (%s)", async (record, code) => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue(record);
    await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
      code,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.emailVerificationCode.upsert).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("does not issue or send another code for a verified user", async () => {
    const { caller, tx } = setup();
    tx.user.findUnique.mockResolvedValue({ ...user, emailVerified: now });
    await expect(caller.verificationEmail({ email })).resolves.toEqual({
      success: true,
      alreadyVerified: true,
    });
    expect(tx.emailVerificationCode.upsert).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("retries serialization conflicts, but hashes and sends the code only once", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue(user);
    tx.emailVerificationCode.upsert
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue({});
    await expect(caller.verificationEmail({ email })).resolves.toMatchObject({
      success: true,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(argon2.hash).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("stops after three serialization conflicts without sending email", async () => {
    const { caller, db } = setup();
    db.$transaction.mockRejectedValue(conflict());
    await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("does not retry other database errors", async () => {
    const { caller, db } = setup();
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Database error", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("retains the committed code and cooldown when email delivery fails without retrying", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue(user);
    tx.emailVerificationCode.upsert.mockResolvedValue({});
    vi.mocked(sendVerificationEmail).mockRejectedValueOnce(
      new Error("Mail unavailable"),
    );
    await expect(caller.verificationEmail({ email })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "We couldn't send your verification code. Please try again.",
    });
    await expect(db.$transaction.mock.results[0]!.value).resolves.toEqual({
      status: "send",
      email,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(tx.emailVerificationCode.delete).not.toHaveBeenCalled();
  });

  it.each(["", "invalid", `${"x".repeat(243)}@example.com`])(
    "rejects invalid email %s before starting a transaction",
    async (invalidEmail) => {
      const { caller, db } = setup();
      await expect(
        caller.verificationEmail({ email: invalidEmail }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(argon2.hash).not.toHaveBeenCalled();
    },
  );
});

describe("auth.verifyEmail", () => {
  it("marks the user verified and removes the code in one serializable transaction", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue(user);
    tx.user.update.mockResolvedValue({});
    tx.emailVerificationCode.delete.mockResolvedValue({});
    await expect(
      caller.verifyEmail({ email: ` ${email} `, code: "012345" }),
    ).resolves.toEqual({ success: true, alreadyVerified: false });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(argon2.verify).toHaveBeenCalledWith("hashed-code", "012345");
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { emailVerified: now },
    });
    expect(tx.emailVerificationCode.delete).toHaveBeenCalledWith({
      where: { userId: user.id },
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns success for an already verified account without checking a code", async () => {
    const { caller, tx } = setup();
    tx.user.findUnique.mockResolvedValue({
      ...user,
      emailVerified: now,
      emailVerificationCode: null,
    });
    await expect(
      caller.verifyEmail({ email, code: "012345" }),
    ).resolves.toEqual({ success: true, alreadyVerified: true });
    expect(argon2.verify).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.emailVerificationCode.delete).not.toHaveBeenCalled();
  });

  it.each([
    [null, "NOT_FOUND", "No account was found"],
    [
      { ...user, emailVerificationCode: null },
      "BAD_REQUEST",
      "No verification code found",
    ],
    [
      { ...user, emailVerificationCode: { ...verification, expiresAt: now } },
      "BAD_REQUEST",
      "expired",
    ],
    [
      { ...user, emailVerificationCode: { ...verification, attempts: 5 } },
      "TOO_MANY_REQUESTS",
      "Too many incorrect attempts",
    ],
  ])("rejects unverifiable accounts (%s)", async (record, code, message) => {
    const { caller, tx } = setup();
    tx.user.findUnique.mockResolvedValue(record);
    const result = caller.verifyEmail({ email, code: "012345" });
    await expect(result).rejects.toMatchObject({ code });
    await expect(result).rejects.toThrow(message);
    expect(argon2.verify).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.emailVerificationCode.update).not.toHaveBeenCalled();
  });

  it("commits the fifth failed attempt before returning BAD_REQUEST", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue({
      ...user,
      emailVerificationCode: { ...verification, attempts: 4 },
    });
    tx.emailVerificationCode.update.mockResolvedValue({});
    vi.mocked(argon2.verify).mockResolvedValueOnce(false);
    await expect(
      caller.verifyEmail({ email, code: "999999" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid verification code.",
    });
    expect(tx.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { userId: user.id },
      data: { attempts: { increment: 1 } },
    });
    await expect(db.$transaction.mock.results[0]!.value).resolves.toEqual({
      status: "invalid",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.emailVerificationCode.delete).not.toHaveBeenCalled();
  });

  it("retries a serialization conflict and completes verification", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue(user);
    tx.user.update.mockResolvedValue({});
    tx.emailVerificationCode.delete.mockResolvedValue({});
    await expect(
      caller.verifyEmail({ email, code: "012345" }),
    ).resolves.toMatchObject({ success: true });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it("propagates hashing failures without consuming an attempt", async () => {
    const { caller, db, tx } = setup();
    tx.user.findUnique.mockResolvedValue(user);
    vi.mocked(argon2.verify).mockRejectedValueOnce(new Error("hash failed"));
    await expect(
      caller.verifyEmail({ email, code: "012345" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.emailVerificationCode.update).not.toHaveBeenCalled();
  });

  it.each(["", "12345", "1234567", "abcdef", " 123456", "１２３４５６"])(
    "rejects invalid verification code %s",
    async (code) => {
      const { caller, db } = setup();
      await expect(caller.verifyEmail({ email, code })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed email before starting a transaction", async () => {
    const { caller, db } = setup();
    await expect(
      caller.verifyEmail({ email: "invalid", code: "123456" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
