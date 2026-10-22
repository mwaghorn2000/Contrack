import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig keeps JSX for Next.js to compile; tests compile it themselves.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          include: ["src/**/*.test.ts"],
          environment: "node",
          // Avoid the artificial tRPC development delay during integration tests.
          env: { NODE_ENV: "production" },
        },
      },
      {
        // Components run in a browser-like DOM with React's development
        // build, which Testing Library's act() and Strict Mode need.
        extends: true,
        test: {
          name: "ui",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["src/test/ui-setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/server/api/routers/{company,auth,job,invitation,profile,security}.ts",
        "src/server/auth/{two-factor,security-token}.ts",
      ],
      reporter: ["text", "html"],
    },
  },
});
