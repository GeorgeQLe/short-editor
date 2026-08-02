import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  durableEventSchema,
  entitlementSchema,
  jobEnvelopeSchema,
  projectSchema,
  uploadSessionSchema,
  usageSchema,
  type AuthenticatedContext,
  type DurableEvent,
  type JobEnvelope,
  type Project,
  type UploadSession
} from "@siftcut/saas-contracts";
import type {
  ClassifiedJobFailure,
  EntitlementRepository,
  EventRepository,
  JobControl,
  LeasedOutboxRecord,
  ProjectRepository,
  StoredUploadSession,
  TransactionalOutbox,
  UploadRepository,
  UsageRepository
} from "./index.js";

type Queryable = Pick<PoolClient, "query">;

export class RepositoryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_STATE",
    message: string,
    readonly details: unknown = null
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export async function withTenantTransaction<T>(
  pool: Pool,
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  list(context: AuthenticatedContext): Promise<Project[]> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        SELECT id, name, revision, state, created_at, updated_at
        FROM projects WHERE state = 'active' ORDER BY updated_at DESC, id
      `);
      return result.rows.map(projectFromRow);
    });
  }

  get(context: AuthenticatedContext, projectId: string): Promise<Project | null> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        SELECT id, name, revision, state, created_at, updated_at
        FROM projects WHERE id = $1 AND state = 'active'
      `, [projectId]);
      return result.rowCount ? projectFromRow(result.rows[0]) : null;
    });
  }

  create(context: AuthenticatedContext, project: Project): Promise<Project> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        INSERT INTO projects
          (id, organization_id, name, revision, state, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, revision, state, created_at, updated_at
      `, [project.id, context.organizationId, project.name, project.revision, project.state,
        context.userId, project.createdAt, project.updatedAt]);
      return projectFromRow(result.rows[0]);
    });
  }

  update(
    context: AuthenticatedContext,
    projectId: string,
    expectedRevision: number,
    patch: Pick<Project, "name" | "updatedAt">
  ): Promise<Project> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        UPDATE projects SET name = $3, revision = revision + 1, updated_at = $4
        WHERE id = $1 AND revision = $2 AND state = 'active'
        RETURNING id, name, revision, state, created_at, updated_at
      `, [projectId, expectedRevision, patch.name, patch.updatedAt]);
      if (result.rowCount) return projectFromRow(result.rows[0]);
      return throwProjectMutationError(client, projectId, expectedRevision);
    });
  }

  delete(
    context: AuthenticatedContext,
    projectId: string,
    expectedRevision: number,
    deletionRequestedAt: string,
    purgeAfter: string
  ): Promise<Project> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        UPDATE projects
        SET state = 'deleting', revision = revision + 1,
            deletion_requested_at = $3, purge_after = $4, updated_at = $3
        WHERE id = $1 AND revision = $2 AND state = 'active'
        RETURNING id, name, revision, state, created_at, updated_at
      `, [projectId, expectedRevision, deletionRequestedAt, purgeAfter]);
      if (!result.rowCount) await throwProjectMutationError(client, projectId, expectedRevision);
      await client.query(`
        UPDATE jobs SET state = 'cancel_requested', cancel_requested_at = $2, updated_at = $2
        WHERE project_id = $1 AND state IN ('queued', 'running')
      `, [projectId, deletionRequestedAt]);
      return projectFromRow(result.rows[0]);
    });
  }
}

async function throwProjectMutationError(
  client: Queryable, projectId: string, expectedRevision: number
): Promise<never> {
  const found = await client.query("SELECT revision FROM projects WHERE id = $1 AND state = 'active'", [projectId]);
  if (!found.rowCount) throw new RepositoryError("NOT_FOUND", "Project not found");
  throw new RepositoryError("REVISION_CONFLICT", "Project revision is stale", {
    expectedRevision,
    actualRevision: Number(found.rows[0].revision)
  });
}

export class PostgresUploadRepository implements UploadRepository {
  constructor(private readonly pool: Pool) {}

  create(context: AuthenticatedContext, session: StoredUploadSession): Promise<StoredUploadSession> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        INSERT INTO upload_sessions
          (id, organization_id, project_id, display_name, object_key, multipart_upload_id,
           expected_bytes, checksum_sha256, part_size_bytes, state, expires_at, created_by, created_at)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        WHERE EXISTS (SELECT 1 FROM projects WHERE id = $3 AND state = 'active')
        RETURNING *
      `, [session.id, context.organizationId, session.projectId, session.displayName,
        session.objectKey, session.multipartUploadId, session.expectedBytes,
        session.checksumSha256, session.partSizeBytes, session.state, session.expiresAt,
        context.userId, session.createdAt]);
      if (!result.rowCount) throw new RepositoryError("NOT_FOUND", "Project not found");
      return uploadFromRow(result.rows[0]);
    });
  }

  get(context: AuthenticatedContext, uploadId: string): Promise<StoredUploadSession | null> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        SELECT u.* FROM upload_sessions u
        JOIN projects p ON p.id = u.project_id AND p.state = 'active'
        WHERE u.id = $1
      `, [uploadId]);
      return result.rowCount ? uploadFromRow(result.rows[0]) : null;
    });
  }

  transition(
    context: AuthenticatedContext,
    uploadId: string,
    from: UploadSession["state"],
    to: UploadSession["state"]
  ): Promise<StoredUploadSession> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        UPDATE upload_sessions u SET state = $3
        FROM projects p
        WHERE u.id = $1 AND u.state = $2 AND p.id = u.project_id AND p.state = 'active'
        RETURNING u.*
      `, [uploadId, from, to]);
      if (!result.rowCount) throw new RepositoryError("INVALID_STATE", "Invalid upload transition");
      return uploadFromRow(result.rows[0]);
    });
  }

  completeWithOutbox(
    context: AuthenticatedContext,
    uploadId: string,
    job: JobEnvelope,
    actual: { byteLength: number; checksumSha256: string }
  ): Promise<StoredUploadSession> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const completed = await client.query(`
        UPDATE upload_sessions u
        SET state = 'complete', completed_at = $2,
            completed_bytes = $3, completed_checksum_sha256 = $4
        FROM projects p
        WHERE u.id = $1 AND u.state = 'completing'
          AND p.id = u.project_id AND p.state = 'active'
        RETURNING u.*
      `, [uploadId, job.requestedAt, actual.byteLength, actual.checksumSha256]);
      if (!completed.rowCount) throw new RepositoryError("INVALID_STATE", "Invalid upload completion");
      await insertJobAndOutbox(client, context.userId, job);
      return uploadFromRow(completed.rows[0]);
    });
  }
}

