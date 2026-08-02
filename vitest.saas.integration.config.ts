import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/saas-integration/**/*.test.ts"],
    fileParallelism: false,
    passWithNoTests: true,
    testTimeout: 30_000
  }
});
