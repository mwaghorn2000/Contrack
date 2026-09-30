import { describe, expect, it } from "vitest";
import { createTestContext } from "~/test/helpers";
import { companyRouter } from "./company";

const companyId = "clcompany00000000000000001";
const postId = "clpost0000000000000000001";
const userId = "cltestuser0000000000000001";
const identity = { companyId, postId };
const company = { id: companyId, name: "Acme" };
const post = {
  id: postId,
  title: "Update",
  content: "News",
  author: { name: "Alex", image: null },
  acknowledgments: [{ userId }],
  _count: { acknowledgments: 2 },
};
const summary = {
  id: postId,
  title: "Update",
  content: "News",
  author: post.author,
  acknowledged: true,
  acknowledgmentCount: 2,
};
function setup() {
  const context = createTestContext();
  return { ...context, caller: companyRouter.createCaller(context.ctx) };
}
const member = { some: { userId } };
const admins = { some: { userId, role: { in: ["ADMIN", "OWNER"] } } };
const relations = {
  author: { select: { name: true, image: true } },
  acknowledgments: { where: { userId }, select: { userId: true } },
  _count: {
    select: {
      acknowledgments: {
        where: { user: { companyMemberships: { some: { companyId } } } },
      },
    },
  },
};

describe("company router", () => {
  it("gets a company only through the requesting user's membership", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue(company);
    await expect(caller.getCompany({ companyId })).resolves.toEqual(company);
    expect(db.company.findFirst).toHaveBeenCalledWith({
      where: { id: companyId, members: member },
      include: {
        members: {
          where: { userId },
          select: { role: true, user: { select: { name: true, image: true } } },
        },
      },
    });
  });

  it("rejects a missing or inaccessible company", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue(null);
    await expect(caller.getCompany({ companyId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it.each([{ companies: [] }, { companies: [company] }])(
    "lists only the current user's companies (%j)",
    async ({ companies }) => {
      const { caller, db } = setup();
      db.company.findMany.mockResolvedValue(companies);
      await expect(caller.listCompanies()).resolves.toEqual(companies);
      expect(db.company.findMany).toHaveBeenCalledWith({
        where: { members: member },
        select: {
          id: true,
          name: true,
          image: true,
          description: true,
          members: { where: { userId }, select: { role: true } },
        },
      });
    },
  );

  it("creates a trimmed company and its OWNER membership in one transaction", async () => {
    const { caller, db, tx } = setup();
    tx.company.create.mockResolvedValue(company);
    tx.companyMember.create.mockResolvedValue({});
    const details = {
      image: null,
      description: null,
      website: "https://acme.test",
      email: "a@acme.test",
      phone: "123",
    };
    await expect(
      caller.createCompany({ name: " Acme ", ...details }),
    ).resolves.toEqual(company);
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.company.create).toHaveBeenCalledWith({
      data: { name: "Acme", ...details },
    });
    expect(tx.companyMember.create).toHaveBeenCalledWith({
      data: { companyId, userId, role: "OWNER" },
    });
    expect(db.company.create).not.toHaveBeenCalled();
    expect(db.companyMember.create).not.toHaveBeenCalled();
  });

  it("propagates membership creation failure out of the transaction", async () => {
    const { caller, tx } = setup();
    tx.company.create.mockResolvedValue(company);
    tx.companyMember.create.mockRejectedValue(new Error("membership failed"));
    await expect(caller.createCompany({ name: "Acme" })).rejects.toThrow(
      "membership failed",
    );
  });

  it("does not create membership when company creation fails", async () => {
    const { caller, tx } = setup();
    tx.company.create.mockRejectedValue(new Error("creation failed"));
    await expect(caller.createCompany({ name: "Acme" })).rejects.toThrow(
      "creation failed",
    );
    expect(tx.companyMember.create).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    "deletes a company only for its owner (count %i)",
    async (count) => {
      const { caller, db } = setup();
      db.company.deleteMany.mockResolvedValue({ count });
      const result = caller.deleteCompany({ companyId });
      if (count) await expect(result).resolves.toEqual({ success: true });
      else await expect(result).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(db.company.deleteMany).toHaveBeenCalledWith({
        where: { id: companyId, members: { some: { userId, role: "OWNER" } } },
      });
    },
  );

  it.each([0, 1])(
    "updates a company only for its owner or admin (count %i)",
    async (count) => {
      const { caller, db } = setup();
      db.company.updateMany.mockResolvedValue({ count });
      const result = caller.updateCompany({
        companyId,
        name: " New name ",
        description: null,
      });
      if (count) await expect(result).resolves.toEqual({ success: true });
      else await expect(result).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(db.company.updateMany).toHaveBeenCalledWith({
        where: {
          id: companyId,
          members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } },
        },
        data: {
          name: "New name",
          description: null,
          image: undefined,
          website: undefined,
          email: undefined,
          phone: undefined,
        },
      });
    },
  );

  it("lists posts newest first and exposes summaries without raw acknowledgment relations", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue({
      posts: [
        post,
        { ...post, acknowledgments: [], _count: { acknowledgments: 0 } },
      ],
    });
    await expect(caller.getCompanyPosts({ companyId })).resolves.toEqual([
      summary,
      { ...summary, acknowledged: false, acknowledgmentCount: 0 },
    ]);
    expect(db.company.findFirst).toHaveBeenCalledWith({
      where: { id: companyId, members: member },
      select: { posts: { include: relations, orderBy: { createdAt: "desc" } } },
    });
  });

  it("returns no posts for an empty company", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue({ posts: [] });
    await expect(caller.getCompanyPosts({ companyId })).resolves.toEqual([]);
  });

  it("rejects post listing for a missing or inaccessible company", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue(null);
    await expect(caller.getCompanyPosts({ companyId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates trimmed posts with the session author after checking admin membership", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue(company);
    db.companyPost.create.mockResolvedValue(post);
    await expect(
      caller.createCompanyPost({
        companyId,
        title: " Update ",
        content: " News ",
      }),
    ).resolves.toEqual({ post: summary, success: true });
    expect(db.company.findFirst).toHaveBeenCalledWith({
      where: { id: companyId, members: admins },
      select: { id: true },
    });
    expect(db.companyPost.create).toHaveBeenCalledWith({
      include: relations,
      data: { companyId, authorId: userId, title: "Update", content: "News" },
    });
  });

  it("does not create a post when admin access is missing", async () => {
    const { caller, db } = setup();
    db.company.findFirst.mockResolvedValue(null);
    await expect(
      caller.createCompanyPost({ companyId, title: "Update", content: "News" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.companyPost.create).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "sets acknowledgment=%s transactionally for the current member",
    async (acknowledged) => {
      const { caller, db, tx } = setup();
      tx.companyPost.findFirst.mockResolvedValue({ id: postId });
      tx.companyPostAcknowledgment.upsert.mockResolvedValue({});
      tx.companyPostAcknowledgment.deleteMany.mockResolvedValue({ count: 0 });
      tx.companyPostAcknowledgment.count.mockResolvedValue(3);
      await expect(
        caller.setPostAcknowledgment({ ...identity, acknowledged }),
      ).resolves.toEqual({ acknowledged, acknowledgmentCount: 3 });
      expect(db.$transaction).toHaveBeenCalledOnce();
      expect(tx.companyPost.findFirst).toHaveBeenCalledWith({
        where: { id: postId, companyId, company: { members: member } },
        select: { id: true },
      });
      if (acknowledged) {
        expect(tx.companyPostAcknowledgment.upsert).toHaveBeenCalledWith({
          where: { postId_userId: { postId, userId } },
          create: { postId, userId },
          update: {},
        });
        expect(tx.companyPostAcknowledgment.deleteMany).not.toHaveBeenCalled();
      } else {
        expect(tx.companyPostAcknowledgment.deleteMany).toHaveBeenCalledWith({
          where: { postId, userId },
        });
        expect(tx.companyPostAcknowledgment.upsert).not.toHaveBeenCalled();
      }
      expect(tx.companyPostAcknowledgment.count).toHaveBeenCalledWith({
        where: {
          postId,
          user: { companyMemberships: { some: { companyId } } },
        },
      });
      expect(db.companyPostAcknowledgment.count).not.toHaveBeenCalled();
    },
  );

  it("cannot acknowledge posts outside the user's company membership", async () => {
    const { caller, tx } = setup();
    tx.companyPost.findFirst.mockResolvedValue(null);
    await expect(
      caller.setPostAcknowledgment({ ...identity, acknowledged: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.companyPostAcknowledgment.upsert).not.toHaveBeenCalled();
    expect(tx.companyPostAcknowledgment.deleteMany).not.toHaveBeenCalled();
    expect(tx.companyPostAcknowledgment.count).not.toHaveBeenCalled();
  });

  it("propagates acknowledgment write failures without returning a summary", async () => {
    const { caller, tx } = setup();
    tx.companyPost.findFirst.mockResolvedValue({ id: postId });
    tx.companyPostAcknowledgment.upsert.mockRejectedValue(
      new Error("write failed"),
    );
    await expect(
      caller.setPostAcknowledgment({ ...identity, acknowledged: true }),
    ).rejects.toThrow("write failed");
    expect(tx.companyPostAcknowledgment.count).not.toHaveBeenCalled();
  });

  it("returns current members' acknowledgment timestamps only after an admin check", async () => {
    const { caller, db } = setup();
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const person = {
      id: userId,
      name: "Alex",
      image: null,
      email: "alex@example.com",
    };
    db.companyPost.findFirst.mockResolvedValue({ id: postId });
    db.companyMember.findMany.mockResolvedValue([
      { user: { ...person, postAcknowledgments: [{ createdAt }] } },
      { user: { ...person, id: "other", postAcknowledgments: [] } },
    ]);
    await expect(caller.getPostAcknowledgments(identity)).resolves.toEqual([
      { ...person, acknowledgedAt: createdAt },
      { ...person, id: "other", acknowledgedAt: null },
    ]);
    expect(db.companyPost.findFirst).toHaveBeenCalledWith({
      where: {
        id: postId,
        companyId,
        company: {
          members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } },
        },
      },
      select: { id: true },
    });
    expect(db.companyMember.findMany).toHaveBeenCalledWith({
      where: { companyId },
      orderBy: { user: { name: "asc" } },
      select: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            email: true,
            postAcknowledgments: {
              where: { postId },
              select: { createdAt: true },
            },
          },
        },
      },
    });
  });

  it("does not disclose acknowledgment details without admin access", async () => {
    const { caller, db } = setup();
    db.companyPost.findFirst.mockResolvedValue(null);
    await expect(caller.getPostAcknowledgments(identity)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(db.companyMember.findMany).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    "deletes posts scoped to company and admin membership (count %i)",
    async (count) => {
      const { caller, db } = setup();
      db.companyPost.deleteMany.mockResolvedValue({ count });
      const result = caller.deleteCompanyPost(identity);
      if (count) await expect(result).resolves.toEqual({ success: true });
      else await expect(result).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(db.companyPost.deleteMany).toHaveBeenCalledWith({
        where: { id: postId, companyId, company: { members: admins } },
      });
    },
  );

  const procedures = [
    ["getCompany", { companyId }],
    ["listCompanies", undefined],
    ["createCompany", { name: "Acme" }],
    ["deleteCompany", { companyId }],
    ["updateCompany", { companyId, name: "Acme" }],
    ["getCompanyPosts", { companyId }],
    ["createCompanyPost", { companyId, title: "Update", content: "News" }],
    ["setPostAcknowledgment", { ...identity, acknowledged: true }],
    ["getPostAcknowledgments", identity],
    ["deleteCompanyPost", identity],
  ] as const;

  it.each(procedures)("requires authentication for %s", async (name, input) => {
    const { ctx, db } = createTestContext({ session: null });
    const caller = companyRouter.createCaller(ctx);
    const invoke = caller[name] as (input: unknown) => Promise<unknown>;
    await expect(invoke(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it.each(procedures)("rejects deleted users for %s", async (name, input) => {
    const { caller, db } = setup();
    db.user.findUnique.mockResolvedValue(null);
    const invoke = caller[name] as (input: unknown) => Promise<unknown>;
    await expect(invoke(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  const invalidInputs = [
    ["getCompany", { companyId: "bad" }],
    ["deleteCompany", { companyId: "bad" }],
    ["updateCompany", { companyId: "bad" }],
    ["getCompanyPosts", { companyId: "bad" }],
    [
      "createCompanyPost",
      { companyId: "bad", title: "Title", content: "Body" },
    ],
    ["getPostAcknowledgments", { ...identity, postId: "bad" }],
    ["getPostAcknowledgments", { ...identity, companyId: "bad" }],
    ["deleteCompanyPost", { ...identity, postId: "bad" }],
    ["deleteCompanyPost", { ...identity, companyId: "bad" }],
    ["setPostAcknowledgment", { ...identity, acknowledged: "yes" }],
    [
      "setPostAcknowledgment",
      { ...identity, postId: "bad", acknowledged: true },
    ],
    [
      "setPostAcknowledgment",
      { ...identity, companyId: "bad", acknowledged: true },
    ],
    ...["createCompany", "updateCompany"].flatMap((name) =>
      [
        { name: " " },
        { name: "x".repeat(101) },
        { name: "Acme", image: "invalid" },
        { name: "Acme", description: "x".repeat(301) },
        { name: "Acme", website: "invalid" },
        { name: "Acme", email: "invalid" },
        { name: "Acme", phone: "x".repeat(21) },
      ].map((input) => [name, { companyId, ...input }] as const),
    ),
    ...[
      { title: " " },
      { title: "x".repeat(101) },
      { content: " " },
      { content: "x".repeat(1001) },
    ].map(
      (input) =>
        [
          "createCompanyPost",
          { companyId, title: "Title", content: "Body", ...input },
        ] as const,
    ),
  ] as const;

  it.each(invalidInputs)("validates input for %s (%j)", async (name, input) => {
    const { caller, db } = setup();
    const invoke = caller[name as keyof typeof caller] as (
      input: unknown,
    ) => Promise<unknown>;
    await expect(invoke(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.company.findFirst).not.toHaveBeenCalled();
    expect(db.company.updateMany).not.toHaveBeenCalled();
    expect(db.company.deleteMany).not.toHaveBeenCalled();
    expect(db.companyPost.findFirst).not.toHaveBeenCalled();
    expect(db.companyPost.create).not.toHaveBeenCalled();
    expect(db.companyPost.deleteMany).not.toHaveBeenCalled();
  });
});
