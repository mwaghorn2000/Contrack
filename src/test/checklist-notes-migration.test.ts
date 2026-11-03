import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { PrismaClient } from "../../generated/prisma";

let container: StartedPostgreSqlContainer | undefined;
let db: PrismaClient;
const migration = "20261103000000_clear_checklist_notes";

/** The SQL of the migrations before (or from) `migration`, in order. */
function migrationsSql(before: boolean) {
  return readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < migration === before)
    .map((entry) => entry.name)
    .sort()
    .map((name) =>
      readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"),
    )
    .join("\n");
}

// Runs the migrations before this one, adds answers with notes on a
// Checklist and another tile, then runs the rest. The other tile is a Text
// tile, as a later migration deletes measurements.
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("checklist_notes_migration_test")
    .start();
  const url = container.getConnectionUri();
  const fixtures = `
    INSERT INTO "User" ("id", "name") VALUES ('user', 'User');
    INSERT INTO "Company" ("id", "name", "updatedAt") VALUES ('company', 'Company', CURRENT_TIMESTAMP);
    INSERT INTO "Job" ("id", "title", "companyId", "createdById", "updatedAt")
      VALUES ('job', 'Roof', 'company', 'user', CURRENT_TIMESTAMP);
    INSERT INTO "JobTile" ("id", "jobId", "type", "position", "config", "visibility")
      VALUES ('checklist', 'job', 'checklist', 0, '{}', '{}'),
             ('text', 'job', 'text', 1, '{}', '{}');
    INSERT INTO "JobTileAnswer" ("id", "tileId", "authorId", "data", "note", "updatedAt")
      VALUES ('tick', 'checklist', 'user', '{}', 'Done', CURRENT_TIMESTAMP),
             ('gap', 'text', 'user', '{}', 'North wall', CURRENT_TIMESTAMP);
  `;
  execFileSync(
    "pnpm",
    ["exec", "prisma", "db", "execute", "--url", url, "--stdin"],
    {
      input: `${migrationsSql(true)}\n${fixtures}\n${migrationsSql(false)}`,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    },
  );
  db = new PrismaClient({ datasources: { db: { url } } });
  await db.$connect();
}, 120_000);

afterAll(async () => {
  try {
    await db?.$disconnect();
  } finally {
    await container?.stop();
  }
}, 60_000);

it("clears notes on checklist ticks and keeps other tiles' notes", async () => {
  const notes = await db.jobTileAnswer.findMany({
    select: { id: true, note: true },
    orderBy: { id: "asc" },
  });
  expect(notes).toEqual([
    { id: "gap", note: "North wall" },
    { id: "tick", note: null },
  ]);
});
