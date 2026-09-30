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
import { invitationRouter } from "./invitation";
import { sendCompanyInvitationEmail } from "~/server/email";
import { hashInvitationToken } from "~/server/invitations";
import type { PrismaClient } from "../../../../generated/prisma";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/email", () => ({ sendCompanyInvitationEmail: vi.fn() }));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let ownerId: string;
let companyId: string;
let recipientId: string;
let owner: ReturnType<typeof invitationRouter.createCaller>;
let recipient: ReturnType<typeof invitationRouter.createCaller>;
const email = "newperson@example.com";

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  await clearTestDatabase(db);
  vi.mocked(sendCompanyInvitationEmail).mockReset();
  vi.mocked(sendCompanyInvitationEmail).mockResolvedValue(undefined);
  const user = await db.user.create({
    data: {
      email: "owner@example.com",
      name: "Owner",
      emailVerified: new Date(),
    },
  });
  ownerId = user.id;
  const company = await db.company.create({
    data: {
      name: "Acme",
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
  companyId = company.id;
  const invitee = await db.user.create({
    data: { email, name: "New Person", emailVerified: new Date() },
  });
  recipientId = invitee.id;
  owner = invitationRouter.createCaller({
    db,
    session: { user: { id: ownerId }, expires: "2099-01-01" },
    headers: new Headers(),
  });
  recipient = invitationRouter.createCaller({
    db,
    session: { user: { id: recipientId }, expires: "2099-01-01" },
    headers: new Headers(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

it("invites someone who has no account and stores only the token hash", async () => {
  await db.user.delete({ where: { id: recipientId } });
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const token = vi.mocked(sendCompanyInvitationEmail).mock.calls[0]![0].token;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  const saved = await db.companyInvitation.findUniqueOrThrow({
    where: { id: invitation.id },
  });
  expect(saved.email).toBe(email);
  expect(saved.tokenHash).toBe(hashInvitationToken(token));
  expect(saved.tokenHash).not.toBe(token);
  expect(saved.expiresAt.getTime() - saved.createdAt.getTime()).toBeGreaterThan(
    86_390_000,
  );
  expect(
    saved.expiresAt.getTime() - saved.createdAt.getTime(),
  ).toBeLessThanOrEqual(86_400_000);
  expect(invitation).not.toHaveProperty("tokenHash");
  expect(invitation).not.toHaveProperty("token");
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  expect(sendCompanyInvitationEmail).toHaveBeenCalledTimes(1);
});

it("invitation remains usable after the recipient signs up later", async () => {
  await db.user.delete({ where: { id: recipientId } });
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const token = vi.mocked(sendCompanyInvitationEmail).mock.calls[0]![0].token;
  const newcomer = await db.user.create({
    data: { email, emailVerified: new Date() },
  });
  const caller = invitationRouter.createCaller({
    db,
    session: { user: { id: newcomer.id }, expires: "2099-01-01" },
    headers: new Headers(),
  });
  expect(await caller.accept({ token })).toEqual({ companyId });
  expect(
    await db.companyMember.findUnique({
      where: { userId_companyId: { userId: newcomer.id, companyId } },
    }),
  ).toMatchObject({ role: "MEMBER" });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).acceptedAt,
  ).not.toBeNull();
});

it("normalizes invited emails and allows an ADMIN to invite contractors", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId: ownerId, companyId } },
    data: { role: "ADMIN" },
  });
  const invitation = await owner.create({
    companyId,
    email: " NewPerson@Example.com ",
    role: "CONTRACTOR",
    expiresInHours: 1,
  });
  expect(invitation.email).toBe(email);
  await recipient.accept({ invitationId: invitation.id });
  expect(
    await db.companyMember.findUnique({
      where: { userId_companyId: { userId: recipientId, companyId } },
    }),
  ).toMatchObject({ role: "CONTRACTOR" });
});

