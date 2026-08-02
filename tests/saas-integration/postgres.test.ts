import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresEntitlementRepository,
  PostgresEventRepository,
  PostgresJobControl,
  PostgresProjectRepository,
  PostgresTransactionalOutbox,
  PostgresUploadRepository,
  PostgresUsageRepository,
  RepositoryError,
  withTenantTransaction
} from "../../packages/infrastructure/src/postgres.js";
import type { AuthenticatedContext, JobEnvelope, Project } from "../../packages/saas-contracts/src/index.js";
import { loadMigrations, migrationReadiness, runMigrations } from "../../apps/api/src/migrations.js";
import { ClerkIdentityRepository } from "../../apps/api/src/clerk.js";

const MIGRATOR_URL = process.env.TEST_MIGRATOR_DATABASE_URL
  ?? "postgres://siftcut_migrator:local-migrator@127.0.0.1:54329/siftcut_test";
const API_URL = process.env.TEST_DATABASE_URL
  ?? "postgres://siftcut_api:local-api@127.0.0.1:54329/siftcut_test";
const PUBLISHER_URL = process.env.TEST_PUBLISHER_DATABASE_URL
  ?? "postgres://siftcut_publisher:local-publisher@127.0.0.1:54329/siftcut_test";

const migrator = new Pool({ connectionString: MIGRATOR_URL, max: 5 });
const api = new Pool({ connectionString: API_URL, max: 10 });
const publisher = new Pool({ connectionString: PUBLISHER_URL, max: 5 });
const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "20000000-0000-4000-8000-000000000001";
const ORG_A = "10000000-0000-4000-8000-000000000002";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const A: AuthenticatedContext = { userId: USER_A, organizationId: ORG_A, role: "owner", sessionId: "a" };
const B: AuthenticatedContext = { userId: USER_B, organizationId: ORG_B, role: "owner", sessionId: "b" };

beforeAll(async () => {
  await runMigrations(migrator);
  await migrator.query("TRUNCATE organizations, users, webhook_events CASCADE");
  await migrator.query(`INSERT INTO users (id, clerk_user_id) VALUES
    ($1, 'user_a'), ($2, 'user_b')`, [USER_A, USER_B]);
  await migrator.query(`INSERT INTO organizations (id, clerk_organization_id, name, state) VALUES
    ($1, 'org_a', 'A', 'active'), ($2, 'org_b', 'B', 'active')`, [ORG_A, ORG_B]);
  for (const context of [A, B]) {
    await withTenantTransaction(migrator, context.organizationId, async (client) => {
      await client.query(`INSERT INTO subscriptions
        (organization_id, state, member_limit, source_minute_limit, storage_byte_limit)
        VALUES ($1, 'active', 5, 120, 107374182400)`, [context.organizationId]);
      await client.query(`INSERT INTO usage_periods (organization_id, starts_at, ends_at)
        VALUES ($1, now() - interval '1 day', now() + interval '30 days')`, [context.organizationId]);
    });
  }
});

afterAll(async () => {
  await Promise.all([migrator.end(), api.end(), publisher.end()]);
});

describe("PostgreSQL migrations", () => {
  it("are checksum-tracked, idempotent, lock-safe, and ready", async () => {
    await Promise.all([runMigrations(migrator), runMigrations(migrator)]);
    await expect(migrationReadiness(api)).resolves.toEqual({ ready: true });
    const known = await loadMigrations();
    await expect(runMigrations(migrator, [
      ...known,
      { version: "9998_injected_failure", checksum: "failure", sql:
        "CREATE TABLE rollback_probe (id integer); SELECT missing_function();" }
    ])).rejects.toThrow();
    const probe = await migrator.query("SELECT to_regclass('rollback_probe') AS relation");
    expect(probe.rows[0].relation).toBeNull();
    await expect(runMigrations(migrator, [
      { ...known[0]!, checksum: "modified" }, ...known.slice(1)
    ])).rejects.toThrow("checksum mismatch");
  });
});

