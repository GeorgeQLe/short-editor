import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "apps/api/wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        r2Buckets: ["MEDIA"],
        queueProducers: ["INGEST_QUEUE", "ANALYSIS_QUEUE", "RENDER_QUEUE"],
        bindings: {
          ENVIRONMENT: "test",
          TURNSTILE_TEST_BYPASS_TOKEN: "test-turnstile-token",
          DEV_AUTH_TOKENS: "{}",
          MEDIA_TOKEN_SIGNING_SECRET: "test-media-secret",
          INTERNAL_WORKER_TOKEN: "test-worker-secret",
          CLERK_WEBHOOK_SIGNING_SECRET: "dGVzdC13ZWJob29rLXNlY3JldA==" // gitleaks:allow — base64("test-webhook-secret")
        }
      }
    })
  ],
  test: {
    include: ["tests/cloudflare/**/*.test.ts"]
  }
});
