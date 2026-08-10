import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const railwayRoot = new URL("../../infra/railway/", import.meta.url);
const manifestUrl = new URL("../../siftcut-staging.envbank.yaml", import.meta.url);

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

  it("keeps the EnvBank bundle identity and four-service order stable", async () => {
    const manifest = await readFile(manifestUrl, "utf8");
    expect(manifest).toContain("version: 1\nbundle: short-editor/siftcut-staging/staging");
    expect(manifest).toContain("  railway:\n    project: siftcut-staging\n    environment: staging");
    expect(manifest).not.toMatch(/^\s*(?:project_id|environment_id|id):/m);
    expect(manifest).toContain("      postgres:\n        order: 1");
    expect(manifest).toContain("      migrator:\n        order: 2");
    expect(manifest).toContain("      api:\n        order: 3");
    expect(manifest).toContain("      web:\n        order: 4");
  });

  it("keeps the exact generated, derived, and trusted-import record set", async () => {
    const manifest = await readFile(manifestUrl, "utf8");
    const records = manifest.slice(manifest.indexOf("records:\n") + "records:\n".length,
      manifest.indexOf("\ntargets:\n"));
    expect([...records.matchAll(/^  ([A-Z][A-Z0-9_]+):$/gm)].map((match) => match[1]).sort()).toEqual([
      "API_PASSWORD",
      "CLERK_AUTHORIZED_PARTIES",
      "CLERK_ISSUER",
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "DATABASE_URL",
      "MIGRATOR_DATABASE_URL",
      "MIGRATOR_PASSWORD",
      "POSTGRES_PASSWORD",
      "VITE_CLERK_PUBLISHABLE_KEY",
    ]);
    expect(manifest.match(/source: generate/g)).toHaveLength(3);
    expect(manifest.match(/source: derive/g)).toHaveLength(2);
    expect(manifest.match(/^    source: import$/gm)).toHaveLength(5);
    for (const name of [
      "CLERK_ISSUER",
      "CLERK_AUTHORIZED_PARTIES",
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "VITE_CLERK_PUBLISHABLE_KEY",
    ]) {
      expect(manifest).toContain(`${name}: {source: record, record: ${name}}`);
    }
  });

  it("keeps authoritative constants, derived URLs, and proxy-only browser routing", async () => {
    const manifest = await readFile(manifestUrl, "utf8");
    for (const contract of [
      "length: 32",
      "POSTGRES_DB: {source: constant, value: siftcut}",
      "POSTGRES_USER: {source: constant, value: postgres}",
      "NODE_ENV: {source: constant, value: production}",
      "PORT: {source: constant, value: \"3000\"}",
      "CLERK_AUDIENCE: {source: constant, value: siftcut-api}",
      "template: postgresql://siftcut_migrator:${secret:MIGRATOR_PASSWORD}@postgres.railway.internal:5432/siftcut",
      "template: postgresql://siftcut_api:${secret:API_PASSWORD}@postgres.railway.internal:5432/siftcut",
      "API_UPSTREAM: {source: constant, value: \"http://api.railway.internal:3000\"}",
    ]) {
      expect(manifest).toContain(contract);
    }
    expect(manifest.match(/VITE_API_URL/g)).toHaveLength(1);
    expect(manifest).toContain("        absent:\n          - VITE_API_URL");
  });
});

async function read(path: string): Promise<string> {
  return readFile(new URL(path, railwayRoot), "utf8");
}
