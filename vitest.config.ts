import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/saas/**", "tests/saas-integration/**", "tests/cloudflare/**"],
    fileParallelism: true,
    testTimeout: 15_000
  }
});
