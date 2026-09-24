import z from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

const getJobSchema = z.object({
  jobId: z.string().cuid(),
});

const createJobScheme = z.object({
  companyId: z.string().cuid(),
  title: z
    .string()
    .trim()
    .min(1, "Title must not be blank.")
    .max(99, "Title must be less than 100 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be less than 500 characters")
    .optional(),
});

export const jobRouter = createTRPCRouter({
  getJob: protectedProcedure
    .input(getJobSchema)
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.job.findFirst({
        where: {
          id: input.jobId,
          company: {
            members: {
              some: {
                userId: ctx.session.user.id,
              },
            },
          },
        },
      });

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
    }),

  listCompanyJobs: protectedProcedure
    .input(
      z.object({
        companyId: z.string().cuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.db.job.findMany({
        where: {
          companyId: input.companyId,
          company: {
            members: {
              some: {
                userId: ctx.session.user.id,
              },
            },
          },
        },
      });
    }),

  createJob: protectedProcedure
    .input(createJobScheme)
    .mutation(async ({ ctx, input }) => {
      const company = await ctx.db.company.findUnique({
        where: {
          id: input.companyId,
          members: {
            some: {
              userId: ctx.session.user.id,
              role: { in: ["ADMIN", "OWNER"] },
            },
          },
        },
      });

      if (!company) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Company not found or you don't have permission to create jobs.",
        });
      }

      const job = await ctx.db.job.create({
        data: {
          title: input.title,
          description: input.description,
          companyId: company.id,
          createdById: ctx.session.user.id,
        },
      });

      return job;
    }),
  deleteJob: protectedProcedure
    .input(
      z.object({
        jobId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const jobs = await ctx.db.job.deleteMany({
        where: {
          company: {
            members: {
              some: {
                userId: ctx.session.user.id,
                role: { in: ["OWNER", "ADMIN"] },
              },
            },
          },
          id: input.jobId,
        },
      });

      if (jobs.count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found or you don't have permission to delete jobs.",
        });
      }

      return { success: true };
    }),
});
