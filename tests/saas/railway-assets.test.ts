import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../../infra/railway/", import.meta.url);

describe("Railway staging assets", () => {
  it("pins PostgreSQL 17.5 and separates first-boot credentials", async () => {
    const dockerfile = await read("postgres/Dockerfile");
    const init = await read("postgres/10-siftcut-roles.sh");
    expect(dockerfile).toContain("FROM postgres:17.5-alpine");
    expect(init).toContain("MIGRATOR_PASSWORD");
    expect(init).toContain("API_PASSWORD");
    expect(init).toContain("siftcut_migrator");
    expect(init).toContain("siftcut_api");
    expect(init).toContain("NOBYPASSRLS");
  });

  it("keeps migration and API database capabilities separate", async () => {
    const migrator = await read("migrator/bootstrap.sh");
    const api = await read("api/Dockerfile");
    expect(migrator).toContain("MIGRATOR_DATABASE_URL");
    expect(migrator).toContain("ALTER DEFAULT PRIVILEGES");
    expect(api).toContain("ENV PORT=3000");
    expect(api).not.toContain("MIGRATOR_DATABASE_URL");
  });

  it("routes only through the public web gateway with SPA fallback", async () => {
    const caddy = await read("web/Caddyfile");
    for (const path of ["/v1/*", "/webhooks/clerk", "/health", "/ready"]) {
      expect(caddy).toContain(`handle ${path}`);
    }
    expect(caddy).toContain("reverse_proxy {$API_UPSTREAM}");
    expect(caddy).toContain("handle /_health");
    expect(caddy).toContain("try_files {path} /index.html");
  });
});

async function read(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}
