import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { CompanyRole, PrismaClient } from "../../../../generated/prisma";
import { clearTestDatabase, startTestDatabase } from "~/test/database";
import { deleteObject, getObjectInfo } from "~/server/storage";
import {
  authorizeChannel,
  publishConversationsChanged,
  publishToConversation,
} from "~/server/realtime";
import { channelRouter } from "./channel";
import { companyRouter } from "./company";
import { directMessageRouter } from "./direct-message";
import { MESSAGES_PER_WINDOW, messageRouter } from "./message";
import { realtimeRouter } from "./realtime";

// Only prevent application services from loading. Queries use real PostgreSQL.
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/storage", () => ({
  UPLOAD_CACHE_CONTROL: "public, max-age=31536000, immutable",
  storageConfigured: () => true,
  signedReadUrl: (key: string) =>
    Promise.resolve(`https://signed.example.com/${key}`),
  publicUrl: (key: string) => `https://images.example.com/${key}`,
  keyFromPublicUrl: () => null,
  createUploadUrl: (key: string) =>
    Promise.resolve(`https://upload.example.com/${key}`),
  getObjectInfo: vi.fn(),
  deleteObject: vi.fn(),
  deletePrefix: vi.fn(),
}));
vi.mock("~/server/realtime", () => ({
  CONVERSATION_CHANNEL_PREFIX: "private-conversation-",
  USER_CHANNEL_PREFIX: "private-user-",
  realtimeConfigured: () => true,
  authorizeChannel: vi.fn(() => ({ auth: "key:signature" })),
  publishToConversation: vi.fn(),
  publishConversationsChanged: vi.fn(),
}));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let companyId: string;
let ids: Record<
  "owner" | "admin" | "member" | "contractor" | "outsider",
  string
>;

function callersFor(userId: string) {
  const context = {
    db,
    session: {
      user: { id: userId, name: null, email: null },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  };
  return {
    channel: channelRouter.createCaller(context),
    message: messageRouter.createCaller(context),
    dm: directMessageRouter.createCaller(context),
    realtime: realtimeRouter.createCaller(context),
    company: companyRouter.createCaller(context),
  };
}

let owner: ReturnType<typeof callersFor>;
let admin: ReturnType<typeof callersFor>;
let member: ReturnType<typeof callersFor>;
let contractor: ReturnType<typeof callersFor>;
let outsider: ReturnType<typeof callersFor>;

const sendPermission = {
  canSendMessages: true,
  canManageMembers: false,
  canManageChannel: false,
  canModerateMessages: false,
};
const readOnly = { ...sendPermission, canSendMessages: false };

function text(content: string) {
  return { type: "TEXT" as const, content };
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = database.db;
}, 120_000);

beforeEach(async () => {
  vi.mocked(getObjectInfo).mockReset();
  vi.mocked(getObjectInfo).mockResolvedValue({
    size: 1024,
    contentType: "image/png",
  });
  vi.mocked(publishToConversation).mockClear();
  vi.mocked(publishConversationsChanged).mockClear();
  vi.mocked(authorizeChannel).mockClear();
  await clearTestDatabase(db);
  const company = await db.company.create({ data: { name: "Chat Co" } });
  companyId = company.id;
  const roles: [keyof typeof ids, CompanyRole | null][] = [
    ["owner", "OWNER"],
    ["admin", "ADMIN"],
    ["member", "MEMBER"],
    ["contractor", "CONTRACTOR"],
    ["outsider", null],
  ];
  ids = {} as typeof ids;
  for (const [name, role] of roles) {
    const user = await db.user.create({
      data: {
        name,
        email: `${name}@example.com`,
        ...(role
          ? { companyMemberships: { create: { companyId, role } } }
          : {}),
      },
    });
    ids[name] = user.id;
  }
  owner = callersFor(ids.owner);
  admin = callersFor(ids.admin);
  member = callersFor(ids.member);
  contractor = callersFor(ids.contractor);
  outsider = callersFor(ids.outsider);
});

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

