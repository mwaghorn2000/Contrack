import type { Session } from "next-auth";
import type { PrismaClient } from "../../generated/prisma";
import type { createTRPCContext } from "~/server/api/trpc";
import { vi } from "vitest";

export const USER_ID = "cltestuser0000000000000001";

function delegate(model: string) {
  const method = (name: string) =>
    vi.fn<(...args: unknown[]) => Promise<unknown>>(() => {
      throw new Error(`Unconfigured database mock: ${model}.${name}`);
    });
  return {
    findUnique: method("findUnique"),
    findFirst: method("findFirst"),
    findMany: method("findMany"),
    create: method("create"),
    update: method("update"),
    updateMany: method("updateMany"),
    delete: method("delete"),
    deleteMany: method("deleteMany"),
    upsert: method("upsert"),
    count: method("count"),
  };
}

function delegates() {
  return {
    user: delegate("user"),
    company: delegate("company"),
    companyMember: delegate("companyMember"),
    companyPost: delegate("companyPost"),
    companyPostAcknowledgment: delegate("companyPostAcknowledgment"),
    job: delegate("job"),
    emailVerificationCode: delegate("emailVerificationCode"),
  };
}

export function createTestContext(options: { session?: Session | null } = {}) {
  const tx = delegates();
  const db = {
    ...delegates(),
    $transaction: vi.fn(
      async (
        operation: (client: typeof tx) => Promise<unknown>,
        _options?: unknown,
      ) => operation(tx),
    ),
  };
  db.user.findUnique.mockResolvedValue({ id: USER_ID });
  const ctx: Awaited<ReturnType<typeof createTRPCContext>> = {
    // The cast is confined to the injection boundary; no PrismaClient is constructed.
    db: db as unknown as PrismaClient,
    session:
      options.session === undefined
        ? {
            user: { id: USER_ID, name: "Test User", email: "test@example.com" },
            expires: "2099-01-01T00:00:00.000Z",
          }
        : options.session,
    headers: new Headers(),
  };
  return { ctx, db, tx };
}
