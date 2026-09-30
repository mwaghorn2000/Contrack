import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Disable tRPC's artificial development latency without changing middleware.
    env: { NODE_ENV: "production" },
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/server/api/routers/*.ts", "src/server/api/trpc.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        "src/server/api/routers/*.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
