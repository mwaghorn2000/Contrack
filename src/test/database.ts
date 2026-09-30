import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "../../generated/prisma";

export async function startTestDatabase() {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("contrack_test")
    .start();

  const url = container.getConnectionUri();
  let db: PrismaClient | undefined;

  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
      timeout: 60_000,
    });

    db = new PrismaClient({
      datasources: { db: { url } },
    });
    await db.$connect();

    return { db, container };
  } catch (error) {
    // Clean up even if migration or connection setup fails.
    try {
      await db?.$disconnect();
    } finally {
      await container.stop();
    }
    throw error;
  }
}

// Only pass the Prisma client returned by startTestDatabase here.
export async function clearTestDatabase(db: PrismaClient) {
  await db.companyInvitation.deleteMany();
  await db.message.deleteMany();
  await db.channelMember.deleteMany();
  await db.channel.deleteMany();
  await db.companyPost.deleteMany();
  await db.job.deleteMany();
  await db.companyMember.deleteMany();
  await db.company.deleteMany();
  await db.emailVerificationCode.deleteMany();
  await db.account.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.verificationToken.deleteMany();
}
