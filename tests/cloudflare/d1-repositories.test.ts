import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../../apps/api/migrations-d1/0001_cloudflare_foundation.sql?raw";
import {
  D1ProjectRepository,
  D1TransactionalOutbox,
  type ProjectRepository
} from "../../packages/infrastructure/src/index.js";
import type { AuthenticatedContext, JobEnvelope, Project } from "../../packages/saas-contracts/src/index.js";

const A: AuthenticatedContext = { userId: "10000000-0000-4000-8000-000000000001", organizationId: "10000000-0000-4000-8000-000000000002", role: "owner", sessionId: "a" };
const B: AuthenticatedContext = { userId: "20000000-0000-4000-8000-000000000001", organizationId: "20000000-0000-4000-8000-000000000002", role: "owner", sessionId: "b" };

beforeAll(async () => {
  await env.DB.exec(migration.replace(/\n/g, " "));
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM organizations"),
    env.DB.prepare("DELETE FROM users")
  ]);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,clerk_user_id,created_at,updated_at) VALUES (?,?,?,?)").bind(A.userId, "ua", now, now),
    env.DB.prepare("INSERT INTO users(id,clerk_user_id,created_at,updated_at) VALUES (?,?,?,?)").bind(B.userId, "ub", now, now),
    env.DB.prepare("INSERT INTO organizations(id,clerk_organization_id,name,state,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind(A.organizationId, "oa", "A", now, now),
    env.DB.prepare("INSERT INTO organizations(id,clerk_organization_id,name,state,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind(B.organizationId, "ob", "B", now, now)
  ]);
});

describe("D1 tenant repositories", () => {
  it("requires organization scope for every project read and mutation", async () => {
    const repository: ProjectRepository = new D1ProjectRepository(env.DB);
    const created = await repository.create(A, project("30000000-0000-4000-8000-000000000001", "A"));
    expect(await repository.get(A, created.id)).toMatchObject({ id: created.id });
    expect(await repository.get(B, created.id)).toBeNull();
    await expect(repository.update(B, created.id, 1, { name: "stolen", updatedAt: created.updatedAt }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allows one optimistic revision winner", async () => {
    const repository = new D1ProjectRepository(env.DB);
    const created = await repository.create(A, project("30000000-0000-4000-8000-000000000002", "Race"));
    const results = await Promise.allSettled([
      repository.update(A, created.id, 1, { name: "one", updatedAt: new Date().toISOString() }),
      repository.update(A, created.id, 1, { name: "two", updatedAt: new Date().toISOString() })
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("leases outbox records with compare-and-set claim tokens", async () => {
    const projects = new D1ProjectRepository(env.DB);
    const projectId = "30000000-0000-4000-8000-000000000003";
    await projects.create(A, project(projectId, "Outbox"));
    const outbox = new D1TransactionalOutbox(env.DB, () => new Date("2026-08-15T00:00:00.000Z"));
    const job: JobEnvelope = { schemaVersion: 1, jobId: "40000000-0000-4000-8000-000000000001", organizationId: A.organizationId,
      projectId, kind: "ingest", inputHash: "a".repeat(64), payload: {},
      requestedAt: "2026-08-15T00:00:00.000Z" };
    await outbox.append(job);
    const [lease] = await outbox.claim(1);
    expect(lease?.envelope).toEqual(job);
    expect(await outbox.markDelivered(job.jobId, "stale")).toBe(false);
    expect(await outbox.markDelivered(job.jobId, lease!.claimToken)).toBe(true);
    expect(await outbox.claim(1)).toEqual([]);
  });
});

function project(id: string, name: string): Project {
  const now = new Date().toISOString();
  return { id, name, kind: "episode_to_shorts", origin: "siftcut_web", revision: 1,
    state: "active", createdAt: now, updatedAt: now };
}
