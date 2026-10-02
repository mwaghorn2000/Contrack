import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { PrismaClient } from "../../generated/prisma";

let container: StartedPostgreSqlContainer | undefined;
let db: PrismaClient;
const migration = "20261002010000_channel_membership_permissions";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("channel_migration_test")
    .start();
  const url = container.getConnectionUri();
  const previous = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < migration)
    .map((entry) => entry.name)
    .sort()
    .map((name) =>
      readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"),
    )
    .join("\n");
  const fixtures = `
    INSERT INTO "User" ("id", "name") VALUES ('active', 'Active'), ('former', 'Former'), ('outsider', 'Outsider');
    INSERT INTO "Company" ("id", "name", "updatedAt") VALUES ('company', 'Company', CURRENT_TIMESTAMP);
    INSERT INTO "CompanyMember" ("id", "userId", "companyId", "role") VALUES ('employee', 'active', 'company', 'MEMBER');
    INSERT INTO "Channel" ("id", "name", "companyId", "image") VALUES ('general', 'General', 'company', 'https://example.com/channel.png');
    INSERT INTO "ChannelMember" ("channelId", "userId") VALUES ('general', 'active'), ('general', 'outsider');
    INSERT INTO "Message" ("id", "content", "channelId", "authorId", "postedAt", "updatedAt")
      VALUES ('active-message', 'Hello', 'general', 'active', '2026-01-01', '2026-01-01'),
             ('former-message', 'History', 'general', 'former', '2026-01-02', '2026-01-02'),
             ('former-message-2', 'More history', 'general', 'former', '2026-01-03', '2026-01-03');
  `;
  execFileSync(
    "pnpm",
    ["exec", "prisma", "db", "execute", "--url", url, "--stdin"],
    {
      input: `${previous}\n${fixtures}\n${readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8")}`,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    },
  );
  db = new PrismaClient({ datasources: { db: { url } } });
  await db.$connect();
}, 120_000);

afterAll(async () => {
  try {
    await db?.$disconnect();
  } finally {
    await container?.stop();
  }
}, 60_000);

it("backfills channel titles and timestamps without changing names or images", async () => {
  expect(
    await db.channel.findUnique({ where: { id: "general" } }),
  ).toMatchObject({
    title: "General",
    name: "General",
    image: "https://example.com/channel.png",
    createdAt: expect.any(Date) as Date,
    updatedAt: expect.any(Date) as Date,
  });
});

it("preserves message content, timestamps, and author relationships", async () => {
  const messages = await db.message.findMany({
    orderBy: { postedAt: "asc" },
    include: { authorChannelMember: { include: { user: true } } },
  });
  expect(
    messages.map((message) => message.authorChannelMember.user.id),
  ).toEqual(["active", "former", "former"]);
  expect(messages[0]).toMatchObject({
    content: "Hello",
    postedAt: new Date("2026-01-01"),
    deletedAt: null,
  });
  expect(messages[1]!.authorChannelMemberId).toBe(
    messages[2]!.authorChannelMemberId,
  );
});

it("preserves active membership and defaults individual permissions to false", async () => {
  expect(
    await db.channelMember.findUnique({
      where: { channelId_userId: { channelId: "general", userId: "active" } },
    }),
  ).toMatchObject({
    id: expect.any(String) as string,
    removedAt: null,
    canSendMessages: false,
    canManageMembers: false,
    canManageChannel: false,
    canModerateMessages: false,
  });
});

it("restores former authors without granting access and revokes memberships outside the company", async () => {
  const former = await db.channelMember.findUniqueOrThrow({
    where: { channelId_userId: { channelId: "general", userId: "former" } },
  });
  expect(former.removedAt).toBeInstanceOf(Date);
  expect(former.joinedAt).toEqual(new Date("2026-01-02"));
  expect(
    (
      await db.channelMember.findUniqueOrThrow({
        where: {
          channelId_userId: { channelId: "general", userId: "outsider" },
        },
      })
    ).removedAt,
  ).toBeInstanceOf(Date);
});

it("rejects duplicate channel membership", async () => {
  await expect(
    db.channelMember.create({
      data: { channelId: "general", userId: "active" },
    }),
  ).rejects.toMatchObject({ code: "P2002" });
});

it("prevents a message from referencing an author in a different channel", async () => {
  const channel = await db.channel.create({
    data: { name: "other", title: "Other", companyId: "company" },
  });
  const member = await db.channelMember.findUniqueOrThrow({
    where: { channelId_userId: { channelId: "general", userId: "active" } },
  });
  await expect(
    db.message.create({
      data: {
        content: "Wrong channel",
        channelId: channel.id,
        authorChannelMemberId: member.id,
      },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
});

it("prevents deleting an author membership while its messages remain", async () => {
  await expect(
    db.channelMember.delete({
      where: { channelId_userId: { channelId: "general", userId: "active" } },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
});

it("allows deleting a whole channel along with its memberships and messages", async () => {
  const channel = await db.channel.create({
    data: {
      name: "temporary",
      title: "Temporary",
      companyId: "company",
      channelMembers: { create: { userId: "active", canSendMessages: true } },
    },
    include: { channelMembers: true },
  });
  await db.message.create({
    data: {
      channelId: channel.id,
      content: "Temporary message",
      authorChannelMemberId: channel.channelMembers[0]!.id,
    },
  });
  await db.channel.delete({ where: { id: channel.id } });
  expect(
    await db.channelMember.count({ where: { channelId: channel.id } }),
  ).toBe(0);
  expect(await db.message.count({ where: { channelId: channel.id } })).toBe(0);
});
