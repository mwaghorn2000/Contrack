import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import { appRouter, createCaller } from "./root";
import { createTestContext, USER_ID } from "~/test/helpers";
import { auth } from "~/server/auth";
import { db as singleton } from "~/server/db";
import { createTRPCContext } from "./trpc";

const companyId = "clcompany0000000000000001";
const postId = "clpost0000000000000000001";
const jobId = "cljob00000000000000000001";
type Caller = ReturnType<typeof createCaller>;

const protectedRoutes: Record<string, (caller: Caller) => Promise<unknown>> = {
  "company.getCompany": (c) => c.company.getCompany({ companyId }),
  "company.listCompanies": (c) => c.company.listCompanies(),
  "company.createCompany": (c) => c.company.createCompany({ name: "Company" }),
  "company.deleteCompany": (c) => c.company.deleteCompany({ companyId }),
  "company.updateCompany": (c) =>
    c.company.updateCompany({ companyId, name: "Updated" }),
  "company.getCompanyPosts": (c) => c.company.getCompanyPosts({ companyId }),
  "company.createCompanyPost": (c) =>
    c.company.createCompanyPost({
      companyId,
      title: "Update",
      content: "News",
    }),
  "company.setPostAcknowledgment": (c) =>
    c.company.setPostAcknowledgment({ companyId, postId, acknowledged: true }),
  "company.getPostAcknowledgments": (c) =>
    c.company.getPostAcknowledgments({ companyId, postId }),
  "company.deleteCompanyPost": (c) =>
    c.company.deleteCompanyPost({ companyId, postId }),
  "job.getJob": (c) => c.job.getJob({ jobId }),
  "job.listCompanyJobs": (c) => c.job.listCompanyJobs({ companyId }),
  "job.createJob": (c) => c.job.createJob({ companyId, title: "Job" }),
  "job.deleteJob": (c) => c.job.deleteJob({ jobId }),
};

describe("router registration and authentication", () => {
  it("keeps the authentication matrix in sync with every registered procedure", () => {
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual(
      [
        ...Object.keys(protectedRoutes),
        "auth.signup",
        "auth.verificationEmail",
        "auth.verifyEmail",
      ].sort(),
    );
  });

  describe.each(Object.entries(protectedRoutes))("%s", (_name, invoke) => {
    it.each([
      ["anonymous", null],
      ["missing user", { expires: "2099-01-01" } as Session],
      [
        "missing user id",
        { user: { name: "No ID" }, expires: "2099-01-01" } as Session,
      ],
    ])(
      "rejects a %s session before accessing the database",
      async (_label, session) => {
        const { ctx, db } = createTestContext({ session });
        await expect(invoke(createCaller(ctx))).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        expect(db.user.findUnique).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
      },
    );

    it("rejects a stale session whose user was deleted", async () => {
      const { ctx, db } = createTestContext();
      db.user.findUnique.mockResolvedValue(null);
      await expect(invoke(createCaller(ctx))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "Your session is no longer valid. Please sign in again.",
      });
      expect(db.user.findUnique).toHaveBeenCalledExactlyOnceWith({
        where: { id: USER_ID },
        select: { id: true },
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  it("builds the request context from the mocked auth provider", async () => {
    const { ctx } = createTestContext();
    vi.mocked(auth).mockResolvedValueOnce(ctx.session as never);
    const headers = new Headers({ "x-test": "context" });
    const context = await createTRPCContext({ headers });
    expect(context.session).toBe(ctx.session);
    expect(context.headers).toBe(headers);
    expect(context.db === singleton).toBe(true);
  });

  it("blocks accidental access to the application database singleton", () => {
    expect(() => singleton.user).toThrow("Tests must inject a mock database");
  });
});
