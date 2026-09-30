import z from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../../../generated/prisma";
import { serializableTransaction } from "~/server/transactions";

const memberIdentitySchema = z.object({
  companyId: z.string().cuid(),
  userId: z.string().cuid(),
});

async function requireManageableMember(
  tx: Prisma.TransactionClient,
  companyId: string,
  actorId: string,
  userId: string,
) {
  const actor = await tx.companyMember.findUnique({
    where: { userId_companyId: { companyId, userId: actorId } },
  });
  if (actor?.role !== "OWNER" && actor?.role !== "ADMIN")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only owners and admins can manage company members.",
    });
  const member = await tx.companyMember.findUnique({
    where: { userId_companyId: { companyId, userId } },
    include: { user: { select: { email: true } } },
  });
  if (!member)
    throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
  if (member.role === "OWNER")
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "The company owner cannot be removed or have their role changed.",
    });
  if (actor.role === "ADMIN" && member.role === "ADMIN")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner can manage admins.",
    });
  return { actor, member };
}

const postIdentitySchema = z.object({
  companyId: z.string().cuid(),
  postId: z.string().cuid(),
});

const authorSelect = { name: true, image: true } as const;

function acknowledgmentRelations(companyId: string) {
  return {
    acknowledgments: {
      where: { user: { companyMemberships: { some: { companyId } } } },
      orderBy: [{ createdAt: "desc" }, { userId: "asc" }],
      take: 5,
      select: { user: { select: { id: true, ...authorSelect } } },
    },
    _count: {
      select: {
        acknowledgments: {
          where: { user: { companyMemberships: { some: { companyId } } } },
        },
      },
    },
  } satisfies Prisma.CompanyPostSelect;
}

function withAcknowledgmentSummary<
  T extends {
    acknowledgments: {
      user: { id: string; name: string | null; image: string | null };
    }[];
    _count: { acknowledgments: number };
  },
>(post: T, acknowledged: boolean) {
  const { acknowledgments, _count, ...details } = post;
  return {
    ...details,
    acknowledged,
    acknowledgmentCount: _count.acknowledgments,
    recentAcknowledgers: acknowledgments.map(({ user }) => user),
  };
}

const getCompanySchema = z.object({
  companyId: z.string().cuid(),
});

const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Company name must not left empty")
    .max(100, "Company name must be less than 100 characters"),
  image: z.string().url().nullish(),
  description: z
    .string()
    .max(300, "Company description must be less than 301 characters")
    .optional()
    .nullable(),
  website: z.string().url().optional(),
  email: z
    .string()
    .email()
    .max(254, "Company email must be less than 255 characters")
    .optional(),
  phone: z.string().max(20).optional(),
});

const updateCompanySchema = createCompanySchema.partial().extend({
  companyId: z.string().cuid(),
});

const createCompanyPostSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "title must not be empty")
    .max(100, "title must be less than 100 characters."),
  content: z
    .string()
    .trim()
    .min(1, "content must not be empty")
    .max(1000, "content must be less than 1000 characters."),
  companyId: z.string().cuid(),
});

