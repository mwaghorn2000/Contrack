import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { hashInvitationToken } from "~/server/invitations";
import { serializableTransaction } from "~/server/transactions";
import { sendCompanyInvitationEmail } from "~/server/email";
import type { Prisma } from "../../../../generated/prisma";

const companyInput = z.object({ companyId: z.string().cuid() });
const invitationSelect = {
  id: true,
  companyId: true,
  email: true,
  role: true,
  createdAt: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
} as const;

async function requireManager(
  db: Prisma.TransactionClient,
  companyId: string,
  userId: string,
) {
  const company = await db.company.findFirst({
    where: {
      id: companyId,
      members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } },
    },
    select: { id: true, name: true },
  });
  if (!company)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only company owners and admins can manage invitations.",
    });
  return company;
}

export const invitationRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      companyInput.extend({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((email) => email.toLowerCase()),
        role: z.enum(["MEMBER", "CONTRACTOR"]),
        expiresInHours: z.number().int().min(1).max(168),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const token = randomBytes(32).toString("hex");
      const result = await serializableTransaction(ctx.db, async (tx) => {
        const company = await requireManager(
          tx,
          input.companyId,
          ctx.session.user.id,
        );
        const member = await tx.companyMember.findFirst({
          where: {
            companyId: input.companyId,
            user: { email: { equals: input.email, mode: "insensitive" } },
          },
        });
        if (member)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This person is already a member of the company.",
          });

        // Database-backed limits also work across multiple server instances.
        const now = new Date();
        const hourAgo = new Date(now.getTime() - 3_600_000);
        const [sentByUser, sentByCompany, sentToEmail, recent] =
          await Promise.all([
            tx.companyInvitation.count({
              where: {
                createdById: ctx.session.user.id,
                createdAt: { gte: hourAgo },
              },
            }),
            tx.companyInvitation.count({
              where: {
                companyId: input.companyId,
                createdAt: { gte: hourAgo },
              },
            }),
            tx.companyInvitation.count({
              where: { email: input.email, createdAt: { gte: hourAgo } },
            }),
            tx.companyInvitation.count({
              where: {
                companyId: input.companyId,
                email: input.email,
                createdAt: { gt: new Date(now.getTime() - 60_000) },
              },
            }),
          ]);
        if (
          sentByUser >= 50 ||
          sentByCompany >= 50 ||
          sentToEmail >= 5 ||
          recent > 0
        ) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Please wait before sending more invitations.",
          });
        }
        // A replacement invalidates previous links to this company for this email.
        await tx.companyInvitation.updateMany({
          where: {
            companyId: input.companyId,
            email: input.email,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        const invitation = await tx.companyInvitation.create({
          data: {
            companyId: input.companyId,
            email: input.email,
            role: input.role,
            createdById: ctx.session.user.id,
            tokenHash: hashInvitationToken(token),
            expiresAt: new Date(
              now.getTime() + input.expiresInHours * 3_600_000,
            ),
          },
          select: invitationSelect,
        });
        return { company, invitation };
      });

      // Send once, after commit; retries must never send duplicate emails.
      try {
        await sendCompanyInvitationEmail({
          email: input.email,
          companyName: result.company.name,
          role: input.role,
          token,
          expiresAt: result.invitation.expiresAt,
        });
      } catch {
        await ctx.db.companyInvitation.updateMany({
          where: { id: result.invitation.id, acceptedAt: null },
          data: { revokedAt: new Date() },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "We couldn't send the invitation. Please try again in a minute.",
        });
      }
      return result.invitation;
    }),

  list: protectedProcedure.input(companyInput).query(async ({ ctx, input }) => {
    await requireManager(ctx.db, input.companyId, ctx.session.user.id);
    return ctx.db.companyInvitation.findMany({
      where: { companyId: input.companyId },
      select: invitationSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }),

  revoke: protectedProcedure
    .input(companyInput.extend({ invitationId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      return serializableTransaction(ctx.db, async (tx) => {
        await requireManager(tx, input.companyId, ctx.session.user.id);
        const result = await tx.companyInvitation.updateMany({
          where: {
            id: input.invitationId,
            companyId: input.companyId,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        if (result.count === 0)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation is already accepted, revoked, or unavailable.",
          });
        return { success: true };
      });
    }),

  pending: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { email: true, emailVerified: true },
    });
    if (!user.email || !user.emailVerified)
      return { requiresVerification: true, invitations: [] };
    const invitations = await ctx.db.companyInvitation.findMany({
      where: {
        email: user.email.toLowerCase(),
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { ...invitationSelect, company: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { requiresVerification: false, invitations };
  }),

  accept: protectedProcedure
    .input(
      z.union([
        z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        z.object({ invitationId: z.string().cuid() }).strict(),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      return serializableTransaction(ctx.db, async (tx) => {
        // Check the database, not potentially stale email details in a JWT.
        const user = await tx.user.findUniqueOrThrow({
          where: { id: ctx.session.user.id },
          select: { email: true, emailVerified: true },
        });
        if (!user.email || !user.emailVerified)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Verify your email before accepting an invitation.",
          });
        const invitation = await tx.companyInvitation.findUnique({
          where:
            "token" in input
              ? { tokenHash: hashInvitationToken(input.token) }
              : { id: input.invitationId },
        });
        const now = new Date();
        if (
          invitation?.email !== user.email.toLowerCase() ||
          invitation.revokedAt ||
          invitation.acceptedAt ||
          invitation.expiresAt <= now
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "This invitation is unavailable, expired, or belongs to a different email address.",
          });
        }
        await requireManager(tx, invitation.companyId, invitation.createdById);
        if (invitation.role !== "MEMBER" && invitation.role !== "CONTRACTOR")
          throw new TRPCError({ code: "FORBIDDEN" });
        const claimed = await tx.companyInvitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { acceptedAt: now },
        });
        if (claimed.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Invitation is no longer available.",
          });
        // Existing membership roles are never overwritten by an invitation.
        await tx.companyMember.upsert({
          where: {
            userId_companyId: {
              userId: ctx.session.user.id,
              companyId: invitation.companyId,
            },
          },
          create: {
            userId: ctx.session.user.id,
            companyId: invitation.companyId,
            role: invitation.role,
          },
          update: {},
        });
        return { companyId: invitation.companyId };
      });
    }),

  members: protectedProcedure
    .input(companyInput)
    .query(async ({ ctx, input }) => {
      const membership = await ctx.db.companyMember.findUnique({
        where: {
          userId_companyId: {
            userId: ctx.session.user.id,
            companyId: input.companyId,
          },
        },
      });
      if (!membership)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Company not found.",
        });
      return ctx.db.companyMember.findMany({
        where: { companyId: input.companyId },
        // CompanyRole is declared in OWNER, ADMIN, MEMBER, CONTRACTOR order.
        orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        select: {
          role: true,
          user: { select: { id: true, name: true, image: true } },
        },
      });
    }),
});
