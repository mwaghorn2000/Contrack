import { Prisma, type PrismaClient } from "../../generated/prisma";
import { TRPCError } from "@trpc/server";

export async function serializableTransaction<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      )
        throw error;
      if (attempt === 3)
        throw new TRPCError({
          code: "CONFLICT",
          message: "The data changed during this request. Please try again.",
        });
      await new Promise((resolve) => setTimeout(resolve, 30 * attempt));
    }
  }
}