export const companyRouter = createTRPCRouter({
  updateMemberRole: protectedProcedure
    .input(
      memberIdentitySchema.extend({
        role: z.enum(["ADMIN", "MEMBER", "CONTRACTOR"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return serializableTransaction(ctx.db, async (tx) => {
        const { actor, member } = await requireManageableMember(
          tx,
          input.companyId,
          ctx.session.user.id,
          input.userId,
        );
        if (input.role === "ADMIN" && actor.role !== "OWNER")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the owner can promote someone to admin.",
          });
        await tx.companyMember.update({
          where: { id: member.id },
          data: { role: input.role },
        });
        if (member.role === "ADMIN" && input.role !== "ADMIN") {
          await tx.companyInvitation.updateMany({
            where: {
              companyId: input.companyId,
              createdById: input.userId,
              acceptedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        }
        return { success: true };
      });
    }),

  removeMember: protectedProcedure
    .input(memberIdentitySchema)
    .mutation(async ({ ctx, input }) => {
      return serializableTransaction(ctx.db, async (tx) => {
        const { member } = await requireManageableMember(
          tx,
          input.companyId,
          ctx.session.user.id,
          input.userId,
        );
        // Remove access to this company's channels, while preserving history.
        await tx.channelMember.deleteMany({
          where: {
            userId: input.userId,
            channel: { companyId: input.companyId },
          },
        });
        // Old invitations must not allow the removed person to rejoin.
        await tx.companyInvitation.updateMany({
          where: {
            companyId: input.companyId,
            acceptedAt: null,
            revokedAt: null,
            OR: [
              { createdById: input.userId },
              ...(member.user.email
                ? [{ email: member.user.email.toLowerCase() }]
                : []),
            ],
          },
          data: { revokedAt: new Date() },
        });
        await tx.companyMember.delete({ where: { id: member.id } });
        return { success: true };
      });
    }),

  getCompany: protectedProcedure
    .input(getCompanySchema)
    .query(async ({ ctx, input }) => {
      const company = await ctx.db.company.findFirst({
        where: {
          id: input.companyId,
          members: {
            some: {
              userId: ctx.session.user.id,
            },
          },
        },
        include: {
          members: {
            where: { userId: ctx.session.user.id },
            select: { role: true, user: { select: authorSelect } },
          },
        },
      });

      if (!company) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Company not found",
        });
      }

      return company;
    }),
  listCompanies: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.company.findMany({
      where: {
        members: {
          some: {
            userId: ctx.session.user.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        image: true,
        description: true,
        members: {
          where: { userId: ctx.session.user.id },
          select: { role: true },
        },
      },
    });
  }),
  createCompany: protectedProcedure
    .input(createCompanySchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: input.name,
            image: input.image,
            description: input.description,
            website: input.website,
            email: input.email,
            phone: input.phone,
          },
        });

        await tx.companyMember.create({
          data: {
            companyId: company.id,
            userId: ctx.session.user.id,
            role: "OWNER",
          },
        });

        return company;
      });
    }),

  deleteCompany: protectedProcedure
    .input(
      z.object({
        companyId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.company.deleteMany({
        where: {
          id: input.companyId,
          members: {
            some: {
              userId: ctx.session.user.id,
              role: "OWNER",
            },
          },
        },
      });

      if (result.count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Company not found or you don't have permission to delete it",
        });
      }

      return { success: true };
    }),
  updateCompany: protectedProcedure
    .input(updateCompanySchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.company.updateMany({
        where: {
          id: input.companyId,
          members: {
            some: {
              userId: ctx.session.user.id,
              role: { in: ["OWNER", "ADMIN"] },
            },
          },
        },
        data: {
          name: input.name,
          image: input.image,
          description: input.description,
          website: input.website,
          email: input.email,
          phone: input.phone,
        },
      });

      if (result.count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Company not found or you don't have permission to update it",
        });
      }

      return { success: true };
    }),

  getCompanyPosts: protectedProcedure
    .input(
      z.object({
        companyId: z.string().cuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const company = await ctx.db.company.findFirst({
        where: {
          id: input.companyId,
          members: {
            some: {
              userId: ctx.session.user.id,
            },
          },
        },
        select: {
          posts: {
            include: {
              author: { select: authorSelect },
              ...acknowledgmentRelations(input.companyId),
            },
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      });

      if (!company) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Company not found",
        });
      }

      // The viewer may have acknowledged earlier than the five shown avatars.
      const viewerAcknowledgments =
        await ctx.db.companyPostAcknowledgment.findMany({
          where: {
            userId: ctx.session.user.id,
            post: { companyId: input.companyId },
          },
          select: { postId: true },
        });
      const acknowledgedPostIds = new Set(
        viewerAcknowledgments.map(({ postId }) => postId),
      );
      return company.posts.map((post) =>
        withAcknowledgmentSummary(post, acknowledgedPostIds.has(post.id)),
      );
    }),
  createCompanyPost: protectedProcedure
    .input(createCompanyPostSchema)
    .mutation(async ({ ctx, input }) => {
      const company = await ctx.db.company.findFirst({
        where: {
          id: input.companyId,
          members: {
            some: {
              userId: ctx.session.user.id,
              role: { in: ["ADMIN", "OWNER"] },
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!company) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No valid company you can post to.",
        });
      }

      const post = await ctx.db.companyPost.create({
        include: {
          author: { select: authorSelect },
          ...acknowledgmentRelations(input.companyId),
        },
        data: {
          title: input.title,
          content: input.content,
          companyId: input.companyId,
          authorId: ctx.session.user.id,
        },
      });

      return {
        post: withAcknowledgmentSummary(post, false),
        success: true,
      };
    }),
  setPostAcknowledgment: protectedProcedure
    .input(postIdentitySchema.extend({ acknowledged: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const post = await tx.companyPost.findFirst({
          where: {
            id: input.postId,
            companyId: input.companyId,
            company: { members: { some: { userId: ctx.session.user.id } } },
          },
          select: { id: true },
        });
        if (!post) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Post not found or you do not have access.",
          });
        }

        const identity = { postId: post.id, userId: ctx.session.user.id };
        if (input.acknowledged) {
          await tx.companyPostAcknowledgment.upsert({
            where: { postId_userId: identity },
            create: identity,
            update: {},
          });
        } else {
          await tx.companyPostAcknowledgment.deleteMany({ where: identity });
        }
        const summary = await tx.companyPost.findUniqueOrThrow({
          where: { id: post.id },
          select: acknowledgmentRelations(input.companyId),
        });
        return withAcknowledgmentSummary(summary, input.acknowledged);
      });
    }),

  getPostAcknowledgments: protectedProcedure
    .input(postIdentitySchema)
    .query(async ({ ctx, input }) => {
      const post = await ctx.db.companyPost.findFirst({
        where: {
          id: input.postId,
          companyId: input.companyId,
          company: {
            members: {
              some: {
                userId: ctx.session.user.id,
                role: { in: ["OWNER", "ADMIN"] },
              },
            },
          },
        },
        select: { id: true },
      });
      if (!post) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Post not found or you do not have permission to view acknowledgments.",
        });
      }
      const members = await ctx.db.companyMember.findMany({
        where: { companyId: input.companyId },
        orderBy: { user: { name: "asc" } },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              email: true,
              postAcknowledgments: {
                where: { postId: post.id },
                select: { createdAt: true },
              },
            },
          },
        },
      });
      return members.map(({ user }) => ({
        id: user.id,
        name: user.name,
        image: user.image,
        email: user.email,
        acknowledgedAt: user.postAcknowledgments[0]?.createdAt ?? null,
      }));
    }),

  deleteCompanyPost: protectedProcedure
    .input(
      z.object({
        postId: z.string().cuid(),
        companyId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const posts = await ctx.db.companyPost.deleteMany({
        where: {
          id: input.postId,
          companyId: input.companyId,
          company: {
            members: {
              some: {
                userId: ctx.session.user.id,
                role: { in: ["ADMIN", "OWNER"] },
              },
            },
          },
        },
      });

      if (posts.count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Message to delete does not exist, or you do not have access.",
        });
      }

      return {
        success: true,
      };
    }),
});
