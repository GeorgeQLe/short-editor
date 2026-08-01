import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    pool: "threads",
    fileParallelism: true,
    testTimeout: 15_000
  }
});
