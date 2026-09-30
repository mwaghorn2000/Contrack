import { beforeAll, afterAll, it, expect } from "vitest";
import { startTestDatabase } from "./database";

let database: Awaited<ReturnType<typeof startTestDatabase>> | undefined;

beforeAll(async () => {
  database = await startTestDatabase();
}, 120_000);

afterAll(async () => {
  try {
    await database?.db.$disconnect();
  } finally {
    await database?.container.stop();
  }
}, 60_000);

// Router behavior belongs in company.test.ts; this checks the database setup.
it("stores and retrieves a company", async () => {
  if (!database) throw new Error("Test database was not initialized");
  const { db } = database;

  const company = await db.company.create({ data: { name: "Test Company" } });
  const found = await db.company.findUnique({ where: { id: company.id } });

  expect(found?.name).toBe("Test Company");
});
