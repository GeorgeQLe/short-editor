import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../../apps/api/migrations-d1/0001_cloudflare_foundation.sql?raw";
import betaMigration from "../../apps/api/migrations-d1/0002_beta_access_requests.sql?raw";
import { createWorkerApp, type Env } from "../../apps/api/src/worker.js";

const valid = {
  email: " Creator@Example.COM ", name: " Maya Rivera ", teamName: "Signal Studio",
  teamSize: "2-5", contentType: "podcast", monthlyHours: "10-25",
  notes: "Weekly interview show", consent: true,
  turnstileToken: "test-turnstile-token"
};

beforeAll(async () => {
  await env.DB.exec(migration.replace(/\n/g, " "));
  await env.DB.exec(betaMigration.replace(/\n/g, " "));
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM beta_access_requests").run();
});

function submit(body: unknown, bindings: Env = env as unknown as Env) {
  return createWorkerApp().request("http://local/v1/beta-access-requests", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }, bindings);
}

describe("public beta access requests", () => {
  it("normalizes and stores a strict consented request without a raw IP", async () => {
    const response = await submit(valid);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ apiVersion: "v1", data: { accepted: true } });
    const row = await env.DB.prepare("SELECT * FROM beta_access_requests").first<Record<string, unknown>>();
    expect(row).toMatchObject({ email: "creator@example.com", name: "Maya Rivera",
      status: "pending", source: "landing_page" });
    expect(Object.keys(row ?? {})).not.toContain("ip");
    expect(JSON.stringify(row)).not.toContain(valid.turnstileToken);
  });

  it("returns the same 202 envelope for duplicate normalized email", async () => {
    const first = await submit(valid);
    const duplicate = await submit({ ...valid, email: "creator@example.com", name: "Someone else" });
    expect(first.status).toBe(202); expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual(await first.json());
    const count = await env.DB.prepare("SELECT COUNT(*) count FROM beta_access_requests").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("allows one stored record across concurrent duplicate submissions", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => submit(valid)));
    expect(responses.every((response) => response.status === 202)).toBe(true);
    const count = await env.DB.prepare("SELECT COUNT(*) count FROM beta_access_requests").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it.each([
    [{ ...valid, consent: false }, "consent"],
    [{ ...valid, teamSize: "a lot" }, "teamSize"],
    [{ ...valid, unknown: true }, "body"],
    [{ ...valid, email: "not-an-email" }, "email"]
  ])("rejects invalid strict input", async (body, field) => {
    const response = await submit(body);
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain(field);
    expect(text).not.toContain(String(body.email));
  });

  it("rejects bot verification and fails closed in production", async () => {
    const rejected = await submit({ ...valid, turnstileToken: "wrong" });
    expect(rejected.status).toBe(422);
    expect(await rejected.text()).not.toContain("wrong");
    const production = await submit(valid, { ...(env as unknown as Env), ENVIRONMENT: "production",
      TURNSTILE_SECRET_KEY: undefined, TURNSTILE_TEST_BYPASS_TOKEN: undefined });
    expect(production.status).toBe(422);
    expect(await production.text()).not.toContain(valid.email.trim().toLowerCase());
  });

  it("rejects oversized payloads and exposes no public lead-list route", async () => {
    const oversized = await submit({ ...valid, notes: "x".repeat(20_000) });
    expect(oversized.status).toBe(422);
    const listing = await createWorkerApp().request("http://local/v1/beta-access-requests", {}, env as unknown as Env);
    expect(listing.status).toBe(401);
  });
});
