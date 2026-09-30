import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { startTestDatabase, clearTestDatabase } from "~/test/database";
import { companyRouter } from "./company";
import type { PrismaClient } from "../../../../generated/prisma";

// Only prevent application services from loading. Queries use real PostgreSQL.
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;
let db: PrismaClient;
let caller: ReturnType<typeof companyRouter.createCaller>;
let userId: string;
let companyId: string;
const missingId = "cmissing00000000000000001";

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
  caller = companyRouter.createCaller({
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

it("createCompany saves a company and makes the user its owner", async () => {
  const company = await caller.createCompany({ name: "Test Company" });
  expect(company.name).toBe("Test Company");
  const saved = await db.company.findUnique({ where: { id: company.id } });
  expect(saved?.name).toBe("Test Company");
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId: company.id } },
  });
  expect(membership?.role).toBe("OWNER");
});

it("createCompany trims the name and saves optional profile fields", async () => {
  const input = {
    name: "  Acme  ",
    description: "Building things",
    image: "https://example.com/logo.png",
    website: "https://example.com",
    email: "hello@example.com",
    phone: "12345",
  };
  const company = await caller.createCompany(input);
  expect(
    await db.company.findUnique({ where: { id: company.id } }),
  ).toMatchObject({ ...input, name: "Acme" });
});

it("createCompany accepts null image and description", async () => {
  const company = await caller.createCompany({
    name: "Acme",
    image: null,
    description: null,
  });
  expect(company.image).toBeNull();
  expect(company.description).toBeNull();
});

it("createCompany accepts a one-character name", async () => {
  const company = await caller.createCompany({ name: "A" });
  expect(
    await db.company.findUnique({ where: { id: company.id } }),
  ).not.toBeNull();
});

it("createCompany accepts a 100-character name", async () => {
  const company = await caller.createCompany({ name: "A".repeat(100) });
  expect(
    await db.company.findUnique({ where: { id: company.id } }),
  ).not.toBeNull();
});

it("createCompany accepts a 300-character description", async () => {
  const company = await caller.createCompany({
    name: "Acme",
    description: "D".repeat(300),
  });
  expect(
    await db.company.findUnique({ where: { id: company.id } }),
  ).not.toBeNull();
});

it("createCompany accepts a 20-character phone", async () => {
  const company = await caller.createCompany({
    name: "Acme",
    phone: "1".repeat(20),
  });
  expect(
    await db.company.findUnique({ where: { id: company.id } }),
  ).not.toBeNull();
});

it("createCompany accepts a 254-character email", async () => {
  const company = await caller.createCompany({
    name: "Acme",
    email:
      "a".repeat(64) +
      "@" +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(57) +
      ".com",
  });
  expect(
    await db.company.findUnique({ where: { id: company.id } }),
  ).not.toBeNull();
});