it("rejects invitation management by MEMBER", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId: ownerId, companyId } },
    data: { role: "MEMBER" },
  });
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(owner.list({ companyId })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await db.companyInvitation.count()).toBe(0);
  expect(sendCompanyInvitationEmail).not.toHaveBeenCalled();
});

it("rejects invitation management by CONTRACTOR", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId: ownerId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(owner.list({ companyId })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await db.companyInvitation.count()).toBe(0);
  expect(sendCompanyInvitationEmail).not.toHaveBeenCalled();
});

it("rejects invitation creation by an outsider", async () => {
  await expect(
    recipient.create({
      companyId,
      email: "other@example.com",
      role: "MEMBER",
      expiresInHours: 24,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(sendCompanyInvitationEmail).not.toHaveBeenCalled();
});

it("rejects OWNER grants", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, role: "OWNER" as "MEMBER" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects ADMIN grants", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, role: "ADMIN" as "MEMBER" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects zero-hour expiry", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, expiresInHours: 0 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects expiry beyond seven days", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, expiresInHours: 169 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects fractional-hour expiry", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, expiresInHours: 1.5 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects malformed email", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, email: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects invalid company ID", async () => {
  const input = {
    companyId,
    email,
    role: "MEMBER" as const,
    expiresInHours: 24,
  };
  await expect(
    owner.create({ ...input, companyId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("accepts a seven-day expiry", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 168,
  });
  expect(invitation.expiresAt.getTime() - Date.now()).toBeGreaterThan(
    167 * 3_600_000,
  );
});

it("rejects inviting someone who is already a member", async () => {
  await expect(
    owner.create({
      companyId,
      email: "OWNER@example.com",
      role: "MEMBER",
      expiresInHours: 24,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.companyInvitation.count()).toBe(0);
});

it("rejects immediate duplicate sends and preserves the first invitation", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).revokedAt,
  ).toBeNull();
  expect(sendCompanyInvitationEmail).toHaveBeenCalledTimes(1);
});

it("replaces an older invitation and invalidates its old token", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const token = vi.mocked(sendCompanyInvitationEmail).mock.calls[0]![0].token;
  await db.companyInvitation.update({
    where: { id: invitation.id },
    data: { createdAt: new Date(Date.now() - 61_000) },
  });
  const replacement = await owner.create({
    companyId,
    email,
    role: "CONTRACTOR",
    expiresInHours: 1,
  });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).revokedAt,
  ).not.toBeNull();
  await expect(recipient.accept({ token })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await recipient.accept({ invitationId: replacement.id });
  expect(
    await db.companyMember.findUnique({
      where: { userId_companyId: { userId: recipientId, companyId } },
    }),
  ).toMatchObject({ role: "CONTRACTOR" });
});

it("rate limits invitation sends per company", async () => {
  const otherUser = await db.user.create({
    data: { email: "anotherowner@example.com" },
  });
  await db.companyInvitation.createMany({
    data: Array.from({ length: 50 }, (_, index) => ({
      companyId: companyId,
      createdById: otherUser.id,
      email: `person${index}@example.com`,
      role: "MEMBER",
      tokenHash: `hash-${index}`,
      expiresAt: new Date(Date.now() + 60_000),
    })),
  });
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(sendCompanyInvitationEmail).not.toHaveBeenCalled();
});

it("rate limits invitation sends per sender", async () => {
  const other = await db.company.create({ data: { name: "Other" } });
  await db.companyInvitation.createMany({
    data: Array.from({ length: 50 }, (_, index) => ({
      companyId: other.id,
      createdById: ownerId,
      email: `person${index}@example.com`,
      role: "MEMBER",
      tokenHash: `hash-${index}`,
      expiresAt: new Date(Date.now() + 60_000),
    })),
  });
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(sendCompanyInvitationEmail).not.toHaveBeenCalled();
});

it("rate limits invitation sends per recipient", async () => {
  const other = await db.company.create({ data: { name: "Other" } });
  const otherUser = await db.user.create({
    data: { email: "anotherowner@example.com" },
  });
  await db.companyInvitation.createMany({
    data: Array.from({ length: 5 }, (_, index) => ({
      companyId: other.id,
      createdById: otherUser.id,
      email: email,
      role: "MEMBER",
      tokenHash: `hash-${index}`,
      expiresAt: new Date(Date.now() + 60_000),
    })),
  });
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(sendCompanyInvitationEmail).not.toHaveBeenCalled();
});

it("revokes the invitation if email delivery fails", async () => {
  vi.mocked(sendCompanyInvitationEmail).mockRejectedValueOnce(
    new Error("Mail failed"),
  );
  await expect(
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  const invitation = await db.companyInvitation.findFirstOrThrow();
  expect(invitation.revokedAt).not.toBeNull();
  await expect(
    recipient.accept({ invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("lists company invitation metadata without exposing token hashes", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  expect(await owner.list({ companyId })).toEqual([invitation]);
  expect((await owner.list({ companyId }))[0]).not.toHaveProperty("tokenHash");
  await expect(recipient.list({ companyId })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("revokes a pending invitation and prevents its acceptance", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const token = vi.mocked(sendCompanyInvitationEmail).mock.calls[0]![0].token;
  expect(
    await owner.revoke({ companyId, invitationId: invitation.id }),
  ).toEqual({ success: true });
  await expect(recipient.accept({ token })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.companyMember.count({ where: { userId: recipientId } })).toBe(
    0,
  );
});

it("rejects revocation by a nonmanager", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await expect(
    recipient.revoke({ companyId, invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).revokedAt,
  ).toBeNull();
});

it("rejects revocation using the wrong company ID", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const other = await db.company.create({
    data: {
      name: "Other",
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
  await expect(
    owner.revoke({ companyId: other.id, invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).revokedAt,
  ).toBeNull();
});

it("only lists active invitations for the verified email", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await owner.create({
    companyId,
    email: "someoneelse@example.com",
    role: "MEMBER",
    expiresInHours: 24,
  });
  const result = await recipient.pending();
  expect(result.requiresVerification).toBe(false);
  expect(result.invitations.map((item) => item.id)).toEqual([invitation.id]);
  expect(result.invitations[0]).not.toHaveProperty("tokenHash");
});

it("hides pending invitations from an unverified user", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await db.user.update({
    where: { id: recipientId },
    data: { emailVerified: null },
  });
  expect(await recipient.pending()).toEqual({
    requiresVerification: true,
    invitations: [],
  });
  await expect(
    recipient.accept({ invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).acceptedAt,
  ).toBeNull();
});

it("matches a verified email regardless of case", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await db.user.update({
    where: { id: recipientId },
    data: { email: email.toUpperCase() },
  });
  expect((await recipient.pending()).invitations).toHaveLength(1);
  expect(await recipient.accept({ invitationId: invitation.id })).toEqual({
    companyId,
  });
});

it("does not trust an email supplied by a stale or forged session", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const token = vi.mocked(sendCompanyInvitationEmail).mock.calls[0]![0].token;
  const impostor = invitationRouter.createCaller({
    db,
    session: { user: { id: ownerId, email }, expires: "2099-01-01" },
    headers: new Headers(),
  });
  await expect(impostor.accept({ token })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    (
      await db.companyInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
    ).acceptedAt,
  ).toBeNull();
});

it("rejects an expired invitation", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const now = new Date();
  await db.companyInvitation.update({
    where: { id: invitation.id },
    data: { expiresAt: new Date(now.getTime() + -1000) },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await expect(
    recipient.accept({ invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await recipient.pending()).invitations).toHaveLength(0);
  expect(await db.companyMember.count({ where: { userId: recipientId } })).toBe(
    0,
  );
});

it("rejects an invitation at its exact expiry", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const now = new Date();
  await db.companyInvitation.update({
    where: { id: invitation.id },
    data: { expiresAt: new Date(now.getTime() + 0) },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await expect(
    recipient.accept({ invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await recipient.pending()).invitations).toHaveLength(0);
  expect(await db.companyMember.count({ where: { userId: recipientId } })).toBe(
    0,
  );
});

it("accepts an invitation only once", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const token = vi.mocked(sendCompanyInvitationEmail).mock.calls[0]![0].token;
  expect(await recipient.accept({ token })).toEqual({ companyId });
  await expect(recipient.accept({ token })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await db.companyMember.count({ where: { companyId, userId: recipientId } }),
  ).toBe(1);
  expect((await recipient.pending()).invitations).toHaveLength(0);
  await expect(
    owner.revoke({ companyId, invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("preserves an existing member role when accepting an invitation", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await db.companyMember.create({
    data: { companyId, userId: recipientId, role: "ADMIN" },
  });
  await recipient.accept({ invitationId: invitation.id });
  expect(
    await db.companyMember.findUnique({
      where: { userId_companyId: { companyId, userId: recipientId } },
    }),
  ).toMatchObject({ role: "ADMIN" });
  expect(
    await db.companyMember.count({ where: { companyId, userId: recipientId } }),
  ).toBe(1);
});

it("rejects invitations after the inviter loses management permissions", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await db.companyMember.update({
    where: { userId_companyId: { companyId, userId: ownerId } },
    data: { role: "MEMBER" },
  });
  await expect(
    recipient.accept({ invitationId: invitation.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.companyMember.count({ where: { userId: recipientId } })).toBe(
    0,
  );
});

it("handles two simultaneous accept requests without duplicate membership", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  const results = await Promise.allSettled([
    recipient.accept({ invitationId: invitation.id }),
    recipient.accept({ invitationId: invitation.id }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await db.companyMember.count({ where: { companyId, userId: recipientId } }),
  ).toBe(1);
});

it("serializes concurrent revocation and acceptance", async () => {
  const invitation = await owner.create({
    companyId,
    email,
    role: "MEMBER",
    expiresInHours: 24,
  });
  await Promise.allSettled([
    owner.revoke({ companyId, invitationId: invitation.id }),
    recipient.accept({ invitationId: invitation.id }),
  ]);
  const saved = await db.companyInvitation.findUniqueOrThrow({
    where: { id: invitation.id },
  });
  const count = await db.companyMember.count({
    where: { companyId, userId: recipientId },
  });
  expect(Boolean(saved.revokedAt)).not.toBe(Boolean(saved.acceptedAt));
  expect(count).toBe(saved.acceptedAt ? 1 : 0);
});

it("serializes concurrent sends to the same recipient without duplicate active invitations", async () => {
  const results = await Promise.allSettled([
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
    owner.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await db.companyInvitation.count({
      where: { companyId, email, revokedAt: null },
    }),
  ).toBe(1);
  expect(sendCompanyInvitationEmail).toHaveBeenCalledTimes(1);
});

it("rejects malformed and unknown invitation tokens", async () => {
  await expect(recipient.accept({ token: "invalid" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    recipient.accept({ token: "f".repeat(64) }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("only shows company members to other company members", async () => {
  expect(
    (await owner.members({ companyId })).map((item) => item.user.id),
  ).toEqual([ownerId]);
  await expect(recipient.members({ companyId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("create requires authentication", async () => {
  const anonymous = invitationRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.create({ companyId, email, role: "MEMBER", expiresInHours: 24 }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("list requires authentication", async () => {
  const anonymous = invitationRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.list({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});

it("revoke requires authentication", async () => {
  const anonymous = invitationRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.revoke({ companyId, invitationId: "cmissing00000000000000001" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("pending requires authentication", async () => {
  const anonymous = invitationRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.pending()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});

it("accept requires authentication", async () => {
  const anonymous = invitationRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.accept({ token: "f".repeat(64) }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("members requires authentication", async () => {
  const anonymous = invitationRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.members({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
