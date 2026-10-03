import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { channelRouter } from "./channel";
import type { PrismaClient } from "../../../../generated/prisma";

// Only prevent application services from loading. Queries use real PostgreSQL.
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let caller: ReturnType<typeof channelRouter.createCaller>;
let userId: string;
let companyId: string;

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  await clearTestDatabase(db);
  const user = await db.user.create({
    data: { name: "Test User", email: "owner@example.com" },
  });
  userId = user.id;
  const company = await db.company.create({
    data: {
      name: "Existing Company",
      members: { create: { userId, role: "OWNER" } },
    },
  });
  companyId = company.id;
  caller = channelRouter.createCaller({
    db,
    session: {
      user: { id: userId, name: user.name, email: user.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
});

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

/// Tests for the createChannel procedure

it("createChannel returns the stored channel to the caller", async () => {
  const channelName = "New Channel";
  const result = await caller.createChannel({
    name: channelName,
    companyId,
  });
  expect(result).toHaveProperty("id");
  expect(result.name).toBe(channelName);
  expect(result.companyId).toBe(companyId);
});

it("createChannel stores the channel in the database", async () => {
  const channelName = "Another Channel";
  await caller.createChannel({
    name: channelName,
    companyId,
  });
  const storedChannel = await db.channel.findFirst({
    where: { name: channelName, companyId },
  });
  expect(storedChannel).not.toBeNull();
  expect(storedChannel?.name).toBe(channelName);
  expect(storedChannel?.companyId).toBe(companyId);
});

it("createChannel throws an error if the user is not a member of the company", async () => {
  const nonMemberUser = await db.user.create({
    data: { name: "Non Member", email: "nonmember@example.com" },
  });
  const nonMemberCaller = channelRouter.createCaller({
    db,
    session: {
      user: {
        id: nonMemberUser.id,
        name: nonMemberUser.name,
        email: nonMemberUser.email,
      },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  await expect(
    nonMemberCaller.createChannel({
      name: "Non Member Channel",
      companyId,
    }),
  ).rejects.toThrow();
});

it("createChannel throws an error if the user is not an admin or owner", async () => {
  const memberUser = await db.user.create({
    data: { name: "Member User", email: "member@example.com" },
  });
  const memberCaller = channelRouter.createCaller({
    db,
    session: {
      user: {
        id: memberUser.id,
        name: memberUser.name,
        email: memberUser.email,
      },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  await expect(
    memberCaller.createChannel({
      name: "Member Channel",
      companyId,
    }),
  ).rejects.toThrow();
});

it("createChannel throws an error if a channel with the same name already exists", async () => {
  const channelName = "Duplicate Channel";
  await caller.createChannel({
    name: channelName,
    companyId,
  });
  await expect(
    caller.createChannel({
      name: channelName,
      companyId,
    }),
  ).rejects.toThrow();
});

it("createChannel creates a channel member with the correct permissions for the creator", async () => {
  const channelName = "Permission Test Channel";
  const newChannel = await caller.createChannel({
    name: channelName,
    companyId,
  });
  const channelMember = await db.channelMember.findFirst({
    where: { channelId: newChannel.id, userId },
  });
  expect(channelMember).not.toBeNull();
  expect(channelMember?.canSendMessages).toBe(true);
  expect(channelMember?.canManageMembers).toBe(true);
  expect(channelMember?.canManageChannel).toBe(true);
  expect(channelMember?.canModerateMessages).toBe(true);
});

it("createChannel throws an error if the input is missing", async () => {
  await expect(
    caller.createChannel({
      name: "", // Invalid name
      companyId,
    }),
  ).rejects.toThrow();
  await expect(
    caller.createChannel({
      name: "Valid Name",
      companyId: "", // Invalid companyId
    }),
  ).rejects.toThrow();
});

it("createChannel throws an error if the input is too long", async () => {
  await expect(
    caller.createChannel({
      name: "A".repeat(256), // Name too long
      companyId,
    }),
  ).rejects.toThrow();
  await expect(
    caller.createChannel({
      name: "Valid Name",
      companyId: "invalid-uuid", // Invalid UUID format
    }),
  ).rejects.toThrow();
});

/// Tests for the getChannel procedure

it("getChannel returns the channel if the user is a member", async () => {
  const channelName = "Get Channel Test";
  const newChannel = await caller.createChannel({
    name: channelName,
    companyId,
  });
  const result = await caller.getChannel({ channelId: newChannel.id });
  expect(result).toHaveProperty("id", newChannel.id);
  expect(result.name).toBe(channelName);
});

it("getChannel throws an error if the user is not a member of the channel", async () => {
  const otherUser = await db.user.create({
    data: { name: "Other User", email: "other@example.com" },
  });
  const otherCaller = channelRouter.createCaller({
    db,
    session: {
      user: { id: otherUser.id, name: otherUser.name, email: otherUser.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  const channelName = "Get Channel Test";
  const newChannel = await caller.createChannel({
    name: channelName,
    companyId,
  });
  await expect(
    otherCaller.getChannel({ channelId: newChannel.id }),
  ).rejects.toThrow();
});

it("getChannel throws an error if the channel does not exist", async () => {
  await expect(
    caller.getChannel({ channelId: "non-existent-id" }),
  ).rejects.toThrow();
});

it("getChannel throws an error if the input is invalid", async () => {
  await expect(
    caller.getChannel({ channelId: "" }), // Invalid channelId
  ).rejects.toThrow();
  await expect(
    caller.getChannel({ channelId: "invalid-uuid" }), // Invalid UUID format
  ).rejects.toThrow();
});

it("getChannel throws an error if the input is missing", async () => {
  // @ts-expect-error Testing missing input
  await expect(caller.getChannel()).rejects.toThrow();
});

/// Tests for the listChannels procedure

it("listChannels returns all channels for the company that the user is a member of", async () => {
  const channel1 = await caller.createChannel({
    name: "List Channel 1",
    companyId,
  });
  const channel2 = await caller.createChannel({
    name: "List Channel 2",
    companyId,
  });
  const result = await caller.listChannels({ companyId });
  expect(result).toHaveLength(2);
  const channelIds = result.map((channel) => channel.id);
  expect(channelIds).toContain(channel1.id);
  expect(channelIds).toContain(channel2.id);
});

it("listChannels returns an empty array if the user is not a member of any channels in the company", async () => {
  const otherUser = await db.user.create({
    data: { name: "Other User", email: "other@example.com" },
  });
  const otherCaller = channelRouter.createCaller({
    db,
    session: {
      user: { id: otherUser.id, name: otherUser.name, email: otherUser.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  const result = await otherCaller.listChannels({ companyId });
  expect(result).toHaveLength(0);
});

it("listChannels throws an error if the user is not a member of the company", async () => {
  const nonMemberUser = await db.user.create({
    data: { name: "Non Member", email: "nonmember@example.com" },
  });
  const nonMemberCaller = channelRouter.createCaller({
    db,
    session: {
      user: {
        id: nonMemberUser.id,
        name: nonMemberUser.name,
        email: nonMemberUser.email,
      },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  await expect(nonMemberCaller.listChannels({ companyId })).rejects.toThrow();
});

it("listChannels throws an error if the input is invalid", async () => {
  await expect(
    caller.listChannels({ companyId: "" }), // Invalid companyId
  ).rejects.toThrow();
  await expect(
    caller.listChannels({ companyId: "invalid-uuid" }), // Invalid UUID format
  ).rejects.toThrow();
});

it("listChannels throws an error if the input is missing", async () => {
  // @ts-expect-error Testing missing input
  await expect(caller.listChannels()).rejects.toThrow();
});

it("listChannels returns an empty array if there are no channels in the company", async () => {
  const result = await caller.listChannels({ companyId });
  expect(result).toHaveLength(0);
});

it("listChannels returns only channels that the user is a member of", async () => {
  const channel1 = await caller.createChannel({
    name: "Member Channel",
    companyId,
  });
  const otherUser = await db.user.create({
    data: { name: "Other User", email: "other@example.com" },
  });
  const otherCaller = channelRouter.createCaller({
    db,
    session: {
      user: { id: otherUser.id, name: otherUser.name, email: otherUser.email },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });
  const result = await otherCaller.listChannels({ companyId });
  expect(result).toHaveLength(0);
});

it("listChannels returns channels in the correct order of posts", async () => {
  const db = database!.db;

  const member1 = await db.channelMember.findFirstOrThrow({
    where: { channelId: channel1.id, userId },
  });

  const member2 = await db.channelMember.findFirstOrThrow({
    where: { channelId: channel2.id, userId },
  });

  await db.message.createMany({
    data: [
      {
        content: "Message in Channel 1",
        channelId: channel1.id,
        authorChannelMemberId: member1.id,
        postedAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        content: "Message in Channel 2",
        channelId: channel2.id,
        authorChannelMemberId: member2.id,
        postedAt: new Date("2026-01-01T11:00:00Z"),
      },
      {
        content: "Another Message in Channel 1",
        channelId: channel1.id,
        authorChannelMemberId: member1.id,
        postedAt: new Date("2026-01-01T12:00:00Z"),
      },
    ],
  });
  const result = await caller.listChannels({ companyId });
  // Assuming the channels are returned in order of last message timestamp
  expect(result[0]?.id).toBe(channel1.id);
  expect(result[1]?.id).toBe(channel2.id);
});
