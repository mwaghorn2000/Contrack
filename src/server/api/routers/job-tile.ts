import z from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../../../generated/prisma";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  tileSchema,
  type JobTile,
} from "~/app/_components/jobs/tiles/registry";
import { canSeeTile } from "~/lib/job-tiles";
import { requireJobAccess } from "~/server/job-access";
import {
  answerableTypes,
  answerRules,
  requireVisibleTile,
  type AnswerRules,
} from "~/server/job-tiles";
import { serializableTransaction } from "~/server/transactions";
import { attachmentFileSchema, attachmentKeySchema } from "~/lib/attachments";
import type { TileAnswer } from "~/app/_components/jobs/tiles/define-tile";
import {
  confirmAttachmentUpload,
  createAttachmentUpload,
  signedImageUrl,
  tileFilesFolder,
} from "~/server/image-uploads";
import { deleteObject, storageConfigured } from "~/server/storage";

// What someone enters on a tile. `data` is checked against the tile type's
// own schema; the note is free text that any answer can carry.
const answerFields = {
  data: z.unknown(),
  note: z.string().trim().max(2000).optional(),
};

const answerIdSchema = z.object({ answerId: z.string().cuid() });

/** A note as saved: an empty or missing one is stored as no note. */
function emptyToNull(note: string | undefined) {
  return note?.length ? note : null;
}

/** BAD_REQUEST when a note is sent to a tile whose answers don't take one. */
function checkNote(rules: AnswerRules, note: string | undefined) {
  if (rules.notes === false && note)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This tile doesn't take notes.",
    });
}

/** The tile's answer rules, or BAD_REQUEST for tiles that take no answers. */
function requireAnswerRules(tile: JobTile) {
  const rules = answerRules(tile.type);
  if (!rules)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This tile doesn't take answers.",
    });
  return rules;
}

/**
 * Parses an answer for a tile and applies the tile's own rules against its
 * other answers (leaving out `answerId` when editing it). Returns the data.
 */
async function checkedAnswer(
  tx: Prisma.TransactionClient,
  tile: JobTile,
  rules: AnswerRules,
  input: unknown,
  userId: string,
  answerId?: string,
) {
  const parsed = rules.schema.safeParse(input);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That answer doesn't fit this tile.",
    });
  const others = await tx.jobTileAnswer.findMany({
    where: { tileId: tile.id, ...(answerId ? { id: { not: answerId } } : {}) },
    select: { authorId: true, data: true },
  });
  const message = rules.check?.({
    config: tile.config,
    data: parsed.data,
    userId,
    others: others.flatMap(({ authorId, data }) => {
      const other = rules.schema.safeParse(data);
      const value: unknown = other.data;
      return other.success ? [{ authorId, data: value }] : [];
    }),
  });
  if (message) throw new TRPCError({ code: "BAD_REQUEST", message });
  return parsed.data as Prisma.InputJsonValue;
}

/**
 * Checks an answer has as many files as its tile takes, then claims each
 * upload (the uploader's own, in this tile's folder, unused) and returns the
 * rows to save with their stored types and sizes.
 */
async function claimedFiles(
  tx: Prisma.TransactionClient,
  rules: AnswerRules,
  files: { key: string; name: string }[],
  upload: { userId: string; folder: string },
) {
  const limits = rules.files ?? { min: 0, max: 0 };
  if (files.length > limits.max)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        limits.max === 0
          ? "This tile doesn't take files."
          : `Attach at most ${limits.max} files.`,
    });
  if (files.length < limits.min)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add at least one photo or file.",
    });
  // Checked together, so a batch of files doesn't hold the transaction open
  // for one storage request after another.
  return Promise.all(
    files.map(async ({ key, name }) => ({
      key,
      name,
      ...(await confirmAttachmentUpload(tx, upload.userId, upload.folder, key)),
    })),
  );
}

/**
 * Finds an answer on a tile the user can see, with the tile and whether they
 * manage the job. Anything else is NOT_FOUND, with one message for all cases.
 */
async function requireVisibleAnswer(
  tx: Prisma.TransactionClient,
  userId: string,
  answerId: string,
) {
  const notFound = new TRPCError({
    code: "NOT_FOUND",
    message: "Answer not found.",
  });
  const answer = await tx.jobTileAnswer.findUnique({
    where: { id: answerId },
    select: { id: true, tileId: true, authorId: true },
  });
  if (!answer) throw notFound;
  const { tile, isManager } = await requireVisibleTile(
    tx,
    userId,
    answer.tileId,
  ).catch(() => {
    throw notFound;
  });
  return { answer, tile, isManager };
}

