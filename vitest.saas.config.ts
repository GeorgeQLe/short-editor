import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/saas/**/*.test.ts"],
    fileParallelism: true,
    testTimeout: 15_000
  }
});
