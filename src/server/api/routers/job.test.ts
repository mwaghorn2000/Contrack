import { describe, expect, it } from "vitest";

import { createTestContext } from "~/test/helpers";
import { jobRouter } from "./job";

const companyId = "clcompany00000000000000001";
const jobId = "cljob00000000000000000001";
const userId = "cltestuser0000000000000001";

const routes = [
  {
    name: "getJob",
    call: (caller: ReturnType<typeof jobRouter.createCaller>, id: string) =>
      caller.getJob({ jobId: id }),
  },
  {
    name: "listCompanyJobs",
    call: (caller: ReturnType<typeof jobRouter.createCaller>, id: string) =>
      caller.listCompanyJobs({ companyId: id }),
  },
  {
    name: "createJob",
    call: (caller: ReturnType<typeof jobRouter.createCaller>, id: string) =>
      caller.createJob({ companyId: id, title: "New job" }),
  },
  {
    name: "deleteJob",
    call: (caller: ReturnType<typeof jobRouter.createCaller>, id: string) =>
      caller.deleteJob({ jobId: id }),
  },
];

function expectNoJobAccess(db: ReturnType<typeof createTestContext>["db"]) {
  expect(db.job.findFirst).not.toHaveBeenCalled();
  expect(db.job.findMany).not.toHaveBeenCalled();
  expect(db.job.create).not.toHaveBeenCalled();
  expect(db.job.deleteMany).not.toHaveBeenCalled();
  expect(db.company.findUnique).not.toHaveBeenCalled();
}