it("createCompany rejects an empty name without saving anything", async () => {
  await expect(caller.createCompany({ name: "" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects a whitespace-only name without saving anything", async () => {
  await expect(caller.createCompany({ name: "   " })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects a 101-character name without saving anything", async () => {
  await expect(
    caller.createCompany({ name: "A".repeat(101) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects a 301-character description without saving anything", async () => {
  await expect(
    caller.createCompany({ name: "Acme", description: "D".repeat(301) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects an invalid image URL without saving anything", async () => {
  await expect(
    caller.createCompany({ name: "Acme", image: "not-a-url" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects an invalid website URL without saving anything", async () => {
  await expect(
    caller.createCompany({ name: "Acme", website: "not-a-url" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects an invalid email without saving anything", async () => {
  await expect(
    caller.createCompany({ name: "Acme", email: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects a 255-character email without saving anything", async () => {
  await expect(
    caller.createCompany({
      name: "Acme",
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
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("createCompany rejects a 21-character phone without saving anything", async () => {
  await expect(
    caller.createCompany({ name: "Acme", phone: "1".repeat(21) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.company.count()).toBe(1);
  expect(await db.companyMember.count()).toBe(1);
});

it("getCompany returns a company the user belongs to", async () => {
  const company = await caller.getCompany({ companyId });
  expect(company.id).toBe(companyId);
  expect(company.name).toBe("Existing Company");
});

it("getCompany allows an ADMIN member", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  expect((await caller.getCompany({ companyId })).id).toBe(companyId);
});

it("getCompany allows a MEMBER member", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  expect((await caller.getCompany({ companyId })).id).toBe(companyId);
});

it("getCompany allows a CONTRACTOR member", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  expect((await caller.getCompany({ companyId })).id).toBe(companyId);
});

it("getCompany rejects an existing company belonging to someone else", async () => {
  const other = await db.company.create({ data: { name: "Private company" } });
  await expect(
    caller.getCompany({ companyId: other.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("getCompany rejects a missing company", async () => {
  await expect(
    caller.getCompany({ companyId: missingId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("listCompanies includes memberships but excludes other companies", async () => {
  await db.company.create({ data: { name: "Private company" } });
  const second = await db.company.create({
    data: {
      name: "Second company",
      members: { create: { userId, role: "MEMBER" } },
    },
  });
  const companies = await caller.listCompanies();
  expect(companies.map((company) => company.id).sort()).toEqual(
    [companyId, second.id].sort(),
  );
  expect(
    companies.find((company) => company.id === companyId)?.members,
  ).toEqual([{ role: "OWNER" }]);
});

it("listCompanies returns an empty list for a user without memberships", async () => {
  await db.companyMember.deleteMany({ where: { userId } });
  expect(await caller.listCompanies()).toEqual([]);
});

it("updateCompany allows OWNER and preserves omitted fields", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "OWNER" },
  });
  await db.company.update({
    where: { id: companyId },
    data: { phone: "123", description: "Old" },
  });
  expect(
    await caller.updateCompany({
      companyId,
      name: " Updated ",
      description: null,
    }),
  ).toEqual({ success: true });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).toMatchObject({ name: "Updated", description: null, phone: "123" });
});

it("updateCompany allows ADMIN and preserves omitted fields", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  await db.company.update({
    where: { id: companyId },
    data: { phone: "123", description: "Old" },
  });
  expect(
    await caller.updateCompany({
      companyId,
      name: " Updated ",
      description: null,
    }),
  ).toEqual({ success: true });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).toMatchObject({ name: "Updated", description: null, phone: "123" });
});

it("updateCompany rejects MEMBER without changing the company", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  await expect(
    caller.updateCompany({ companyId, name: "Changed" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await db.company.findUnique({ where: { id: companyId } }))?.name,
  ).toBe("Existing Company");
});

it("updateCompany rejects CONTRACTOR without changing the company", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  await expect(
    caller.updateCompany({ companyId, name: "Changed" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await db.company.findUnique({ where: { id: companyId } }))?.name,
  ).toBe("Existing Company");
});

it("updateCompany rejects a missing company", async () => {
  const targetId = missingId;
  await expect(
    caller.updateCompany({ name: "Changed", companyId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("updateCompany rejects a inaccessible company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const targetId = other.id;
  await expect(
    caller.updateCompany({ name: "Changed", companyId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("deleteCompany rejects a missing company", async () => {
  const targetId = missingId;
  await expect(
    caller.deleteCompany({ companyId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("deleteCompany rejects a inaccessible company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const targetId = other.id;
  await expect(
    caller.deleteCompany({ companyId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("updateCompany rejects invalid fields without changing the record", async () => {
  await expect(
    caller.updateCompany({ companyId, name: " " }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.company.findUnique({ where: { id: companyId } }))?.name,
  ).toBe("Existing Company");
});

it("deleteCompany allows the owner and cascades to memberships jobs and posts", async () => {
  await db.job.create({
    data: { companyId, createdById: userId, title: "Job" },
  });
  await db.companyPost.create({
    data: { companyId, authorId: userId, title: "Post", content: "News" },
  });
  expect(await caller.deleteCompany({ companyId })).toEqual({ success: true });
  expect(await db.company.findUnique({ where: { id: companyId } })).toBeNull();
  expect(await db.companyMember.count()).toBe(0);
  expect(await db.job.count()).toBe(0);
  expect(await db.companyPost.count()).toBe(0);
  expect(await db.user.findUnique({ where: { id: userId } })).not.toBeNull();
});

it("deleteCompany rejects ADMIN and leaves the company intact", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  await expect(caller.deleteCompany({ companyId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("deleteCompany rejects MEMBER and leaves the company intact", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  await expect(caller.deleteCompany({ companyId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("deleteCompany rejects CONTRACTOR and leaves the company intact", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  await expect(caller.deleteCompany({ companyId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await db.company.findUnique({ where: { id: companyId } }),
  ).not.toBeNull();
});

it("getCompanyPosts returns only this company posts newest first", async () => {
  const older = await db.companyPost.create({
    data: { companyId, content: "Older", createdAt: new Date("2026-01-01") },
  });
  const newer = await db.companyPost.create({
    data: { companyId, content: "Newer", createdAt: new Date("2026-01-02") },
  });
  await db.company.create({
    data: { name: "Private", posts: { create: { content: "Private post" } } },
  });
  expect(
    (await caller.getCompanyPosts({ companyId })).map((post) => post.id),
  ).toEqual([newer.id, older.id]);
});

it("getCompanyPosts returns an empty list when there are no posts", async () => {
  expect(await caller.getCompanyPosts({ companyId })).toEqual([]);
});

it("getCompanyPosts allows a MEMBER member", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  const post = await db.companyPost.create({
    data: { companyId, content: "News" },
  });
  expect(
    (await caller.getCompanyPosts({ companyId })).map((post) => post.id),
  ).toEqual([post.id]);
});

it("getCompanyPosts allows a CONTRACTOR member", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  const post = await db.companyPost.create({
    data: { companyId, content: "News" },
  });
  expect(
    (await caller.getCompanyPosts({ companyId })).map((post) => post.id),
  ).toEqual([post.id]);
});

it("getCompanyPosts rejects a missing company", async () => {
  const targetId = missingId;
  await expect(
    caller.getCompanyPosts({ companyId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost rejects a missing company", async () => {
  const targetId = missingId;
  await expect(
    caller.createCompanyPost({
      companyId: targetId,
      title: "Update",
      content: "News",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.companyPost.count()).toBe(0);
});

it("getCompanyPosts rejects a inaccessible company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const targetId = other.id;
  await expect(
    caller.getCompanyPosts({ companyId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost rejects a inaccessible company", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const targetId = other.id;
  await expect(
    caller.createCompanyPost({
      companyId: targetId,
      title: "Update",
      content: "News",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost allows OWNER and saves trimmed text and author", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "OWNER" },
  });
  const result = await caller.createCompanyPost({
    companyId,
    title: " Update ",
    content: " News ",
  });
  expect(result.success).toBe(true);
  expect(
    await db.companyPost.findUnique({ where: { id: result.post.id } }),
  ).toMatchObject({
    companyId,
    authorId: userId,
    title: "Update",
    content: "News",
  });
});

it("createCompanyPost allows ADMIN and saves trimmed text and author", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  const result = await caller.createCompanyPost({
    companyId,
    title: " Update ",
    content: " News ",
  });
  expect(result.success).toBe(true);
  expect(
    await db.companyPost.findUnique({ where: { id: result.post.id } }),
  ).toMatchObject({
    companyId,
    authorId: userId,
    title: "Update",
    content: "News",
  });
});

it("createCompanyPost rejects MEMBER without inserting a post", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  await expect(
    caller.createCompanyPost({ companyId, title: "Update", content: "News" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost rejects CONTRACTOR without inserting a post", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  await expect(
    caller.createCompanyPost({ companyId, title: "Update", content: "News" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost accepts minimum lengths", async () => {
  const result = await caller.createCompanyPost({
    companyId,
    title: "T",
    content: "C",
  });
  expect(result.post.title).toBe("T");
  expect(result.post.content).toBe("C");
});

it("createCompanyPost accepts maximum lengths", async () => {
  const result = await caller.createCompanyPost({
    companyId,
    title: "T".repeat(100),
    content: "C".repeat(1000),
  });
  expect(result.post.title).toBe("T".repeat(100));
  expect(result.post.content).toBe("C".repeat(1000));
});

it("createCompanyPost rejects blank title", async () => {
  await expect(
    caller.createCompanyPost({ companyId, title: " ", content: "News" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost rejects long title", async () => {
  await expect(
    caller.createCompanyPost({
      companyId,
      title: "T".repeat(101),
      content: "News",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost rejects blank content", async () => {
  await expect(
    caller.createCompanyPost({ companyId, title: "Update", content: " " }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyPost.count()).toBe(0);
});

it("createCompanyPost rejects long content", async () => {
  await expect(
    caller.createCompanyPost({
      companyId,
      title: "Update",
      content: "C".repeat(1001),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.companyPost.count()).toBe(0);
});

it("deleteCompanyPost allows OWNER", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "OWNER" },
  });
  const post = await db.companyPost.create({
    data: { companyId, authorId: userId, content: "News" },
  });
  expect(
    await caller.deleteCompanyPost({ companyId, postId: post.id }),
  ).toEqual({ success: true });
  expect(
    await db.companyPost.findUnique({ where: { id: post.id } }),
  ).toBeNull();
});

it("deleteCompanyPost allows ADMIN", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "ADMIN" },
  });
  const post = await db.companyPost.create({
    data: { companyId, authorId: userId, content: "News" },
  });
  expect(
    await caller.deleteCompanyPost({ companyId, postId: post.id }),
  ).toEqual({ success: true });
  expect(
    await db.companyPost.findUnique({ where: { id: post.id } }),
  ).toBeNull();
});

it("deleteCompanyPost rejects MEMBER", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "MEMBER" },
  });
  const post = await db.companyPost.create({
    data: { companyId, authorId: userId, content: "News" },
  });
  await expect(
    caller.deleteCompanyPost({ companyId, postId: post.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.companyPost.findUnique({ where: { id: post.id } }),
  ).not.toBeNull();
});

it("deleteCompanyPost rejects CONTRACTOR", async () => {
  await db.companyMember.update({
    where: { userId_companyId: { userId, companyId } },
    data: { role: "CONTRACTOR" },
  });
  const post = await db.companyPost.create({
    data: { companyId, authorId: userId, content: "News" },
  });
  await expect(
    caller.deleteCompanyPost({ companyId, postId: post.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.companyPost.findUnique({ where: { id: post.id } }),
  ).not.toBeNull();
});

it("deleteCompanyPost rejects a post from another company even for an owner of both", async () => {
  const other = await db.company.create({
    data: { name: "Other", members: { create: { userId, role: "OWNER" } } },
  });
  const post = await db.companyPost.create({
    data: { companyId: other.id, content: "News" },
  });
  await expect(
    caller.deleteCompanyPost({ companyId, postId: post.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.companyPost.findUnique({ where: { id: post.id } }),
  ).not.toBeNull();
});

it("deleteCompanyPost rejects a nonmember even with the correct company ID", async () => {
  const other = await db.company.create({ data: { name: "Private" } });
  const post = await db.companyPost.create({
    data: { companyId: other.id, content: "News" },
  });
  await expect(
    caller.deleteCompanyPost({ companyId: other.id, postId: post.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await db.companyPost.findUnique({ where: { id: post.id } }),
  ).not.toBeNull();
});

it("deleteCompanyPost rejects a missing post", async () => {
  await expect(
    caller.deleteCompanyPost({ companyId, postId: missingId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("getCompany rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.getCompany({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await db.company.count()).toBe(1);
});

it("getCompany rejects an invalid company ID", async () => {
  await expect(
    caller.getCompany({ companyId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("listCompanies rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.listCompanies()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await db.company.count()).toBe(1);
});

it("createCompany rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.createCompany({ name: "New" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await db.company.count()).toBe(1);
});

it("updateCompany rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.updateCompany({ companyId, name: "Updated" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db.company.count()).toBe(1);
});

it("updateCompany rejects an invalid company ID", async () => {
  await expect(
    caller.updateCompany({ companyId: "invalid", name: "Updated" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteCompany rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.deleteCompany({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await db.company.count()).toBe(1);
});

it("deleteCompany rejects an invalid company ID", async () => {
  await expect(
    caller.deleteCompany({ companyId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("getCompanyPosts rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(anonymous.getCompanyPosts({ companyId })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await db.company.count()).toBe(1);
});

it("getCompanyPosts rejects an invalid company ID", async () => {
  await expect(
    caller.getCompanyPosts({ companyId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createCompanyPost rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.createCompanyPost({ companyId, title: "Title", content: "News" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db.company.count()).toBe(1);
});

it("createCompanyPost rejects an invalid company ID", async () => {
  await expect(
    caller.createCompanyPost({
      companyId: "invalid",
      title: "Title",
      content: "News",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteCompanyPost rejects an unauthenticated request", async () => {
  const anonymous = companyRouter.createCaller({
    db,
    session: null,
    headers: new Headers(),
  });
  await expect(
    anonymous.deleteCompanyPost({ companyId, postId: missingId }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db.company.count()).toBe(1);
});

it("deleteCompanyPost rejects an invalid company ID", async () => {
  await expect(
    caller.deleteCompanyPost({ companyId: "invalid", postId: missingId }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("deleteCompanyPost rejects an invalid post ID", async () => {
  await expect(
    caller.deleteCompanyPost({ companyId, postId: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("createCompany rejects a stale session after its user is deleted", async () => {
  await db.user.delete({ where: { id: userId } });
  await expect(caller.createCompany({ name: "New" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await db.company.count()).toBe(1);
});

describe("company member management", () => {
  let memberId: string;

  beforeEach(async () => {
    const member = await db.user.create({
      data: {
        name: "Team Member",
        email: "member@example.com",
        companyMemberships: { create: { companyId, role: "MEMBER" } },
      },
    });
    memberId = member.id;
  });

  it("lets the owner promote a member to admin", async () => {
    await caller.updateMemberRole({
      companyId,
      userId: memberId,
      role: "ADMIN",
    });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "ADMIN" });
  });

  it("lets the owner demote an admin and revokes their unused invitations", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "ADMIN" },
    });
    const invitation = await db.companyInvitation.create({
      data: {
        companyId,
        createdById: memberId,
        email: "invitee@example.com",
        tokenHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await caller.updateMemberRole({
      companyId,
      userId: memberId,
      role: "CONTRACTOR",
    });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "CONTRACTOR" });
    expect(
      (
        await db.companyInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).revokedAt,
    ).toBeInstanceOf(Date);
  });

  it("lets an admin change a member to contractor", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await caller.updateMemberRole({
      companyId,
      userId: memberId,
      role: "CONTRACTOR",
    });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "CONTRACTOR" });
  });

  it("lets an admin change a contractor to member", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "CONTRACTOR" },
    });
    await caller.updateMemberRole({
      companyId,
      userId: memberId,
      role: "MEMBER",
    });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "MEMBER" });
  });

  it("prevents an admin from granting admin privileges", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "MEMBER" });
  });

  it("prevents an admin from changing or removing another admin", async () => {
    await db.companyMember.updateMany({
      where: { companyId },
      data: { role: "ADMIN" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "ADMIN" });
  });

  it("prevents an admin from changing or removing themselves", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents the owner from changing or removing themselves", async () => {
    await expect(
      caller.updateMemberRole({ companyId, userId, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId } },
      }),
    ).toMatchObject({ role: "OWNER" });
  });

  it("prevents an owner from changing or removing another owner", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "OWNER" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents an admin from changing or removing the owner", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "OWNER" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects granting the OWNER role", async () => {
    await expect(
      caller.updateMemberRole({
        companyId,
        userId: memberId,
        role: "OWNER" as "ADMIN",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toMatchObject({ role: "MEMBER" });
  });

  it("rejects member management by a MEMBER", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "MEMBER" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.companyMember.count({ where: { companyId } })).toBe(2);
  });

  it("rejects member management by a CONTRACTOR", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "CONTRACTOR" },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.companyMember.count({ where: { companyId } })).toBe(2);
  });

  it("rejects member management by an outsider", async () => {
    await db.companyMember.delete({
      where: { userId_companyId: { companyId, userId } },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires authentication to manage members", async () => {
    const anonymous = companyRouter.createCaller({
      db,
      session: null,
      headers: new Headers(),
    });
    await expect(
      anonymous.updateMemberRole({
        companyId,
        userId: memberId,
        role: "ADMIN",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects invalid company and user IDs before changing membership", async () => {
    await expect(
      caller.updateMemberRole({
        companyId: "invalid",
        userId: memberId,
        role: "ADMIN",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.updateMemberRole({ companyId, userId: "invalid", role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.removeMember({ companyId: "invalid", userId: memberId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.removeMember({ companyId, userId: "invalid" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.companyMember.count({ where: { companyId } })).toBe(2);
  });

  it("rejects a missing member", async () => {
    await expect(
      caller.updateMemberRole({ companyId, userId: missingId, role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.removeMember({ companyId, userId: missingId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cannot manage someone who belongs only to another company", async () => {
    await db.companyMember.delete({
      where: { userId_companyId: { companyId, userId: memberId } },
    });
    const other = await db.company.create({
      data: {
        name: "Other",
        members: { create: { userId: memberId, role: "MEMBER" } },
      },
    });
    await expect(
      caller.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.removeMember({ companyId, userId: memberId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId: other.id, userId: memberId } },
      }),
    ).toMatchObject({ role: "MEMBER" });
  });

  it("removes a member while preserving their account, history, and other memberships", async () => {
    const other = await db.company.create({
      data: {
        name: "Other",
        members: { create: { userId: memberId, role: "MEMBER" } },
      },
    });
    const channel = await db.channel.create({
      data: {
        name: "General",
        companyId,
        channelMembers: { create: { userId: memberId } },
        messages: {
          create: { content: "Existing message", authorId: memberId },
        },
      },
    });
    const otherChannel = await db.channel.create({
      data: {
        name: "Other",
        companyId: other.id,
        channelMembers: { create: { userId: memberId } },
      },
    });
    const post = await db.companyPost.create({
      data: { companyId, authorId: memberId, content: "Existing post" },
    });
    const job = await db.job.create({
      data: { companyId, createdById: memberId, title: "Existing job" },
    });
    await caller.removeMember({ companyId, userId: memberId });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toBeNull();
    expect(
      await db.channelMember.findUnique({
        where: {
          channelId_userId: { channelId: channel.id, userId: memberId },
        },
      }),
    ).toBeNull();
    expect(
      await db.channelMember.findUnique({
        where: {
          channelId_userId: { channelId: otherChannel.id, userId: memberId },
        },
      }),
    ).not.toBeNull();
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId: other.id, userId: memberId } },
      }),
    ).not.toBeNull();
    expect(
      await db.user.findUnique({ where: { id: memberId } }),
    ).not.toBeNull();
    expect(await db.message.count({ where: { authorId: memberId } })).toBe(1);
    expect(
      await db.companyPost.findUnique({ where: { id: post.id } }),
    ).not.toBeNull();
    expect(await db.job.findUnique({ where: { id: job.id } })).not.toBeNull();
  });

  it("lets the owner remove an admin", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "ADMIN" },
    });
    await caller.removeMember({ companyId, userId: memberId });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toBeNull();
  });

  it("lets an admin remove a member", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await caller.removeMember({ companyId, userId: memberId });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toBeNull();
  });

  it("lets an admin remove a contractor", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId } },
      data: { role: "ADMIN" },
    });
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "CONTRACTOR" },
    });
    await caller.removeMember({ companyId, userId: memberId });
    expect(
      await db.companyMember.findUnique({
        where: { userId_companyId: { companyId, userId: memberId } },
      }),
    ).toBeNull();
  });

  it("revokes unused invitations to and from a removed person only in this company", async () => {
    const other = await db.company.create({ data: { name: "Other" } });
    await db.companyInvitation.createMany({
      data: [
        {
          companyId,
          createdById: userId,
          email: "member@example.com",
          tokenHash: "a".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          companyId,
          createdById: memberId,
          email: "invitee@example.com",
          tokenHash: "b".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          companyId: other.id,
          createdById: userId,
          email: "member@example.com",
          tokenHash: "c".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          companyId,
          createdById: userId,
          email: "someoneelse@example.com",
          tokenHash: "d".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    await caller.removeMember({ companyId, userId: memberId });
    expect(
      await db.companyInvitation.count({ where: { revokedAt: { not: null } } }),
    ).toBe(2);
    expect(
      await db.companyInvitation.findUnique({
        where: { tokenHash: "c".repeat(64) },
      }),
    ).toMatchObject({ revokedAt: null });
    expect(
      await db.companyInvitation.findUnique({
        where: { tokenHash: "d".repeat(64) },
      }),
    ).toMatchObject({ revokedAt: null });
  });

  it("blocks company access immediately after removal even with an existing session", async () => {
    const removedCaller = companyRouter.createCaller({
      db,
      session: { user: { id: memberId }, expires: "2099-01-01" },
      headers: new Headers(),
    });
    await caller.removeMember({ companyId, userId: memberId });
    await expect(removedCaller.getCompany({ companyId })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(await removedCaller.listCompanies()).toEqual([]);
  });

  it("uses current database permissions after an admin is demoted", async () => {
    await db.companyMember.update({
      where: { userId_companyId: { companyId, userId: memberId } },
      data: { role: "ADMIN" },
    });
    const admin = companyRouter.createCaller({
      db,
      session: { user: { id: memberId }, expires: "2099-01-01" },
      headers: new Headers(),
    });
    await caller.updateMemberRole({
      companyId,
      userId: memberId,
      role: "MEMBER",
    });
    await expect(
      admin.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      admin.removeMember({ companyId, userId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("serializes promotion and removal so an admin cannot remove a newly promoted admin", async () => {
    const adminUser = await db.user.create({
      data: {
        name: "Admin",
        companyMemberships: { create: { companyId, role: "ADMIN" } },
      },
    });
    const admin = companyRouter.createCaller({
      db,
      session: { user: { id: adminUser.id }, expires: "2099-01-01" },
      headers: new Headers(),
    });
    const results = await Promise.allSettled([
      caller.updateMemberRole({ companyId, userId: memberId, role: "ADMIN" }),
      admin.removeMember({ companyId, userId: memberId }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const saved = await db.companyMember.findUnique({
      where: { userId_companyId: { companyId, userId: memberId } },
    });
    if (results[0].status === "fulfilled") expect(saved?.role).toBe("ADMIN");
    else expect(saved).toBeNull();
  });
});

describe("recent post acknowledgments", () => {
  let postId: string;
  let acknowledgerIds: string[];

  beforeEach(async () => {
    const post = await db.companyPost.create({
      data: { companyId, authorId: userId, content: "Company update" },
    });
    postId = post.id;
    acknowledgerIds = [];
    for (let index = 0; index < 6; index++) {
      const person = await db.user.create({
        data: {
          name: `Member ${index}`,
          email: `member${index}@example.com`,
          image: `https://example.com/avatar${index}.png`,
          companyMemberships: { create: { companyId, role: "MEMBER" } },
          postAcknowledgments: {
            create: {
              postId,
              createdAt: new Date(Date.UTC(2026, 0, index + 1)),
            },
          },
        },
      });
      acknowledgerIds.push(person.id);
    }
  });

  it("returns only the five newest acknowledging members with their profile pictures", async () => {
    const [post] = await caller.getCompanyPosts({ companyId });
    expect(post?.acknowledged).toBe(false);
    expect(post?.acknowledgmentCount).toBe(6);
    expect(post?.recentAcknowledgers).toEqual(
      [5, 4, 3, 2, 1].map((index) => ({
        id: acknowledgerIds[index],
        name: `Member ${index}`,
        image: `https://example.com/avatar${index}.png`,
      })),
    );
  });

  it("returns an empty avatar summary for a new post", async () => {
    const { post } = await caller.createCompanyPost({
      companyId,
      title: "New update",
      content: "No acknowledgments yet",
    });
    expect(post).toMatchObject({
      acknowledged: false,
      acknowledgmentCount: 0,
      recentAcknowledgers: [],
    });
  });

  it("returns all acknowledging people when there are fewer than five", async () => {
    await db.companyPostAcknowledgment.deleteMany({
      where: { postId, userId: { in: acknowledgerIds.slice(4) } },
    });
    const [post] = await caller.getCompanyPosts({ companyId });
    expect(post?.acknowledgmentCount).toBe(4);
    expect(post?.recentAcknowledgers.map((person) => person.id)).toEqual(
      acknowledgerIds.slice(0, 4).reverse(),
    );
  });

  it("keeps the viewer acknowledged when they are older than the five shown people", async () => {
    await db.companyPostAcknowledgment.create({
      data: { postId, userId, createdAt: new Date("2025-12-31") },
    });
    const [post] = await caller.getCompanyPosts({ companyId });
    expect(post?.acknowledged).toBe(true);
    expect(post?.acknowledgmentCount).toBe(7);
    expect(post?.recentAcknowledgers.map((person) => person.id)).not.toContain(
      userId,
    );
  });

  it("returns the updated avatar summary immediately after acknowledging", async () => {
    const result = await caller.setPostAcknowledgment({
      companyId,
      postId,
      acknowledged: true,
    });
    expect(result.acknowledged).toBe(true);
    expect(result.acknowledgmentCount).toBe(7);
    expect(result.recentAcknowledgers.map((person) => person.id)).toEqual([
      userId,
      ...acknowledgerIds.slice(2).reverse(),
    ]);
    const [post] = await caller.getCompanyPosts({ companyId });
    expect(post).toMatchObject(result);
  });

  it("does not move an existing acknowledgment to the front when it is repeated", async () => {
    await db.companyPostAcknowledgment.create({
      data: { postId, userId, createdAt: new Date("2025-12-31") },
    });
    const result = await caller.setPostAcknowledgment({
      companyId,
      postId,
      acknowledged: true,
    });
    expect(result.acknowledgmentCount).toBe(7);
    expect(result.recentAcknowledgers.map((person) => person.id)).toEqual(
      acknowledgerIds.slice(1).reverse(),
    );
  });

  it("fills the fifth avatar from the next acknowledgment after someone undoes theirs", async () => {
    const newestId = acknowledgerIds[5]!;
    const member = companyRouter.createCaller({
      db,
      session: { user: { id: newestId }, expires: "2099-01-01" },
      headers: new Headers(),
    });
    const result = await member.setPostAcknowledgment({
      companyId,
      postId,
      acknowledged: false,
    });
    expect(result.acknowledged).toBe(false);
    expect(result.acknowledgmentCount).toBe(5);
    expect(result.recentAcknowledgers.map((person) => person.id)).toEqual(
      acknowledgerIds.slice(0, 5).reverse(),
    );
    expect(
      await db.companyPostAcknowledgment.findUnique({
        where: { postId_userId: { postId, userId: newestId } },
      }),
    ).toBeNull();
  });

  it("excludes former members from both the recent avatars and the total", async () => {
    await caller.removeMember({ companyId, userId: acknowledgerIds[5]! });
    const [post] = await caller.getCompanyPosts({ companyId });
    expect(post?.acknowledgmentCount).toBe(5);
    expect(post?.recentAcknowledgers.map((person) => person.id)).toEqual(
      acknowledgerIds.slice(0, 5).reverse(),
    );
    expect(
      await db.companyPostAcknowledgment.count({ where: { postId } }),
    ).toBe(6);
  });

  it("does not let a removed member acknowledge a post", async () => {
    const removedId = acknowledgerIds[5]!;
    await caller.removeMember({ companyId, userId: removedId });
    const removedCaller = companyRouter.createCaller({
      db,
      session: { user: { id: removedId }, expires: "2099-01-01" },
      headers: new Headers(),
    });
    await expect(
      removedCaller.setPostAcknowledgment({
        companyId,
        postId,
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not accept a post ID belonging to a different company", async () => {
    const other = await caller.createCompany({ name: "Other company" });
    await expect(
      caller.setPostAcknowledgment({
        companyId: other.id,
        postId,
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await db.companyPostAcknowledgment.count({ where: { postId } }),
    ).toBe(6);
  });
});