export class PostgresUsageRepository implements UsageRepository {
  constructor(private readonly pool: Pool) {}

  get(context: AuthenticatedContext) {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        SELECT starts_at, ends_at, source_minutes_used, source_minutes_reserved,
               storage_bytes_used, storage_bytes_reserved
        FROM usage_periods WHERE starts_at <= now() AND ends_at > now()
        ORDER BY starts_at DESC LIMIT 1
      `);
      if (!result.rowCount) throw new RepositoryError("NOT_FOUND", "Current usage period not found");
      const row = result.rows[0];
      return usageSchema.parse({
        periodStartsAt: instant(row.starts_at), periodEndsAt: instant(row.ends_at),
        sourceMinutesUsed: Number(row.source_minutes_used),
        sourceMinutesReserved: Number(row.source_minutes_reserved),
        storageBytesUsed: Number(row.storage_bytes_used),
        storageBytesReserved: Number(row.storage_bytes_reserved)
      });
    });
  }

  reserveUpload(context: AuthenticatedContext, reservationId: string, bytes: number): Promise<void> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const period = await currentUsagePeriod(client);
      const inserted = await client.query(`
        INSERT INTO usage_ledger_entries
          (organization_id, usage_period_id, idempotency_key, dimension, kind, amount,
           subject_type, subject_id)
        VALUES ($1, $2, $3, 'storage_bytes', 'reserve', $4, 'upload', $5)
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id
      `, [context.organizationId, period, `upload:${reservationId}:reserve`, bytes, reservationId]);
      if (inserted.rowCount) await client.query(`
        UPDATE usage_periods SET storage_bytes_reserved = storage_bytes_reserved + $2 WHERE id = $1
      `, [period, bytes]);
    });
  }

  releaseUpload(context: AuthenticatedContext, reservationId: string): Promise<void> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const period = await currentUsagePeriod(client);
      const reservation = await client.query(`
        SELECT amount FROM usage_ledger_entries
        WHERE subject_id = $1 AND idempotency_key = $2
      `, [reservationId, `upload:${reservationId}:reserve`]);
      if (!reservation.rowCount) return;
      const amount = Number(reservation.rows[0].amount);
      const inserted = await client.query(`
        INSERT INTO usage_ledger_entries
          (organization_id, usage_period_id, idempotency_key, dimension, kind, amount,
           subject_type, subject_id)
        VALUES ($1, $2, $3, 'storage_bytes', 'release', $4, 'upload', $5)
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id
      `, [context.organizationId, period, `upload:${reservationId}:release`, amount, reservationId]);
      if (inserted.rowCount) await client.query(`
        UPDATE usage_periods
        SET storage_bytes_reserved = GREATEST(0, storage_bytes_reserved - $2) WHERE id = $1
      `, [period, amount]);
    });
  }
}

async function currentUsagePeriod(client: Queryable): Promise<string> {
  const result = await client.query(`
    SELECT id FROM usage_periods WHERE starts_at <= now() AND ends_at > now()
    ORDER BY starts_at DESC LIMIT 1 FOR UPDATE
  `);
  if (!result.rowCount) throw new RepositoryError("NOT_FOUND", "Current usage period not found");
  return result.rows[0].id;
}

export class PostgresEntitlementRepository implements EntitlementRepository {
  constructor(private readonly pool: Pool) {}
  get(context: AuthenticatedContext) {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        SELECT member_limit, source_minute_limit, storage_byte_limit, state
        FROM subscriptions WHERE organization_id = $1
      `, [context.organizationId]);
      if (!result.rowCount) throw new RepositoryError("NOT_FOUND", "Entitlement not found");
      const row = result.rows[0];
      return entitlementSchema.parse({
        memberLimit: row.member_limit,
        sourceMinuteLimit: Number(row.source_minute_limit),
        storageByteLimit: Number(row.storage_byte_limit),
        canCreateWork: row.state === "trialing" || row.state === "active"
      });
    });
  }
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool, private readonly pollMs = 1_000) {}

  after(context: AuthenticatedContext, lastEventId: number, limit: number): Promise<DurableEvent[]> {
    return withTenantTransaction(this.pool, context.organizationId, async (client) => {
      const result = await client.query(`
        SELECT id, type, organization_id, project_id, data, created_at
        FROM event_records WHERE id > $1 ORDER BY id LIMIT $2
      `, [lastEventId, Math.max(1, Math.min(limit, 1000))]);
      return result.rows.map(eventFromRow);
    });
  }

  async *stream(context: AuthenticatedContext, afterEventId: number, signal: AbortSignal) {
    let cursor = afterEventId;
    while (!signal.aborted) {
      const events = await this.after(context, cursor, 100);
      for (const event of events) {
        cursor = event.id;
        yield event;
      }
      if (!events.length) await abortableDelay(this.pollMs, signal);
    }
  }

  append(event: Omit<DurableEvent, "id">): Promise<DurableEvent> {
    return withTenantTransaction(this.pool, event.organizationId, async (client) => {
      const result = await client.query(`
        INSERT INTO event_records (organization_id, project_id, type, data, created_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, type, organization_id, project_id, data, created_at
      `, [event.organizationId, event.projectId, event.type, event.data, event.createdAt]);
      return eventFromRow(result.rows[0]);
    });
  }
}

