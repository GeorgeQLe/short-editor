import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("Cloudflare staging assets", () => {
  it("pins Cloudflare 5.22 and contains no AWS resources", async () => {
    const terraform = await Promise.all([
      read("infra/terraform/versions.tf"), read("infra/terraform/main.tf"),
      read("infra/terraform/variables.tf"), read("infra/terraform/outputs.tf")
    ]).then((files) => files.join("\n"));
    expect(terraform).toContain('version = "~> 5.22.0"');
    expect(terraform).toContain('backend "s3"');
    expect(terraform).toContain("use_lockfile");
    expect(terraform).not.toMatch(/resource\s+"aws_/);
  });

  it("creates D1, private Standard R2, and three queue/DLQ pairs", async () => {
    const terraform = await read("infra/terraform/main.tf");
    expect(terraform).toContain('resource "cloudflare_d1_database"');
    expect(terraform).toContain('resource "cloudflare_r2_bucket"');
    expect(terraform).toContain('location      = "enam"');
    expect(terraform).toContain('storage_class = "Standard"');
    expect(terraform).toContain('resource "cloudflare_queue_consumer"');
    expect(terraform).toContain('type              = "http_pull"');
    expect(terraform).toContain("message_retention_period = 1209600");
    expect(terraform).toMatch(/batch_size\s*= 1/);
    expect(terraform).toMatch(/max_retries\s*= 5/);
  });

  it("keeps application versions and static assets under Wrangler", async () => {
    const config = await read("apps/api/wrangler.jsonc");
    expect(config).toContain('"main": "src/worker.ts"');
    expect(config).toContain('"directory": "../web/dist"');
    expect(config).toContain('"not_found_handling": "single-page-application"');
    expect(config).toContain('"binding": "DB"');
    expect(config).toContain('"binding": "MEDIA"');
    expect(config).not.toContain("AWS_");
  });

  it("places only secret values in the Cloudflare EnvBank target", async () => {
    const manifest = await read("siftcut-staging.envbank.yaml");
    expect(manifest).toContain("  cloudflare:\n    project: siftcut-staging\n    environment: staging");
    expect(manifest).not.toContain("DATABASE_URL");
    expect(manifest).not.toContain("VITE_CLERK_PUBLISHABLE_KEY");
    for (const name of ["CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET",
      "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SIGNING_SECRET", "MEDIA_TOKEN_SIGNING_SECRET",
      "INTERNAL_WORKER_TOKEN"]) expect(manifest).toContain(`${name}:`);
  });

  it("retains the Railway deployment only as a rollback path before acceptance", async () => {
    expect(await read("infra/railway/README.md")).toContain("Railway");
    const manifest = await read("siftcut-staging.envbank.yaml");
    expect(manifest).not.toContain("  railway:");
  });

  it("keeps active commercial docs Cloudflare-first and status-accurate", async () => {
    const docs = `${await read("docs/saas/SPEC.md")}\n${await read("docs/saas/ROADMAP.md")}`;
    for (const value of ["SiftCut Desktop", "SiftCut Cloud", "SiftCut Mobile", "Cloudflare Worker",
      "D1", "R2", "Queues", "Wrangler", "Terraform", "EnvBank", "bounded managed AI"])
      expect(docs).toContain(value);
    expect(docs).toContain("temporary rollback path");
    expect(docs).not.toMatch(/target.*AWS|AWS.*target|active Railway deployment/i);
    expect(docs).toMatch(/not yet accepted|not passed/);
  });

  it("configures the public Turnstile key and secret without reintroducing Vercel", async () => {
    expect(await read("apps/api/wrangler.jsonc")).toContain("TURNSTILE_SITE_KEY");
    const terraform = `${await read("infra/terraform/main.tf")}\n${await read("infra/terraform/outputs.tf")}`;
    expect(terraform).toContain("cloudflare_turnstile_widget");
    expect(terraform).toContain("turnstile_site_key");
    expect(await read("siftcut-staging.envbank.yaml")).toContain("TURNSTILE_SECRET_KEY");
    await expect(read("vercel.json")).rejects.toThrow();
  });
});
