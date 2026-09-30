import { vi } from "vitest";

// Never import the application database singleton, NextAuth, or email client.
// Any accidental use of the singleton fails instead of opening a connection.
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `Tests must inject a mock database (accessed ${String(property)}).`,
        );
      },
    },
  ),
}));
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/email", () => ({ sendVerificationEmail: vi.fn() }));
vi.mock("argon2", () => ({ hash: vi.fn(), verify: vi.fn(), argon2id: 2 }));
