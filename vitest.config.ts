import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Avoid the artificial tRPC development delay during integration tests.
    env: { NODE_ENV: "production" },
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
