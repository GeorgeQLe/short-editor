import { describe, expect, it, vi } from "vitest";
import type { JobDispatcher, LeasedOutboxRecord, TransactionalOutbox } from "../../packages/infrastructure/src/index.js";
import type { JobEnvelope } from "../../packages/saas-contracts/src/index.js";
import { loadConfig } from "../../apps/api/src/config.js";
import { createJsonLogger } from "../../apps/api/src/logging.js";
import { migrationReadiness, unwrapMigrationTransaction } from "../../apps/api/src/migrations.js";
import { OutboxPublisher } from "../../apps/api/src/publisher.js";

const JOB: JobEnvelope = {
  schemaVersion: 1,
  jobId: "00000000-0000-4000-8000-000000000011",
  organizationId: "00000000-0000-4000-8000-000000000012",
  projectId: "00000000-0000-4000-8000-000000000013",
  kind: "ingest",
  inputHash: "a".repeat(64), payload: {}, requestedAt: "2026-08-02T00:00:00.000Z"
};

describe("SaaS runtime", () => {
  it("preserves committed migration checksums while nesting legacy transaction wrappers", () => {
    expect(unwrapMigrationTransaction("BEGIN;\nSELECT 1;\nCOMMIT;\n")).toBe("SELECT 1;");
    expect(unwrapMigrationTransaction("SELECT 1;")).toBe("SELECT 1;");
  });

  it.each([
    { rows: [], reason: "schema_stale" },
    { rows: [{ version: "0001", checksum: "changed" }], reason: "schema_modified" },
    { rows: [
      { version: "0001", checksum: "expected" },
      { version: "9999", checksum: "future" }
    ], reason: "schema_ahead" }
  ])("categorizes non-current migration state as $reason", async ({ rows, reason }) => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
        .mockResolvedValueOnce({ rows })
    };
    await expect(migrationReadiness(pool as never, [{
      version: "0001", checksum: "expected", sql: "SELECT 1;"
    }])).resolves.toEqual({ ready: false, reason });
  });

  it("categorizes unavailable migration state without leaking connection errors", async () => {
    const pool = { query: vi.fn(async () => { throw new Error("postgres://secret"); }) };
    await expect(migrationReadiness(pool as never, [])).resolves.toEqual({
      ready: false,
      reason: "database_not_ready"
    });
  });

  it("validates development mappings and refuses them in production", () => {
    const tokens = JSON.stringify({ local: {
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "owner", sessionId: "local"
    } });
    expect(loadConfig({ DATABASE_URL: "postgres://secret", DEV_AUTH_TOKENS: tokens }))
      .toMatchObject({ port: 3000, nodeEnv: "development" });
    expect(() => loadConfig({
      NODE_ENV: "production", DATABASE_URL: "postgres://secret", DEV_AUTH_TOKENS: tokens
    })).toThrow("Development authentication is forbidden in production");
    expect(() => loadConfig({ DATABASE_URL: "secret-value", PORT: "invalid" }))
      .toThrow("Invalid runtime configuration: PORT");
  });

  it("emits JSON and redacts sensitive keys and configured values", () => {
    const lines: string[] = [];
    createJsonLogger((line) => lines.push(line), ["configured-secret"]).error("failed", {
      authorization: "Bearer visible", message: "bad configured-secret", nested: { token: "x" }
    });
    expect(lines[0]).not.toContain("visible");
    expect(lines[0]).not.toContain("configured-secret");
    expect(lines[0]).not.toContain('"token":"x"');
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "error", event: "failed" });
  });

  it("dispatches leased records and protects acknowledgements with their tokens", async () => {
    const lease: LeasedOutboxRecord = {
      outboxId: JOB.jobId, envelope: JOB, attempt: 1, claimToken: "claim-1"
    };
    const outbox: TransactionalOutbox = {
      append: vi.fn(), claim: vi.fn(async () => [lease]),
      markDelivered: vi.fn(async () => true), markFailed: vi.fn(async () => true)
    };
    const dispatcher: JobDispatcher = { enqueue: vi.fn(async () => undefined) };
    const publisher = new OutboxPublisher(outbox, dispatcher);
    await expect(publisher.publishOnce()).resolves.toBe(1);
    expect(outbox.claim).toHaveBeenCalledWith(25);
    expect(outbox.markDelivered).toHaveBeenCalledWith(JOB.jobId, "claim-1");
  });

  it("backs off failed dispatches and releases the matching lease", async () => {
    const outbox: TransactionalOutbox = {
      append: vi.fn(),
      claim: vi.fn(async () => [{
        outboxId: JOB.jobId, envelope: JOB, attempt: 3, claimToken: "claim-3"
      }]),
      markDelivered: vi.fn(async () => true), markFailed: vi.fn(async () => true)
    };
    const publisher = new OutboxPublisher(outbox, {
      enqueue: vi.fn(async () => { throw new Error("down"); })
    }, { now: () => new Date("2026-08-02T00:00:00.000Z") });
    await publisher.publishOnce();
    expect(outbox.markFailed).toHaveBeenCalledWith(
      JOB.jobId, "claim-3", new Date("2026-08-02T00:00:04.000Z")
    );
  });
});
