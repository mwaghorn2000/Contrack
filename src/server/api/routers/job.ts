import z from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { tileSchema } from "~/app/_components/jobs/tiles/registry";
import { canSeeTile, keepJobMembers } from "~/lib/job-tiles";
import { signedImageUrl } from "~/server/image-uploads";
import { requireJobAccess, visibleJobsWhere } from "~/server/job-access";

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
  // Owners and admins get every tile; others only the tiles they can see.
  getJob: protectedProcedure
    .input(getJobSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { isManager } = await requireJobAccess(ctx.db, userId, input.jobId);
      const job = await ctx.db.job.findUnique({
        where: { id: input.jobId },
        select: {
          id: true,
          title: true,
          description: true,
          photo: true,
          members: {
            where: { removedAt: null },
            select: { userId: true },
            orderBy: { createdAt: "asc" },
          },
          tiles: {
            select: { id: true, type: true, config: true, visibility: true },
            orderBy: [{ position: "asc" }, { id: "asc" }],
          },
        },
      });
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });

      const memberIds = job.members.map((member) => member.userId);
      // Visibility lists can still name people since taken off the job.
      const tiles = keepJobMembers(
        tileSchema.array().parse(job.tiles),
        memberIds,
      )
        .filter((tile) => canSeeTile(tile, { userId, isManager }))
        // Others' names stay hidden: members only learn a tile is shared with them.
        .map((tile) =>
          isManager || tile.visibility.mode === "everyone"
            ? tile
            : {
                ...tile,
                visibility: { mode: "members" as const, userIds: [userId] },
              },
        );
      return {
        id: job.id,
        title: job.title,
        description: job.description,
        photoUrl: await signedImageUrl(job.photo),
        memberIds,
        tiles,
      };
    }),

  // Lists the jobs in a company this user can see, oldest first.
  listCompanyJobs: protectedProcedure
    .input(
      z.object({
        companyId: z.string().cuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const jobs = await ctx.db.job.findMany({
        where: visibleJobsWhere(ctx.session.user.id, input.companyId),
        select: { id: true, title: true, description: true, photo: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return Promise.all(
        jobs.map(async ({ photo, ...job }) => ({
          ...job,
          photoUrl: await signedImageUrl(photo),
        })),
      );
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
