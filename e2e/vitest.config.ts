import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/tests/**/*.e2e.test.ts"],
    testTimeout: 30_000,
    pool: "forks",
    coverage: {
      enabled: false,
    },
  },
});