describe("channel access", () => {
  it("the owner sees every channel, including ones they were not added to", async () => {
    const channel = await admin.channel.createChannel({
      companyId,
      name: "Admins only",
    });
    expect(
      (await owner.channel.listChannels({ companyId })).map((c) => c.id),
    ).toEqual([channel.id]);
    expect(
      (await owner.channel.getChannel({ channelId: channel.id })).permissions,
    ).toEqual({
      canSendMessages: true,
      canManageMembers: true,
      canManageChannel: true,
      canModerateMessages: true,
    });
  });

  it("admins see only channels they created or were added to", async () => {
    const otherAdmin = await db.user.create({
      data: {
        name: "Second admin",
        companyMemberships: { create: { companyId, role: "ADMIN" } },
      },
    });
    const channel = await callersFor(otherAdmin.id).channel.createChannel({
      companyId,
      name: "Private",
    });
    expect(await admin.channel.listChannels({ companyId })).toEqual([]);
    await expect(
      admin.channel.getChannel({ channelId: channel.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      admin.message.list({ channelId: channel.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("members and contractors cannot create channels", async () => {
    for (const caller of [member, contractor])
      await expect(
        caller.channel.createChannel({ companyId, name: "Nope" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("people outside the company cannot list or view channels", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "General",
    });
    await expect(
      outsider.channel.listChannels({ companyId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.channel.getChannel({ channelId: channel.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a read-only member can read but not send until they are allowed to", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "News",
    });
    await owner.channel.setMember({
      channelId: channel.id,
      userId: ids.member,
      permissions: readOnly,
    });
    await owner.message.send({ channelId: channel.id, body: text("Hello") });
    expect(
      (await member.message.list({ channelId: channel.id })).items,
    ).toHaveLength(1);
    await expect(
      member.message.send({ channelId: channel.id, body: text("Hi") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await owner.channel.setMember({
      channelId: channel.id,
      userId: ids.member,
      permissions: sendPermission,
    });
    await expect(
      member.message.send({ channelId: channel.id, body: text("Hi") }),
    ).resolves.toMatchObject({ content: "Hi" });
  });

  it("removed members lose access, and re-adding them restores it", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Team",
      memberIds: [ids.member],
    });
    await owner.channel.removeMember({
      channelId: channel.id,
      userId: ids.member,
    });
    await expect(
      member.message.list({ channelId: channel.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await member.channel.listChannels({ companyId })).toEqual([]);

    await owner.channel.setMember({
      channelId: channel.id,
      userId: ids.member,
      permissions: sendPermission,
    });
    expect(
      (await member.channel.listChannels({ companyId })).map((c) => c.id),
    ).toEqual([channel.id]);
  });

  it("the owner can post in a channel they were not added to", async () => {
    const channel = await admin.channel.createChannel({
      companyId,
      name: "Ops",
    });
    await expect(
      owner.message.send({ channelId: channel.id, body: text("Owner here") }),
    ).resolves.toMatchObject({ author: { id: ids.owner } });
  });
});

describe("channel management", () => {
  it("createChannel adds the chosen company members with permission to send", async () => {
    const channel = await admin.channel.createChannel({
      companyId,
      name: "Site",
      memberIds: [ids.member, ids.contractor],
    });
    const members = await admin.channel.listMembers({ channelId: channel.id });
    const byUser = Object.fromEntries(
      members.map((row) => [row.user.id, row.permissions]),
    );
    expect(byUser[ids.member]).toEqual(sendPermission);
    expect(byUser[ids.contractor]).toEqual(sendPermission);
    expect(byUser[ids.owner]).toBeNull();
    expect(publishConversationsChanged).toHaveBeenCalledWith(
      expect.arrayContaining([
        ids.admin,
        ids.member,
        ids.contractor,
        ids.owner,
      ]),
    );
  });

  it("createChannel rejects people outside the company", async () => {
    await expect(
      admin.channel.createChannel({
        companyId,
        name: "Site",
        memberIds: [ids.outsider],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.channel.count()).toBe(0);
  });

  it("channel names are unique within a company regardless of case", async () => {
    await admin.channel.createChannel({ companyId, name: "General" });
    await expect(
      owner.channel.createChannel({ companyId, name: "general" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("updateChannel needs permission to manage the channel", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Old",
      memberIds: [ids.member],
    });
    await expect(
      member.channel.updateChannel({ channelId: channel.id, name: "New" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.channel.updateChannel({ channelId: channel.id, name: "New" });
    expect(
      (await member.channel.getChannel({ channelId: channel.id })).name,
    ).toBe("New");
  });

  it("people can't change their own permissions or grant ones they lack", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Crew",
    });
    await owner.channel.setMember({
      channelId: channel.id,
      userId: ids.member,
      permissions: { ...sendPermission, canManageMembers: true },
    });
    await expect(
      member.channel.setMember({
        channelId: channel.id,
        userId: ids.member,
        permissions: { ...sendPermission, canManageChannel: true },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.channel.setMember({
        channelId: channel.id,
        userId: ids.contractor,
        permissions: { ...sendPermission, canManageChannel: true },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.channel.setMember({
        channelId: channel.id,
        userId: ids.contractor,
        permissions: sendPermission,
      }),
    ).resolves.toEqual({ success: true });
  });

  it("only company members can be added to a channel", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Crew",
    });
    await expect(
      owner.channel.setMember({
        channelId: channel.id,
        userId: ids.outsider,
        permissions: sendPermission,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listMembers needs permission to manage members", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Crew",
      memberIds: [ids.member],
    });
    await expect(
      member.channel.listMembers({ channelId: channel.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("direct messages", () => {
  it("open returns the same conversation for a pair, even when opened at once", async () => {
    const [first, second] = await Promise.all([
      member.dm.open({ companyId, userId: ids.contractor }),
      contractor.dm.open({ companyId, userId: ids.member }),
    ]);
    expect(first.id).toBe(second.id);
    expect(await db.channel.count({ where: { kind: "DIRECT" } })).toBe(1);
    expect(
      (await member.dm.open({ companyId, userId: ids.contractor })).id,
    ).toBe(first.id);
  });

  it("both people can message each other and see the conversation in their list", async () => {
    const { id } = await member.dm.open({ companyId, userId: ids.contractor });
    await member.message.send({ channelId: id, body: text("Hey") });
    await contractor.message.send({ channelId: id, body: text("Hi") });
    expect((await member.dm.list({ companyId }))[0]).toMatchObject({
      id,
      user: { id: ids.contractor },
    });
    expect((await contractor.dm.list({ companyId }))[0]).toMatchObject({
      id,
      user: { id: ids.member },
    });
  });

  it("you can't message yourself or someone outside the company", async () => {
    await expect(
      member.dm.open({ companyId, userId: ids.member }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      member.dm.open({ companyId, userId: ids.outsider }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the owner can't see other people's direct messages", async () => {
    const { id } = await member.dm.open({ companyId, userId: ids.contractor });
    await expect(
      owner.channel.getChannel({ channelId: id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(owner.message.list({ channelId: id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await owner.channel.listChannels({ companyId })).toEqual([]);
  });

  it("direct messages can't be renamed", async () => {
    const { id } = await member.dm.open({ companyId, userId: ids.contractor });
    await expect(
      member.channel.updateChannel({ channelId: id, name: "Renamed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("removing someone from the company ends their access to direct messages", async () => {
    const { id } = await member.dm.open({ companyId, userId: ids.contractor });
    await owner.company.removeMember({ companyId, userId: ids.contractor });
    await expect(
      contractor.message.list({ channelId: id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("messages", () => {
  async function seedChannel(count: number) {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Busy",
    });
    const author = await db.channelMember.findFirstOrThrow({
      where: { channelId: channel.id, userId: ids.owner },
    });
    // Many messages share a timestamp, so the cursor must also order by id.
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    await db.message.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        content: `Message ${index}`,
        channelId: channel.id,
        authorChannelMemberId: author.id,
        postedAt: new Date(base + Math.floor(index / 7) * 1000),
      })),
    });
    return channel;
  }

  it("list pages through every message newest first without repeats", async () => {
    const channel = await seedChannel(120);
    const seen: string[] = [];
    const times: number[] = [];
    let cursor: { postedAt: Date; id: string } | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof owner.message.list>> =
        await owner.message.list({ channelId: channel.id, cursor });
      seen.push(...page.items.map((item) => item.id));
      times.push(...page.items.map((item) => item.postedAt.getTime()));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("list leaves out deleted messages", async () => {
    const channel = await seedChannel(3);
    const [first] = await db.message.findMany({
      where: { channelId: channel.id },
    });
    await db.message.update({
      where: { id: first!.id },
      data: { deletedAt: new Date() },
    });
    const { items, nextCursor } = await owner.message.list({
      channelId: channel.id,
    });
    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it("send publishes the new message to the conversation", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Live",
    });
    const message = await owner.message.send({
      channelId: channel.id,
      body: text("  Hello there  "),
    });
    expect(message).toMatchObject({ type: "TEXT", content: "Hello there" });
    expect(publishToConversation).toHaveBeenCalledWith(
      channel.id,
      "message",
      message,
    );
  });

  it("send rejects empty and overly long messages", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Live",
    });
    for (const content of ["   ", "a".repeat(4001)])
      await expect(
        owner.message.send({ channelId: channel.id, body: text(content) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("send limits how quickly someone can post", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Live",
    });
    for (let index = 0; index < MESSAGES_PER_WINDOW; index += 1)
      await owner.message.send({
        channelId: channel.id,
        body: text(`${index}`),
      });
    await expect(
      owner.message.send({ channelId: channel.id, body: text("one more") }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  describe("images", () => {
    async function uploadImage(caller: typeof owner, channelId: string) {
      const upload = await caller.message.createImageUpload({
        channelId,
        contentType: "image/png",
        size: 1024,
      });
      return upload.key;
    }

    it("sends an image that members see through a signed URL", async () => {
      const channel = await owner.channel.createChannel({
        companyId,
        name: "Photos",
        memberIds: [ids.member],
      });
      const key = await uploadImage(owner, channel.id);
      expect(key).toMatch(new RegExp(`^channels/${channel.id}/messages/`));
      await owner.message.send({
        channelId: channel.id,
        body: { type: "IMAGE", key, width: 800, height: 600, caption: "Site" },
      });
      const [message] = (await member.message.list({ channelId: channel.id }))
        .items;
      expect(message).toMatchObject({
        type: "IMAGE",
        content: "Site",
        image: {
          url: `https://signed.example.com/${key}`,
          width: 800,
          height: 600,
        },
      });
    });

    it("rejects an image uploaded for another channel", async () => {
      const first = await owner.channel.createChannel({
        companyId,
        name: "One",
      });
      const second = await owner.channel.createChannel({
        companyId,
        name: "Two",
      });
      const key = await uploadImage(owner, first.id);
      await expect(
        owner.message.send({
          channelId: second.id,
          body: { type: "IMAGE", key, width: 10, height: 10 },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects a malformed image key as bad input", async () => {
      const channel = await owner.channel.createChannel({
        companyId,
        name: "Photos",
      });
      await expect(
        owner.message.send({
          channelId: channel.id,
          body: {
            type: "IMAGE",
            key: `channels/${channel.id}/messages/not-a-uuid.png`,
            width: 10,
            height: 10,
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("an uploaded image can only be sent once", async () => {
      const channel = await owner.channel.createChannel({
        companyId,
        name: "Photos",
      });
      const key = await uploadImage(owner, channel.id);
      const body = { type: "IMAGE" as const, key, width: 10, height: 10 };
      await owner.message.send({ channelId: channel.id, body });
      await expect(
        owner.message.send({ channelId: channel.id, body }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("people who can't send can't upload images either", async () => {
      const channel = await owner.channel.createChannel({
        companyId,
        name: "Photos",
      });
      await owner.channel.setMember({
        channelId: channel.id,
        userId: ids.member,
        permissions: readOnly,
      });
      await expect(uploadImage(member, channel.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});

describe("realtime authorization", () => {
  const socketId = "1234.5678";

  it("allows only your own user channel", async () => {
    await expect(
      member.realtime.authorize({
        socketId,
        channelName: `private-user-${ids.member}`,
      }),
    ).resolves.toEqual({ auth: "key:signature" });
    await expect(
      member.realtime.authorize({
        socketId,
        channelName: `private-user-${ids.owner}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows conversations you can view and nothing else", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Live",
      memberIds: [ids.member],
    });
    await expect(
      member.realtime.authorize({
        socketId,
        channelName: `private-conversation-${channel.id}`,
      }),
    ).resolves.toEqual({ auth: "key:signature" });
    for (const channelName of [
      `private-conversation-${channel.id}`,
      "private-conversation-not-a-cuid",
      `presence-conversation-${channel.id}`,
    ])
      await expect(
        contractor.realtime.authorize({ socketId, channelName }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("unread messages", () => {
  async function channelWithMember() {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Updates",
      memberIds: [ids.member],
    });
    return channel.id;
  }

  async function unreadFor(caller: typeof owner, channelId: string) {
    const channels = await caller.channel.listChannels({ companyId });
    return channels.find(({ id }) => id === channelId)?.unreadCount;
  }

  it("counts other people's messages but not your own", async () => {
    const channelId = await channelWithMember();
    await owner.message.send({ channelId, body: text("One") });
    await owner.message.send({ channelId, body: text("Two") });
    await member.message.send({ channelId, body: text("Reply") });
    expect(await unreadFor(member, channelId)).toBe(2);
    expect(await unreadFor(owner, channelId)).toBe(1);
  });

  it("markRead clears the count until someone posts again", async () => {
    const channelId = await channelWithMember();
    await owner.message.send({ channelId, body: text("One") });
    await member.message.markRead({ channelId });
    expect(await unreadFor(member, channelId)).toBe(0);
    await owner.message.send({ channelId, body: text("Two") });
    expect(await unreadFor(member, channelId)).toBe(1);
  });

  it("messages from before you joined are not unread", async () => {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Old",
    });
    await owner.message.send({ channelId: channel.id, body: text("Before") });
    await owner.channel.setMember({
      channelId: channel.id,
      userId: ids.member,
      permissions: sendPermission,
    });
    expect(await unreadFor(member, channel.id)).toBe(0);
  });

  it("deleted messages are not counted", async () => {
    const channelId = await channelWithMember();
    const message = await owner.message.send({ channelId, body: text("Oops") });
    await db.message.update({
      where: { id: message.id },
      data: { deletedAt: new Date() },
    });
    expect(await unreadFor(member, channelId)).toBe(0);
  });

  it("the summary totals channels and direct messages separately", async () => {
    const channelId = await channelWithMember();
    await owner.message.send({ channelId, body: text("Channel news") });
    const { id: dmId } = await contractor.dm.open({
      companyId,
      userId: ids.member,
    });
    await contractor.message.send({ channelId: dmId, body: text("Hi") });
    await contractor.message.send({
      channelId: dmId,
      body: text("Are you there?"),
    });

    const summary = await member.message.unreadSummary({ companyId });
    expect(summary).toMatchObject({ channels: 1, directMessages: 2 });
    expect(summary.conversationIds.sort()).toEqual([channelId, dmId].sort());
    expect((await member.dm.list({ companyId }))[0]?.unreadCount).toBe(2);
  });

  it("the owner's summary includes every channel but not other people's DMs", async () => {
    const channel = await admin.channel.createChannel({
      companyId,
      name: "Ops",
    });
    await admin.message.send({ channelId: channel.id, body: text("Status") });
    const { id: dmId } = await member.dm.open({
      companyId,
      userId: ids.contractor,
    });
    await member.message.send({ channelId: dmId, body: text("Private") });

    const summary = await owner.message.unreadSummary({ companyId });
    expect(summary).toMatchObject({ channels: 1, directMessages: 0 });
    expect(summary.conversationIds).toEqual([channel.id]);
  });

  it("markRead needs access to the conversation", async () => {
    const channelId = await channelWithMember();
    await expect(
      contractor.message.markRead({ channelId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("editing and deleting messages", () => {
  async function channelWithMember() {
    const channel = await owner.channel.createChannel({
      companyId,
      name: "Edits",
      memberIds: [ids.member, ids.contractor],
    });
    return channel.id;
  }

  it("the author can edit their message, which is marked as edited", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Helo") });
    expect(sent.editedAt).toBeNull();
    const edited = await member.message.edit({
      messageId: sent.id,
      content: " Hello ",
    });
    expect(edited).toMatchObject({ id: sent.id, content: "Hello" });
    expect(edited.editedAt).toBeInstanceOf(Date);
    expect(publishToConversation).toHaveBeenLastCalledWith(
      channelId,
      "message-updated",
      edited,
    );
    expect(
      (await contractor.message.list({ channelId })).items[0],
    ).toMatchObject({
      content: "Hello",
    });
  });

  it("nobody else can edit a message, including moderators", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Mine") });
    for (const caller of [contractor, owner])
      await expect(
        caller.message.edit({ messageId: sent.id, content: "Changed" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a text message can't be edited to nothing, but an image caption can", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Text") });
    await expect(
      member.message.edit({ messageId: sent.id, content: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const { key } = await member.message.createImageUpload({
      channelId,
      contentType: "image/png",
      size: 1024,
    });
    const image = await member.message.send({
      channelId,
      body: { type: "IMAGE", key, width: 10, height: 10, caption: "Caption" },
    });
    await expect(
      member.message.edit({ messageId: image.id, content: "" }),
    ).resolves.toMatchObject({ type: "IMAGE", content: "" });
  });

  it("someone who can no longer send messages can't edit", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Before") });
    await owner.channel.setMember({
      channelId,
      userId: ids.member,
      permissions: readOnly,
    });
    await expect(
      member.message.edit({ messageId: sent.id, content: "After" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "You can't edit messages here because you can no longer send messages in this channel.",
    });
  });

  it("the author can delete their message, and everyone is told", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Oops") });
    await member.message.delete({ messageId: sent.id });
    expect((await contractor.message.list({ channelId })).items).toEqual([]);
    expect(publishToConversation).toHaveBeenLastCalledWith(
      channelId,
      "message-deleted",
      { id: sent.id },
    );
    expect(
      await db.message.findUniqueOrThrow({ where: { id: sent.id } }),
    ).toMatchObject({
      content: "",
      data: null,
    });
  });

  it("moderators can delete other people's messages; others can't", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Rude") });
    await expect(
      contractor.message.delete({ messageId: sent.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.message.delete({ messageId: sent.id })).resolves.toEqual(
      {
        success: true,
      },
    );
  });

  it("deleting an image message deletes the image file", async () => {
    const channelId = await channelWithMember();
    const { key } = await member.message.createImageUpload({
      channelId,
      contentType: "image/png",
      size: 1024,
    });
    const image = await member.message.send({
      channelId,
      body: { type: "IMAGE", key, width: 10, height: 10 },
    });
    vi.mocked(deleteObject).mockClear();
    await member.message.delete({ messageId: image.id });
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(key);
  });

  it("a deleted message can't be edited or deleted again", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Gone") });
    await member.message.delete({ messageId: sent.id });
    await expect(
      member.message.edit({ messageId: sent.id, content: "Back" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.message.delete({ messageId: sent.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("edits share the limit on how quickly someone can post", async () => {
    const channelId = await channelWithMember();
    const author = await db.channelMember.findFirstOrThrow({
      where: { channelId, userId: ids.member },
    });
    // Posted long ago, so only the edits count towards the limit.
    const postedAt = new Date("2026-01-01T00:00:00Z");
    await db.message.createMany({
      data: Array.from({ length: MESSAGES_PER_WINDOW + 1 }, (_, index) => ({
        content: `Old ${index}`,
        channelId,
        authorChannelMemberId: author.id,
        postedAt,
      })),
    });
    const messages = await db.message.findMany({
      where: { channelId },
      orderBy: { content: "asc" },
    });
    for (const message of messages.slice(0, MESSAGES_PER_WINDOW))
      await member.message.edit({ messageId: message.id, content: "Edited" });
    await expect(
      member.message.edit({ messageId: messages.at(-1)!.id, content: "More" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(
      member.message.send({ channelId, body: text("New") }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("an edit that races a delete doesn't bring the message back", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({ channelId, body: text("Gone") });
    // Delete the message just after edit has loaded it.
    const findFirst = db.message.findFirst.bind(db.message);
    const spy = vi.spyOn(db.message, "findFirst").mockImplementationOnce(((
      ...args: Parameters<typeof findFirst>
    ) =>
      findFirst(...args).then(async (row) => {
        await db.message.update({
          where: { id: sent.id },
          data: { deletedAt: new Date() },
        });
        return row;
      })) as typeof findFirst);
    vi.mocked(publishToConversation).mockClear();
    await expect(
      member.message.edit({ messageId: sent.id, content: "Back" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    spy.mockRestore();
    expect(
      await db.message.findUniqueOrThrow({ where: { id: sent.id } }),
    ).toMatchObject({ content: "Gone", editedAt: null });
    expect(publishToConversation).not.toHaveBeenCalled();
  });

  it("people who can't see the conversation can't find its messages", async () => {
    const channelId = await channelWithMember();
    const sent = await member.message.send({
      channelId,
      body: text("Private"),
    });
    await expect(
      admin.message.delete({ messageId: sent.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      outsider.message.edit({ messageId: sent.id, content: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