export class PostgresTransactionalOutbox implements TransactionalOutbox {
  constructor(private readonly pool: Pool) {}
  append(job: JobEnvelope): Promise<void> {
    return withTenantTransaction(this.pool, job.organizationId, async (client) => {
      await client.query(`
        INSERT INTO outbox (id, organization_id, project_id, queue, payload)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING
      `, [job.jobId, job.organizationId, job.projectId, queueFor(job.kind), job]);
    });
  }
  async claim(limit: number): Promise<LeasedOutboxRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM publisher_claim_outbox($1)", [Math.max(1, Math.min(limit, 100))]
    );
    return result.rows.map((row) => ({
      outboxId: row.outbox_id,
      envelope: jobEnvelopeSchema.parse(row.payload),
      attempt: Number(row.attempt),
      claimToken: row.claim_token
    }));
  }
  async markDelivered(outboxId: string, claimToken: string): Promise<boolean> {
    const result = await this.pool.query("SELECT publisher_mark_delivered($1, $2) AS applied", [
      outboxId, claimToken
    ]);
    return result.rows[0]?.applied === true;
  }
  async markFailed(outboxId: string, claimToken: string, retryAt: Date): Promise<boolean> {
    const result = await this.pool.query("SELECT publisher_mark_failed($1, $2, $3) AS applied", [
      outboxId, claimToken, retryAt
    ]);
    return result.rows[0]?.applied === true;
  }
}

export class PostgresJobControl implements JobControl {
  private readonly organizations = new Map<string, string>();
  constructor(private readonly pool: Pool) {}

  claim(job: JobEnvelope) {
    this.organizations.set(job.jobId, job.organizationId);
    return withTenantTransaction(this.pool, job.organizationId, async (client) => {
      const current = await client.query("SELECT state FROM jobs WHERE id = $1 FOR UPDATE", [job.jobId]);
      if (!current.rowCount) throw new RepositoryError("NOT_FOUND", "Job not found");
      const state = current.rows[0].state;
      if (["succeeded", "canceled"].includes(state)) return "already_complete" as const;
      if (["running", "cancel_requested"].includes(state)) return "already_running" as const;
      await client.query(`
        UPDATE jobs SET state = 'running', attempt_count = attempt_count + 1,
          heartbeat_at = now(), updated_at = now() WHERE id = $1
      `, [job.jobId]);
      return "claimed" as const;
    });
  }