describe("jobRouter", () => {
  describe.each(routes)("$name protection and validation", ({ call }) => {
    it("rejects signed-out callers before accessing the database", async () => {
      const { ctx, db } = createTestContext({ session: null });
      await expect(
        call(jobRouter.createCaller(ctx), jobId),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expectNoJobAccess(db);
    });

    it("rejects a session whose user no longer exists", async () => {
      const { ctx, db } = createTestContext();
      db.user.findUnique.mockResolvedValue(null);
      await expect(
        call(jobRouter.createCaller(ctx), jobId),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: { id: true },
      });
      expectNoJobAccess(db);
    });

    it.each(["", "not-a-cuid", "550e8400-e29b-41d4-a716-446655440000"])(
      "rejects invalid id %j",
      async (id) => {
        const { ctx, db } = createTestContext();
        await expect(
          call(jobRouter.createCaller(ctx), id),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expectNoJobAccess(db);
      },
    );
  });

  describe("getJob", () => {
    it("returns the job and restricts lookup to the caller's company memberships", async () => {
      const { ctx, db } = createTestContext();
      const job = { id: jobId, companyId, title: "Site inspection" };
      db.job.findFirst.mockResolvedValue(job);
      await expect(
        jobRouter.createCaller(ctx).getJob({ jobId }),
      ).resolves.toEqual(job);
      expect(db.job.findFirst).toHaveBeenCalledWith({
        where: { id: jobId, company: { members: { some: { userId } } } },
      });
    });

    it("reports absent or inaccessible jobs as not found", async () => {
      const { ctx, db } = createTestContext();
      db.job.findFirst.mockResolvedValue(null);
      await expect(
        jobRouter.createCaller(ctx).getJob({ jobId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Job not found" });
    });
  });

  describe("listCompanyJobs", () => {
    it("returns jobs for the requested company with the caller's membership filter", async () => {
      const { ctx, db } = createTestContext();
      const jobs = [{ id: jobId, companyId, title: "Inspection" }];
      db.job.findMany.mockResolvedValue(jobs);
      await expect(
        jobRouter.createCaller(ctx).listCompanyJobs({ companyId }),
      ).resolves.toEqual(jobs);
      expect(db.job.findMany).toHaveBeenCalledWith({
        where: { companyId, company: { members: { some: { userId } } } },
      });
    });

    it("returns an empty list for absent, empty, or inaccessible companies", async () => {
      const { ctx, db } = createTestContext();
      db.job.findMany.mockResolvedValue([]);
      await expect(
        jobRouter.createCaller(ctx).listCompanyJobs({ companyId }),
      ).resolves.toEqual([]);
    });
  });

  describe("createJob", () => {
    it("requires owner/admin membership, trims fields, and records the caller as creator", async () => {
      const { ctx, db } = createTestContext();
      const job = {
        id: jobId,
        companyId,
        title: "Inspection",
        description: "Roof inspection",
        createdById: userId,
      };
      db.company.findUnique.mockResolvedValue({ id: companyId });
      db.job.create.mockResolvedValue(job);
      await expect(
        jobRouter.createCaller(ctx).createJob({
          companyId,
          title: "  Inspection  ",
          description: "  Roof inspection  ",
        }),
      ).resolves.toEqual(job);
      expect(db.company.findUnique).toHaveBeenCalledWith({
        where: {
          id: companyId,
          members: { some: { userId, role: { in: ["ADMIN", "OWNER"] } } },
        },
      });
      expect(db.job.create).toHaveBeenCalledWith({
        data: {
          title: "Inspection",
          description: "Roof inspection",
          companyId,
          createdById: userId,
        },
      });
    });

    it("accepts an omitted description and maximum title length", async () => {
      const { ctx, db } = createTestContext();
      db.company.findUnique.mockResolvedValue({ id: companyId });
      db.job.create.mockResolvedValue({ id: jobId });
      await jobRouter
        .createCaller(ctx)
        .createJob({ companyId, title: "a".repeat(99) });
      expect(db.job.create).toHaveBeenCalledWith({
        data: {
          title: "a".repeat(99),
          description: undefined,
          companyId,
          createdById: userId,
        },
      });
    });

    it("accepts the maximum description length", async () => {
      const { ctx, db } = createTestContext();
      db.company.findUnique.mockResolvedValue({ id: companyId });
      db.job.create.mockResolvedValue({ id: jobId });
      await jobRouter.createCaller(ctx).createJob({
        companyId,
        title: "Inspection",
        description: "a".repeat(500),
      });
      expect(db.job.create).toHaveBeenCalledWith({
        data: {
          title: "Inspection",
          description: "a".repeat(500),
          companyId,
          createdById: userId,
        },
      });
    });

    it("does not create a job when the company is absent or the caller lacks permission", async () => {
      const { ctx, db } = createTestContext();
      db.company.findUnique.mockResolvedValue(null);
      await expect(
        jobRouter
          .createCaller(ctx)
          .createJob({ companyId, title: "Inspection" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(db.job.create).not.toHaveBeenCalled();
    });

    it.each([
      { title: "" },
      { title: " \t\n " },
      { title: "a".repeat(100) },
      { title: "Inspection", description: "a".repeat(501) },
    ])("rejects invalid job fields: %j", async (input) => {
      const { ctx, db } = createTestContext();
      await expect(
        jobRouter.createCaller(ctx).createJob({ companyId, ...input }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expectNoJobAccess(db);
    });
  });

  describe("deleteJob", () => {
    it("deletes only the requested job where the caller is owner/admin", async () => {
      const { ctx, db } = createTestContext();
      db.job.deleteMany.mockResolvedValue({ count: 1 });
      await expect(
        jobRouter.createCaller(ctx).deleteJob({ jobId }),
      ).resolves.toEqual({ success: true });
      expect(db.job.deleteMany).toHaveBeenCalledWith({
        where: {
          company: {
            members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } },
          },
          id: jobId,
        },
      });
    });

    it("reports zero deletions as not found, including insufficient permission", async () => {
      const { ctx, db } = createTestContext();
      db.job.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        jobRouter.createCaller(ctx).deleteJob({ jobId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Job not found or you don't have permission to delete jobs.",
      });
    });
  });
});
