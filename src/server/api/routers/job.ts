import z from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { tileSchema } from "~/app/_components/jobs/tiles/registry";
import { canSeeTile, keepJobMembers } from "~/lib/job-tiles";
import { imageFileSchema, imageKeySchema } from "~/lib/image-upload";
import {
  confirmPrivateImageUpload,
  createImageUpload,
  deleteReplacedKey,
  jobFolder,
  jobPhotoFolder,
  signedImageUrl,
} from "~/server/image-uploads";
import {
  requireJobAccess,
  requireJobManager,
  visibleJobsWhere,
} from "~/server/job-access";
import { deletePrefix, storageConfigured } from "~/server/storage";
import { saveJobContents } from "~/server/jobs";
import { serializableTransaction } from "~/server/transactions";

const getJobSchema = z.object({
  jobId: z.string().cuid(),
});

// What the job builder saves, whether creating or editing a job.
const jobFieldsSchema = z.object({
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
  memberIds: z.array(z.string().cuid()).max(200),
  tiles: tileSchema.array().max(50),
});

// A new job can start empty; an update must send both, so it can't wipe them.
const createJobScheme = jobFieldsSchema.extend({
  companyId: z.string().cuid(),
  memberIds: jobFieldsSchema.shape.memberIds.default([]),
  tiles: jobFieldsSchema.shape.tiles.default([]),
});

const updateJobSchema = jobFieldsSchema.extend({
  jobId: z.string().cuid(),
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
      // A tile saved under a since-removed type or an older config is skipped,
      // so changing a tile type can't break every job that uses it. Saving
      // the job leaves it in place (see saveJobContents).
      const saved = job.tiles.flatMap((tile) => {
        const parsed = tileSchema.safeParse(tile);
        if (parsed.success) return [parsed.data];
        console.error(`Skipped job tile ${tile.id}`, parsed.error.issues);
        return [];
      });
      // Visibility lists can still name people since taken off the job.
      const tiles = keepJobMembers(saved, memberIds)
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
        select: {
          id: true,
          title: true,
          description: true,
          photo: true,
          _count: { select: { members: { where: { removedAt: null } } } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return Promise.all(
        jobs.map(async ({ photo, _count, ...job }) => ({
          ...job,
          photoUrl: await signedImageUrl(photo),
          memberCount: _count.members,
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

      const job = await serializableTransaction(ctx.db, async (tx) => {
        const created = await tx.job.create({
          data: {
            title: input.title,
            description: input.description,
            companyId: company.id,
            createdById: ctx.session.user.id,
          },
        });
        await saveJobContents(tx, created, input.memberIds, input.tiles);
        return created;
      });

      return { id: job.id };
    }),

  // Replaces a job's details, members and tiles with what the builder saved.
  updateJob: protectedProcedure
    .input(updateJobSchema)
    .mutation(({ ctx, input }) =>
      serializableTransaction(ctx.db, async (tx) => {
        const job = await requireJobManager(
          tx,
          ctx.session.user.id,
          input.jobId,
        );
        await tx.job.update({
          where: { id: job.id },
          data: { title: input.title, description: input.description },
        });
        await saveJobContents(tx, job, input.memberIds, input.tiles);
        return { id: job.id };
      }),
    ),
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

      if (storageConfigured()) {
        try {
          await deletePrefix(jobFolder(input.jobId));
        } catch (error) {
          // The job is already deleted; leftover files are harmless.
          console.error("Failed to delete job files", error);
        }
      }

      return { success: true };
    }),

  // Signs an upload for a job photo; setPhoto then confirms and saves it.
  createPhotoUpload: protectedProcedure
    .input(getJobSchema.merge(imageFileSchema))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const job = await requireJobManager(ctx.db, userId, input.jobId);
      return createImageUpload(
        ctx.db,
        userId,
        jobPhotoFolder(job.id),
        "banner",
        input,
      );
    }),

  // Saves a confirmed upload as the job's photo, or removes it with null.
  setPhoto: protectedProcedure
    .input(getJobSchema.extend({ key: imageKeySchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const job = await requireJobManager(ctx.db, userId, input.jobId);
      const folder = jobPhotoFolder(job.id);
      const key = input.key
        ? await confirmPrivateImageUpload(
            ctx.db,
            userId,
            folder,
            "banner",
            input.key,
          )
        : null;
      const current = await ctx.db.job.findUnique({
        where: { id: job.id },
        select: { photo: true },
      });
      // The job may have been deleted while the upload was being checked.
      const { count } = await ctx.db.job.updateMany({
        where: { id: job.id },
        data: { photo: key },
      });
      if (!current || count === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
      await deleteReplacedKey(folder, current.photo, key);
      return { photoUrl: await signedImageUrl(key) };
    }),
});