  assertOrganizationOwnsInputs(job: JobEnvelope): Promise<void> {
    return withTenantTransaction(this.pool, job.organizationId, async (client) => {
      const result = await client.query("SELECT 1 FROM projects WHERE id = $1 AND state = 'active'", [job.projectId]);
      if (!result.rowCount) throw new RepositoryError("NOT_FOUND", "Job inputs not found");
      if (typeof job.payload.uploadId === "string") {
        const upload = await client.query(
          "SELECT 1 FROM upload_sessions WHERE id = $1 AND project_id = $2",
          [job.payload.uploadId, job.projectId]
        );
        if (!upload.rowCount) throw new RepositoryError("NOT_FOUND", "Job inputs not found");
      }
    });
  }

  cancellationRequested(jobId: string): Promise<boolean> {
    return this.withJob(jobId, async (client) => {
      const result = await client.query("SELECT state FROM jobs WHERE id = $1", [jobId]);
      return result.rows[0]?.state === "cancel_requested";
    });
  }
  heartbeat(jobId: string, stage: string, progress: number): Promise<void> {
    return this.withJob(jobId, async (client) => {
      await client.query(`UPDATE jobs SET stage = $2, progress = $3, heartbeat_at = now(),
        updated_at = now() WHERE id = $1 AND state IN ('running', 'cancel_requested')`,
      [jobId, stage, progress]);
    });
  }
  succeed(jobId: string, output: Record<string, unknown>): Promise<void> {
    return this.withJob(jobId, async (client) => {
      await client.query(`UPDATE jobs SET state = 'succeeded', progress = 1, result = $2,
        updated_at = now() WHERE id = $1 AND state = 'running'`, [jobId, output]);
      this.organizations.delete(jobId);
    });
  }
  fail(jobId: string, failure: ClassifiedJobFailure): Promise<void> {
    return this.withJob(jobId, async (client) => {
      await client.query(`UPDATE jobs SET state = CASE WHEN state = 'cancel_requested'
          THEN 'canceled'::job_state ELSE 'failed'::job_state END,
        error_code = $2, error_message = $3, error_retryable = $4, updated_at = now()
        WHERE id = $1`, [jobId, failure.code, failure.message, failure.retryable]);
      this.organizations.delete(jobId);
    });
  }
  private withJob<T>(jobId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const organizationId = this.organizations.get(jobId);
    if (!organizationId) return Promise.reject(new RepositoryError("NOT_FOUND", "Job claim context not found"));
    return withTenantTransaction(this.pool, organizationId, operation);
  }
}

async function insertJobAndOutbox(client: Queryable, userId: string, job: JobEnvelope) {
  await client.query(`
    INSERT INTO jobs
      (id, organization_id, project_id, kind, schema_version, input_hash, state,
       attempt_count, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0, $7, $8, $8)
    ON CONFLICT (id) DO NOTHING
  `, [job.jobId, job.organizationId, job.projectId, job.kind, job.schemaVersion,
    job.inputHash, userId, job.requestedAt]);
  await client.query(`
    INSERT INTO outbox (id, organization_id, project_id, queue, payload)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING
  `, [job.jobId, job.organizationId, job.projectId, queueFor(job.kind), job]);
}

function queueFor(kind: JobEnvelope["kind"]): "ingest" | "analysis" | "render" {
  if (kind === "ingest" || kind === "delete") return "ingest";
  return kind === "render" ? "render" : "analysis";
}

function projectFromRow(row: QueryResultRow): Project {
  return projectSchema.parse({
    id: row.id, name: row.name, revision: row.revision, state: row.state,
    createdAt: instant(row.created_at), updatedAt: instant(row.updated_at)
  });
}
function uploadFromRow(row: QueryResultRow): StoredUploadSession {
  const publicFields = uploadSessionSchema.parse({
    id: row.id, projectId: row.project_id, displayName: row.display_name,
    expectedBytes: Number(row.expected_bytes), partSizeBytes: row.part_size_bytes,
    state: row.state, expiresAt: instant(row.expires_at), createdAt: instant(row.created_at)
  });
  return { ...publicFields, objectKey: row.object_key,
    multipartUploadId: row.multipart_upload_id, checksumSha256: row.checksum_sha256 };
}
function eventFromRow(row: QueryResultRow): DurableEvent {
  return durableEventSchema.parse({
    id: Number(row.id), type: row.type, organizationId: row.organization_id,
    projectId: row.project_id, data: row.data, createdAt: instant(row.created_at)
  });
}
function instant(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