describe("PostgreSQL tenant repositories", () => {
  const projects = new PostgresProjectRepository(api);
  let projectA: Project;
  let projectB: Project;

  it("forces tenant isolation for project reads and writes", async () => {
    const timestamp = new Date().toISOString();
    projectA = await projects.create(A, project("30000000-0000-4000-8000-000000000001", "A", timestamp));
    projectB = await projects.create(B, project("30000000-0000-4000-8000-000000000002", "B", timestamp));
    await expect(projects.get(A, projectB.id)).resolves.toBeNull();
    await expect(projects.update(A, projectB.id, 1, { name: "stolen", updatedAt: timestamp }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(projects.list(A)).resolves.toEqual([expect.objectContaining({ id: projectA.id })]);
  });

  it("allows exactly one optimistic update winner", async () => {
    const results = await Promise.allSettled([
      projects.update(A, projectA.id, 1, { name: "winner one", updatedAt: new Date().toISOString() }),
      projects.update(A, projectA.id, 1, { name: "winner two", updatedAt: new Date().toISOString() })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(RepositoryError);
    expect(rejected.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    projectA = (await projects.get(A, projectA.id))!;
  });

  it("isolates usage and entitlements", async () => {
    const usage = new PostgresUsageRepository(api);
    const entitlements = new PostgresEntitlementRepository(api);
    await usage.reserveUpload(A, "40000000-0000-4000-8000-000000000001", 1234);
    expect((await usage.get(A)).storageBytesReserved).toBe(1234);
    expect((await usage.get(B)).storageBytesReserved).toBe(0);
    await usage.releaseUpload(B, "40000000-0000-4000-8000-000000000001");
    expect((await usage.get(A)).storageBytesReserved).toBe(1234);
    await expect(entitlements.get(A)).resolves.toMatchObject({ canCreateWork: true });
  });

  it("atomically completes an upload, creates its job/outbox, and rolls failures back", async () => {
    const uploads = new PostgresUploadRepository(api);
    const uploadId = "40000000-0000-4000-8000-000000000002";
    const createdAt = new Date().toISOString();
    await uploads.create(A, {
      id: uploadId, projectId: projectA.id, displayName: "source.mp4",
      objectKey: `orgs/${ORG_A}/source`, multipartUploadId: "multipart-a",
      expectedBytes: 1234, checksumSha256: "a".repeat(64), partSizeBytes: 64 * 1024 ** 2,
      state: "open", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt
    });
    await uploads.transition(A, uploadId, "open", "completing");
    const envelope = job(projectA.id, uploadId);
    await uploads.completeWithOutbox(A, uploadId, envelope, {
      byteLength: 1234, checksumSha256: "a".repeat(64)
    });
    expect((await uploads.get(A, uploadId))?.state).toBe("complete");
    await expect(uploads.get(B, uploadId)).resolves.toBeNull();
    const jobs = new PostgresJobControl(api);
    await expect(jobs.claim({ ...envelope, organizationId: ORG_B })).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    await expect(jobs.claim(envelope)).resolves.toBe("claimed");
    await expect(jobs.claim(envelope)).resolves.toBe("already_running");
    await jobs.succeed(uploadId, { durable: true });
    await expect(jobs.claim(envelope)).resolves.toBe("already_complete");

    const failingId = "40000000-0000-4000-8000-000000000003";
    await uploads.create(A, {
      id: failingId, projectId: projectA.id, displayName: "failed.mp4",
      objectKey: `orgs/${ORG_A}/failed`, multipartUploadId: "multipart-b",
      expectedBytes: 1, checksumSha256: "b".repeat(64), partSizeBytes: 64 * 1024 ** 2,
      state: "open", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt
    });
    await uploads.transition(A, failingId, "open", "completing");
    await migrator.query(`CREATE OR REPLACE FUNCTION reject_outbox() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END $$`);
    await migrator.query("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_outbox()");
    await expect(uploads.completeWithOutbox(A, failingId, job(projectA.id, failingId), {
      byteLength: 1, checksumSha256: "b".repeat(64)
    })).rejects.toThrow("injected outbox failure");
    await migrator.query("DROP TRIGGER reject_outbox ON outbox");
    expect((await uploads.get(A, failingId))?.state).toBe("completing");
  });

  it("isolates events and immediately hides revision-checked deletions", async () => {
    const events = new PostgresEventRepository(api, 5);
    await events.append({ type: "project.updated", organizationId: ORG_A,
      projectId: projectA.id, data: {}, createdAt: new Date().toISOString() });
    expect(await events.after(A, 0, 10)).toHaveLength(1);
    expect(await events.after(B, 0, 10)).toHaveLength(0);
    await expect(projects.delete(B, projectA.id, projectA.revision,
      new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString()))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await projects.delete(A, projectA.id, projectA.revision,
      new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    await expect(projects.get(A, projectA.id)).resolves.toBeNull();
  });
});

describe("secure transactional outbox", () => {
  it("leases once, rejects stale tokens, retries, and recovers expired claims", async () => {
    await expect(publisher.query("SELECT * FROM projects")).rejects.toThrow(/permission denied/i);
    const outboxA = new PostgresTransactionalOutbox(publisher);
    const outboxB = new PostgresTransactionalOutbox(publisher);
    const claims = (await Promise.all([outboxA.claim(25), outboxB.claim(25)])).flat();
    expect(new Set(claims.map((claim) => claim.outboxId)).size).toBe(claims.length);
    expect(claims.length).toBeGreaterThan(0);
    const claim = claims[0]!;
    await expect(outboxA.markDelivered(claim.outboxId, randomUUID())).resolves.toBe(false);
    await expect(outboxA.markFailed(claim.outboxId, claim.claimToken, new Date())).resolves.toBe(true);
    await migrator.query("UPDATE outbox SET available_at = now() - interval '1 second' WHERE id = $1", [
      claim.outboxId
    ]);
    const reclaimed = (await outboxB.claim(25)).find((item) => item.outboxId === claim.outboxId)!;
    expect(reclaimed.attempt).toBe(claim.attempt + 1);
    await expect(outboxA.markDelivered(claim.outboxId, claim.claimToken)).resolves.toBe(false);
    await expect(outboxB.markDelivered(reclaimed.outboxId, reclaimed.claimToken)).resolves.toBe(true);

    const expiring: JobEnvelope = {
      schemaVersion: 1,
      jobId: "40000000-0000-4000-8000-000000000004",
      organizationId: ORG_A,
      projectId: "30000000-0000-4000-8000-000000000001",
      kind: "ingest",
      inputHash: "d".repeat(64),
      payload: {},
      requestedAt: new Date().toISOString()
    };
    await new PostgresTransactionalOutbox(api).append(expiring);
    const expiredLease = (await outboxA.claim(25)).find(
      (item) => item.outboxId === expiring.jobId
    )!;
    await migrator.query(
      "UPDATE outbox SET claimed_at = now() - interval '6 minutes' WHERE id = $1",
      [expiring.jobId]
    );
    const recoveredLease = (await outboxB.claim(25)).find(
      (item) => item.outboxId === expiring.jobId
    )!;
    expect(recoveredLease.claimToken).not.toBe(expiredLease.claimToken);
    expect(recoveredLease.attempt).toBe(expiredLease.attempt + 1);
  });
});

describe("Clerk identity convergence", () => {
  it("keeps revocation across out-of-order events, rejects reused IDs, and enforces seats", async () => {
    const identities = new ClerkIdentityRepository(migrator);
    const userId = "clerk_m2_primary";
    await identities.applyWebhook("evt-user-primary", {
      type: "user.created",
      data: { id: userId, created_at: 1_000, email_addresses: [] }
    }, "hash-user-primary");
    const membership = {
      id: "mem_m2_primary",
      role: "org:editor",
      organization: { id: "org_a" },
      public_user_data: { user_id: userId }
    };
    await expect(identities.applyWebhook("evt-membership-delete", {
      type: "organizationMembership.deleted",
      data: { ...membership, updated_at: 3_000 }
    }, "hash-delete")).resolves.toBe("applied");
    await expect(identities.applyWebhook("evt-membership-old-create", {
      type: "organizationMembership.created",
      data: { ...membership, updated_at: 2_000 }
    }, "hash-old-create")).resolves.toBe("stale");
    await expect(identities.resolveSession(userId, "org_a", "editor")).resolves.toBeNull();

    await expect(identities.applyWebhook("evt-membership-update", {
      type: "organizationMembership.updated",
      data: { ...membership, updated_at: 4_000 }
    }, "hash-update")).resolves.toBe("applied");
    await expect(identities.resolveSession(userId, "org_a", "editor")).resolves.toMatchObject({
      organizationId: ORG_A,
      role: "editor"
    });
    await expect(identities.applyWebhook("evt-membership-update", {
      type: "organizationMembership.updated",
      data: { ...membership, updated_at: 4_000 }
    }, "hash-update")).resolves.toBe("duplicate");
    await expect(identities.applyWebhook("evt-membership-update", {
      type: "organizationMembership.updated",
      data: { ...membership, updated_at: 4_000 }
    }, "different-payload")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    for (let index = 2; index <= 5; index += 1) {
      const clerkUserId = `clerk_m2_${index}`;
      await identities.applyWebhook(`evt-user-${index}`, {
        type: "user.created",
        data: { id: clerkUserId, created_at: 1_000 + index, email_addresses: [] }
      }, `hash-user-${index}`);
      await identities.applyWebhook(`evt-membership-${index}`, {
        type: "organizationMembership.created",
        data: {
          id: `mem_m2_${index}`,
          role: "org:viewer",
          organization: { id: "org_a" },
          public_user_data: { user_id: clerkUserId },
          updated_at: 5_000 + index
        }
      }, `hash-membership-${index}`);
    }
    await expect(identities.applyWebhook("evt-invitation-six", {
      type: "organizationInvitation.created",
      data: {
        id: "inv_m2_6",
        organization_id: "org_a",
        email_address: "six@example.test",
        role: "org:viewer",
        status: "pending",
        created_at: 5_500
      }
    }, "hash-invitation-six")).rejects.toMatchObject({ code: "SEAT_LIMIT" });
    await identities.applyWebhook("evt-user-six", {
      type: "user.created",
      data: { id: "clerk_m2_6", created_at: 1_006, email_addresses: [] }
    }, "hash-user-six");
    await expect(identities.applyWebhook("evt-membership-six", {
      type: "organizationMembership.created",
      data: {
        id: "mem_m2_6",
        role: "org:viewer",
        organization: { id: "org_a" },
        public_user_data: { user_id: "clerk_m2_6" },
        updated_at: 6_000
      }
    }, "hash-membership-six")).rejects.toMatchObject({ code: "SEAT_LIMIT" });

    await expect(identities.applyWebhook("evt-user-primary-delete", {
      type: "user.deleted",
      data: { id: userId, updated_at: 7_000 }
    }, "hash-user-primary-delete")).resolves.toBe("applied");
    await expect(identities.resolveSession(userId, "org_a", "editor")).resolves.toBeNull();
  });
});

function project(id: string, name: string, timestamp: string): Project {
  return {
    id, name, kind: "episode_to_shorts", origin: "siftcut_web",
    revision: 1, state: "active", createdAt: timestamp, updatedAt: timestamp
  };
}
function job(projectId: string, uploadId: string): JobEnvelope {
  return {
    schemaVersion: 1, jobId: uploadId, organizationId: ORG_A, projectId, kind: "ingest",
    inputHash: uploadId.replace(/-/g, "").padEnd(64, "0"),
    payload: { uploadId }, requestedAt: new Date().toISOString()
  };
}