export const jobTileRouter = createTRPCRouter({
  // Every answer on the job's tiles this user can see, by tile id.
  listAnswers: protectedProcedure
    .input(z.object({ jobId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { isManager } = await requireJobAccess(ctx.db, userId, input.jobId);
      const rows = await ctx.db.jobTile.findMany({
        where: {
          jobId: input.jobId,
          removedAt: null,
          type: { in: answerableTypes() },
        },
        select: {
          id: true,
          type: true,
          config: true,
          visibility: true,
          answers: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              authorId: true,
              data: true,
              note: true,
              createdAt: true,
              updatedAt: true,
              author: { select: { id: true, name: true, image: true } },
              files: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  key: true,
                  name: true,
                  contentType: true,
                  size: true,
                },
              },
            },
          },
        },
      });
      const result: Record<string, TileAnswer<unknown>[]> = {};
      for (const { answers, ...row } of rows) {
        const tile = tileSchema.safeParse(row);
        if (!tile.success || !canSeeTile(tile.data, { userId, isManager }))
          continue;
        const rules = answerRules(tile.data.type);
        if (!rules) continue;
        // Answers from an older version of the tile type are skipped.
        const fitting = answers.flatMap(({ data, ...answer }) => {
          const parsed = rules.schema.safeParse(data);
          const value: unknown = parsed.data;
          return parsed.success ? [{ ...answer, data: value }] : [];
        });
        result[row.id] = await Promise.all(
          fitting.map(async ({ authorId, files, ...answer }) => {
            const own = authorId === userId;
            return {
              ...answer,
              // Signed links last at least an hour; the page reloads sooner.
              files: await Promise.all(
                files.map(async ({ key, ...file }) => ({
                  ...file,
                  url: await signedImageUrl(key),
                })),
              ),
              canEdit: own,
              canDelete: own || isManager,
            };
          }),
        );
      }
      return result;
    }),

  // Adds an answer to a tile, for anyone who can see it.
  createAnswer: protectedProcedure
    .input(
      z.object({
        tileId: z.string().cuid(),
        ...answerFields,
        // Uploaded first with createFileUpload; claimed here, once each.
        files: z
          .array(
            z.object({
              key: attachmentKeySchema,
              // Long names are shortened rather than refused, after upload.
              name: z
                .string()
                .trim()
                .min(1)
                .max(1000)
                .transform((name) => name.slice(0, 200)),
            }),
          )
          .max(10)
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // One transaction, so two people can't both pass a "tick once" rule.
      return serializableTransaction(ctx.db, async (tx) => {
        const { tile, job } = await requireVisibleTile(
          tx,
          userId,
          input.tileId,
        );
        const rules = requireAnswerRules(tile);
        checkNote(rules, input.note);
        const data = await checkedAnswer(tx, tile, rules, input.data, userId);
        const files = await claimedFiles(tx, rules, input.files ?? [], {
          userId,
          folder: tileFilesFolder(job.id, tile.id),
        });
        return tx.jobTileAnswer.create({
          data: {
            tileId: tile.id,
            authorId: userId,
            data,
            note: emptyToNull(input.note),
            files: { create: files },
          },
          select: { id: true },
        });
      });
    }),

  // Changes an answer's data and note, for its author only.
  updateAnswer: protectedProcedure
    .input(answerIdSchema.extend(answerFields))
    .mutation(({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return serializableTransaction(ctx.db, async (tx) => {
        const { answer, tile } = await requireVisibleAnswer(
          tx,
          userId,
          input.answerId,
        );
        if (answer.authorId !== userId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only change your own answers.",
          });
        const rules = requireAnswerRules(tile);
        checkNote(rules, input.note);
        const data = await checkedAnswer(
          tx,
          tile,
          rules,
          input.data,
          userId,
          answer.id,
        );
        await tx.jobTileAnswer.update({
          where: { id: answer.id },
          // Leaving the note out keeps it; sending "" clears it.
          data: {
            data,
            ...(input.note === undefined
              ? {}
              : { note: emptyToNull(input.note) }),
          },
        });
        return { id: answer.id };
      });
    }),

  // Deletes an answer, for its author or a company owner or admin.
  deleteAnswer: protectedProcedure
    .input(answerIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { answer, isManager } = await requireVisibleAnswer(
        ctx.db,
        userId,
        input.answerId,
      );
      if (answer.authorId !== userId && !isManager)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own answers.",
        });
      const files = await ctx.db.jobTileFile.findMany({
        where: { answerId: answer.id },
        select: { key: true },
      });
      await ctx.db.jobTileAnswer.deleteMany({ where: { id: answer.id } });
      // The answer is gone either way; a leftover file is harmless, and goes
      // when the job does.
      if (storageConfigured())
        await Promise.allSettled(files.map(({ key }) => deleteObject(key)));
      return { id: answer.id };
    }),

  // Signs an upload of a photo or PDF to attach to a new answer on this tile.
  createFileUpload: protectedProcedure
    .input(
      z
        .object({ tileId: z.string().cuid() })
        .extend(attachmentFileSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tile, job } = await requireVisibleTile(
        ctx.db,
        userId,
        input.tileId,
      );
      if (!answerRules(tile.type)?.files)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This tile doesn't take files.",
        });
      return createAttachmentUpload(
        ctx.db,
        userId,
        tileFilesFolder(job.id, tile.id),
        input,
      );
    }),
});
