import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { R2ArtifactStorage } from "../../apps/api/src/r2.js";
import { createWorkerApp, type Env } from "../../apps/api/src/worker.js";

describe("opaque R2 media URLs", () => {
  it("rejects tampering and expiry without exposing an R2 credential", async () => {
    const storage = new R2ArtifactStorage(env.MEDIA, env.DB, "https://media.test", "signing-secret",
      () => 1_000);
    const url = await storage.signRead("orgs/a/private.mp4", 10);
    const token = new URL(url).pathname.split("/").at(-1)!;
    expect(url).not.toContain("cloudflarestorage.com");
    expect(await storage.verify(token, "read")).toMatchObject({ objectKey: "orgs/a/private.mp4" });
    expect(await storage.verify(`${token.slice(0, -1)}x`, "read")).toBeNull();
    const expired = new R2ArtifactStorage(env.MEDIA, env.DB, "https://media.test", "signing-secret",
      () => 12_000);
    expect(await expired.verify(token, "read")).toBeNull();
  });

  it("streams authenticated byte ranges through the Worker binding", async () => {
    const bytes = new TextEncoder().encode("0123456789");
    await env.MEDIA.put("orgs/a/range.mp4", bytes, { httpMetadata: { contentType: "video/mp4" } });
    const bindings = { ...env, PUBLIC_BASE_URL: "https://media.test",
      MEDIA_TOKEN_SIGNING_SECRET: "range-secret", INTERNAL_WORKER_TOKEN: "internal-secret",
      CLERK_ISSUER: "https://clerk.invalid", CLERK_AUDIENCE: "siftcut-api",
      CLERK_AUTHORIZED_PARTIES: "https://media.test", CLERK_WEBHOOK_SIGNING_SECRET: "secret",
      ASSETS: { fetch: () => Promise.resolve(new Response("asset")) } } as unknown as Env;
    const storage = new R2ArtifactStorage(env.MEDIA, env.DB, bindings.PUBLIC_BASE_URL,
      bindings.MEDIA_TOKEN_SIGNING_SECRET);
    const url = await storage.signRead("orgs/a/range.mp4", 60);
    const response = await createWorkerApp().request(url, { headers: { range: "bytes=2-5" } }, bindings);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });
});
