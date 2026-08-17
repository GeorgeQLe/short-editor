import {
  durableEventSchema,
  entitlementSchema,
  jobEnvelopeSchema,
  projectSchema,
  screenletterRecordingSchema,
  uploadSessionSchema,
  usageSchema,
  type AuthenticatedContext,
  type DurableEvent,
  type JobEnvelope,
  type Project,
  type ScreenletterRecording,
  type UploadSession
} from "@siftcut/saas-contracts";
import type {
  ClassifiedJobFailure,
  EntitlementRepository,
  EventRepository,
  JobControl,
  LeasedOutboxRecord,
  ProjectRepository,
  ScreenletterRepository,
  StoredScreenletterShare,
  StoredUploadSession,
  TransactionalOutbox,
  UploadRepository,
  UsageRepository
} from "./index.js";
import { RepositoryError } from "./repository-error.js";

type Row = Record<string, unknown>;

export class D1ProjectRepository implements ProjectRepository {
  constructor(private readonly db: D1Database) {}

  async list(context: AuthenticatedContext): Promise<Project[]> {
    const rows = await this.db.prepare(`SELECT id,name,kind,origin,revision,state,created_at,updated_at
      FROM projects WHERE organization_id=? AND state='active' ORDER BY updated_at DESC,id`)
      .bind(context.organizationId).all<Row>();
    return rows.results.map(projectFromRow);
  }

  async get(context: AuthenticatedContext, projectId: string): Promise<Project | null> {
    const row = await this.db.prepare(`SELECT id,name,kind,origin,revision,state,created_at,updated_at
      FROM projects WHERE organization_id=? AND id=? AND state='active'`)
      .bind(context.organizationId, projectId).first<Row>();
    return row ? projectFromRow(row) : null;
  }

  async create(context: AuthenticatedContext, project: Project): Promise<Project> {
    await this.db.prepare(`INSERT INTO projects
      (id,organization_id,name,kind,origin,revision,state,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(project.id, context.organizationId, project.name,
      project.kind, project.origin, project.revision, project.state, context.userId,
      project.createdAt, project.updatedAt).run();
    return project;
  }

  async update(context: AuthenticatedContext, projectId: string, expectedRevision: number,
    patch: Pick<Project, "name" | "updatedAt">): Promise<Project> {
    const result = await this.db.prepare(`UPDATE projects SET name=?,revision=revision+1,updated_at=?
      WHERE organization_id=? AND id=? AND revision=? AND state='active'`)
      .bind(patch.name, patch.updatedAt, context.organizationId, projectId, expectedRevision).run();
    if (!result.meta.changes) await this.throwMutationError(context, projectId, expectedRevision);
    return (await this.get(context, projectId))!;
  }

  async delete(context: AuthenticatedContext, projectId: string, expectedRevision: number,
    deletionRequestedAt: string, purgeAfter: string): Promise<Project> {
    const statements = await this.db.batch([
      this.db.prepare(`UPDATE projects SET state='deleting',revision=revision+1,
        deletion_requested_at=?,purge_after=?,updated_at=?
        WHERE organization_id=? AND id=? AND revision=? AND state='active'`)
        .bind(deletionRequestedAt, purgeAfter, deletionRequestedAt, context.organizationId,
          projectId, expectedRevision),
      this.db.prepare(`UPDATE jobs SET state='cancel_requested',cancel_requested_at=?,updated_at=?
        WHERE organization_id=? AND project_id=? AND state IN ('queued','running')`)
        .bind(deletionRequestedAt, deletionRequestedAt, context.organizationId, projectId)
    ]);
    if (!statements[0]!.meta.changes) await this.throwMutationError(context, projectId, expectedRevision);
    const row = await this.db.prepare(`SELECT id,name,kind,origin,revision,state,created_at,updated_at
      FROM projects WHERE organization_id=? AND id=?`).bind(context.organizationId, projectId).first<Row>();
    return projectFromRow(row!);
  }

  private async throwMutationError(context: AuthenticatedContext, id: string, revision: number): Promise<never> {
    const row = await this.db.prepare("SELECT revision FROM projects WHERE organization_id=? AND id=?")
      .bind(context.organizationId, id).first<{ revision: number }>();
    if (!row) throw new RepositoryError("NOT_FOUND", "Project not found");
    throw new RepositoryError("REVISION_CONFLICT", "Project revision conflict", {
      expectedRevision: revision, actualRevision: Number(row.revision)
    });
  }
}

export class D1ScreenletterRepository implements ScreenletterRepository {
  constructor(private readonly db: D1Database) {}
  async list(context: AuthenticatedContext): Promise<ScreenletterRecording[]> {
    const rows = await this.db.prepare(`SELECT * FROM screenletter_recordings
      WHERE organization_id=? AND state<>'deleted' ORDER BY updated_at DESC,id`)
      .bind(context.organizationId).all<Row>();
    return rows.results.map(screenletterFromRow);
  }
  async get(context: AuthenticatedContext, id: string): Promise<ScreenletterRecording | null> {
    const row = await this.db.prepare(`SELECT * FROM screenletter_recordings
      WHERE organization_id=? AND id=? AND state<>'deleted'`).bind(context.organizationId, id).first<Row>();
    return row ? screenletterFromRow(row) : null;
  }
  async create(context: AuthenticatedContext, project: Project,
    recording: ScreenletterRecording): Promise<ScreenletterRecording> {
    await this.db.batch([
      this.db.prepare(`INSERT INTO projects
        (id,organization_id,name,kind,origin,revision,state,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(project.id, context.organizationId, project.name,
        project.kind, project.origin, project.revision, project.state, context.userId,
        project.createdAt, project.updatedAt),
      this.db.prepare(`INSERT INTO screenletter_recordings
        (id,organization_id,project_id,owner_id,name,mode,state,source_asset_id,proxy_asset_id,
         published_asset_id,share_token,share_revision,failure_code,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(recording.id, context.organizationId,
        recording.projectId, recording.ownerId, recording.name, recording.mode, recording.state,
        recording.sourceAssetId, recording.proxyAssetId, recording.publishedAssetId,
        recording.shareToken, recording.shareRevision, recording.failureCode, recording.createdAt,
        recording.updatedAt, recording.deletedAt)
    ]);
    return recording;
  }
  async delete(context: AuthenticatedContext, id: string, deletedAt: string): Promise<ScreenletterRecording> {
    const result = await this.db.prepare(`UPDATE screenletter_recordings SET state='deleted',
      deleted_at=?,updated_at=? WHERE organization_id=? AND id=? AND state<>'deleted'`)
      .bind(deletedAt, deletedAt, context.organizationId, id).run();
    if (!result.meta.changes) throw new RepositoryError("NOT_FOUND", "Recording not found");
    const row = await this.db.prepare("SELECT * FROM screenletter_recordings WHERE organization_id=? AND id=?")
      .bind(context.organizationId, id).first<Row>();
    await this.db.prepare(`UPDATE projects SET state='deleting',deletion_requested_at=?,purge_after=?,
      updated_at=?,revision=revision+1 WHERE organization_id=? AND id=? AND state='active'`)
      .bind(deletedAt, new Date(new Date(deletedAt).getTime() + 86400000).toISOString(), deletedAt,
        context.organizationId, row!.project_id).run();
    return screenletterFromRow(row!);
  }
  async retry(context: AuthenticatedContext, id: string, updatedAt: string): Promise<ScreenletterRecording> {
    const result = await this.db.prepare(`UPDATE screenletter_recordings SET state='awaiting_upload',
      failure_code=NULL,updated_at=? WHERE organization_id=? AND id=? AND state='failed'`)
      .bind(updatedAt, context.organizationId, id).run();
    if (!result.meta.changes) return this.throwState(context, id, "Only failed recordings can be retried");
    return (await this.get(context, id))!;
  }
  async publish(context: AuthenticatedContext, id: string, renderAssetId: string,
    expectedRevision: number, updatedAt: string): Promise<ScreenletterRecording> {
    const result = await this.db.prepare(`UPDATE screenletter_recordings SET published_asset_id=?,
      share_revision=share_revision+1,updated_at=? WHERE organization_id=? AND id=?
      AND share_revision=? AND state='ready' AND proxy_asset_id IS NOT NULL AND EXISTS
      (SELECT 1 FROM artifacts WHERE id=? AND organization_id=? AND project_id=screenletter_recordings.project_id
       AND kind='render' AND state='complete')`).bind(renderAssetId, updatedAt, context.organizationId,
      id, expectedRevision, renderAssetId, context.organizationId).run();
    if (!result.meta.changes) return this.throwPublish(context, id, expectedRevision);
    return (await this.get(context, id))!;
  }
  async rollback(context: AuthenticatedContext, id: string, expectedRevision: number,
    updatedAt: string): Promise<ScreenletterRecording> {
    const result = await this.db.prepare(`UPDATE screenletter_recordings SET published_asset_id=NULL,
      share_revision=share_revision+1,updated_at=? WHERE organization_id=? AND id=? AND share_revision=?
      AND state='ready' AND proxy_asset_id IS NOT NULL AND published_asset_id IS NOT NULL`)
      .bind(updatedAt, context.organizationId, id, expectedRevision).run();
    if (!result.meta.changes) return this.throwPublish(context, id, expectedRevision);
    return (await this.get(context, id))!;
  }
  async resolvePublic(token: string): Promise<StoredScreenletterShare | null> {
    const row = await this.db.prepare(`SELECT r.id recording_id,r.name,r.mode,r.share_revision,
      a.object_key,r.created_at FROM screenletter_recordings r JOIN projects p
      ON p.id=r.project_id AND p.organization_id=r.organization_id AND p.state='active'
      JOIN artifacts a ON a.id=coalesce(r.published_asset_id,r.proxy_asset_id)
      AND a.project_id=r.project_id AND a.organization_id=r.organization_id AND a.state='complete'
      WHERE r.share_token=? AND r.state='ready' AND r.deleted_at IS NULL LIMIT 1`)
      .bind(token).first<Row>();
    return row ? { recordingId: String(row.recording_id), name: String(row.name),
      mode: row.mode as ScreenletterRecording["mode"], shareRevision: Number(row.share_revision),
      objectKey: String(row.object_key), createdAt: String(row.created_at) } : null;
  }
  async reportAbuse(token: string, category: string, details: string | null,
    reporterHash: string | null): Promise<boolean> {
    const result = await this.db.prepare(`INSERT INTO screenletter_abuse_reports
      (id,recording_id,category,details,reporter_ip_hash,created_at)
      SELECT ?,id,?,?,?,? FROM screenletter_recordings WHERE share_token=?`)
      .bind(crypto.randomUUID(), category, details, reporterHash, new Date().toISOString(), token).run();
    return result.meta.changes === 1;
  }
  private async throwState(context: AuthenticatedContext, id: string, message: string): Promise<never> {
    const found = await this.db.prepare("SELECT state FROM screenletter_recordings WHERE organization_id=? AND id=?")
      .bind(context.organizationId, id).first<{ state: string }>();
    if (!found) throw new RepositoryError("NOT_FOUND", "Recording not found");
    throw new RepositoryError("INVALID_STATE", message, { state: found.state });
  }
  private async throwPublish(context: AuthenticatedContext, id: string, revision: number): Promise<never> {
    const found = await this.db.prepare(`SELECT share_revision,state FROM screenletter_recordings
      WHERE organization_id=? AND id=?`).bind(context.organizationId, id)
      .first<{ share_revision: number; state: string }>();
    if (!found) throw new RepositoryError("NOT_FOUND", "Recording not found");
    if (Number(found.share_revision) !== revision) throw new RepositoryError("REVISION_CONFLICT",
      "Share revision is stale", { expectedRevision: revision, actualRevision: Number(found.share_revision) });
    throw new RepositoryError("INVALID_STATE", "Recording or render is not publishable", { state: found.state });
  }
}

export class D1UploadRepository implements UploadRepository {
  constructor(private readonly db: D1Database) {}
  async create(context: AuthenticatedContext, session: StoredUploadSession): Promise<StoredUploadSession> {
    const result = await this.db.prepare(`INSERT INTO upload_sessions
      (id,organization_id,project_id,display_name,object_key,multipart_upload_id,expected_bytes,
       checksum_sha256,part_size_bytes,state,expires_at,created_by,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS
       (SELECT 1 FROM projects WHERE id=? AND organization_id=? AND state='active')`)
      .bind(session.id, context.organizationId, session.projectId, session.displayName,
        session.objectKey, session.multipartUploadId, session.expectedBytes, session.checksumSha256,
        session.partSizeBytes, session.state, session.expiresAt, context.userId, session.createdAt,
        session.projectId, context.organizationId).run();
    if (!result.meta.changes) throw new RepositoryError("NOT_FOUND", "Project not found");
    return session;
  }
  async get(context: AuthenticatedContext, id: string): Promise<StoredUploadSession | null> {
    const row = await this.db.prepare(`SELECT u.* FROM upload_sessions u JOIN projects p
      ON p.id=u.project_id AND p.organization_id=u.organization_id AND p.state='active'
      WHERE u.organization_id=? AND u.id=?`).bind(context.organizationId, id).first<Row>();
    return row ? uploadFromRow(row) : null;
  }
  async transition(context: AuthenticatedContext, id: string, from: UploadSession["state"],
    to: UploadSession["state"]): Promise<StoredUploadSession> {
    const result = await this.db.prepare(`UPDATE upload_sessions SET state=? WHERE organization_id=?
      AND id=? AND state=? AND EXISTS (SELECT 1 FROM projects WHERE id=project_id AND
      organization_id=? AND state='active')`).bind(to, context.organizationId, id, from,
      context.organizationId).run();
    if (!result.meta.changes) throw new RepositoryError("INVALID_STATE", "Invalid upload transition");
    return (await this.get(context, id))!;
  }
  async completeWithOutbox(context: AuthenticatedContext, id: string, job: JobEnvelope,
    actual: { byteLength: number; checksumSha256: string }): Promise<StoredUploadSession> {
    const queue = queueFor(job.kind);
    const results = await this.db.batch([
      this.db.prepare(`UPDATE upload_sessions SET state='complete',completed_at=?,completed_bytes=?,
        completed_checksum_sha256=? WHERE organization_id=? AND id=? AND state='completing'`)
        .bind(job.requestedAt, actual.byteLength, actual.checksumSha256, context.organizationId, id),
      this.db.prepare(`INSERT OR IGNORE INTO jobs
        (id,organization_id,project_id,kind,schema_version,input_hash,state,attempt_count,created_by,created_at,updated_at)
        SELECT ?,?,?,?,?,?,'queued',0,?,?,? WHERE EXISTS (SELECT 1 FROM upload_sessions
        WHERE id=? AND organization_id=? AND state='complete' AND completed_at=?)`)
        .bind(job.jobId, job.organizationId, job.projectId, job.kind, job.schemaVersion, job.inputHash,
          context.userId, job.requestedAt, job.requestedAt, id, context.organizationId, job.requestedAt),
      this.db.prepare(`INSERT OR IGNORE INTO outbox
        (id,organization_id,project_id,queue,payload,created_at,available_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM jobs WHERE id=? AND organization_id=?)`)
        .bind(job.jobId, job.organizationId, job.projectId, queue, JSON.stringify(job), job.requestedAt,
          job.requestedAt, job.jobId, context.organizationId)
    ]);
    if (!results[0]!.meta.changes) throw new RepositoryError("INVALID_STATE", "Invalid upload completion");
    return (await this.get(context, id))!;
  }
}

export class D1UsageRepository implements UsageRepository {
  constructor(private readonly db: D1Database, private readonly now = () => new Date()) {}
  async get(context: AuthenticatedContext) {
    const now = this.now().toISOString();
    const row = await this.db.prepare(`SELECT * FROM usage_periods WHERE organization_id=?
      AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1`)
      .bind(context.organizationId, now, now).first<Row>();
    if (!row) throw new RepositoryError("NOT_FOUND", "Current usage period not found");
    return usageSchema.parse({ periodStartsAt: row.starts_at, periodEndsAt: row.ends_at,
      sourceMinutesUsed: Number(row.source_minutes_used),
      sourceMinutesReserved: Number(row.source_minutes_reserved),
      storageBytesUsed: Number(row.storage_bytes_used), storageBytesReserved: Number(row.storage_bytes_reserved) });
  }
  async reserveUpload(context: AuthenticatedContext, reservationId: string, bytes: number): Promise<void> {
    const now = this.now().toISOString();
    const key = `upload:${reservationId}:reserve`;
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO usage_ledger_entries
        (id,organization_id,usage_period_id,idempotency_key,dimension,kind,amount,subject_type,subject_id,created_at)
        SELECT ?,?,id,?,'storage_bytes','reserve',?,'upload',?,? FROM usage_periods
        WHERE organization_id=? AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1`)
        .bind(crypto.randomUUID(), context.organizationId, key, bytes, reservationId, now,
          context.organizationId, now, now),
      this.db.prepare(`UPDATE usage_periods SET storage_bytes_reserved=storage_bytes_reserved+?
        WHERE organization_id=? AND starts_at<=? AND ends_at>? AND changes()>0`)
        .bind(bytes, context.organizationId, now, now)
    ]);
  }
  async releaseUpload(context: AuthenticatedContext, reservationId: string): Promise<void> {
    const now = this.now().toISOString();
    const reserve = `upload:${reservationId}:reserve`;
    const release = `upload:${reservationId}:release`;
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO usage_ledger_entries
        (id,organization_id,usage_period_id,idempotency_key,dimension,kind,amount,subject_type,subject_id,created_at)
        SELECT ?,?,p.id,?,'storage_bytes','release',l.amount,'upload',?,? FROM usage_periods p
        JOIN usage_ledger_entries l ON l.organization_id=p.organization_id AND l.idempotency_key=?
        WHERE p.organization_id=? AND p.starts_at<=? AND p.ends_at>? LIMIT 1`)
        .bind(crypto.randomUUID(), context.organizationId, release, reservationId, now, reserve,
          context.organizationId, now, now),
      this.db.prepare(`UPDATE usage_periods SET storage_bytes_reserved=max(0,storage_bytes_reserved-
        coalesce((SELECT amount FROM usage_ledger_entries WHERE organization_id=? AND idempotency_key=?),0))
        WHERE organization_id=? AND starts_at<=? AND ends_at>? AND changes()>0`)
        .bind(context.organizationId, reserve, context.organizationId, now, now)
    ]);
  }
}

export class D1EntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: D1Database) {}
  async get(context: AuthenticatedContext) {
    const row = await this.db.prepare("SELECT * FROM subscriptions WHERE organization_id=?")
      .bind(context.organizationId).first<Row>();
    if (!row) throw new RepositoryError("NOT_FOUND", "Entitlement not found");
    return entitlementSchema.parse({ memberLimit: Number(row.member_limit),
      sourceMinuteLimit: Number(row.source_minute_limit), storageByteLimit: Number(row.storage_byte_limit),
      canCreateWork: row.state === "trialing" || row.state === "active" });
  }
}

export class D1EventRepository implements EventRepository {
  constructor(private readonly db: D1Database, private readonly pollMs = 1_000) {}
  async after(context: AuthenticatedContext, cursor: number, limit: number): Promise<DurableEvent[]> {
    const rows = await this.db.prepare(`SELECT * FROM event_records WHERE organization_id=? AND id>?
      ORDER BY id LIMIT ?`).bind(context.organizationId, cursor, Math.max(1, Math.min(limit, 1000))).all<Row>();
    return rows.results.map(eventFromRow);
  }
  async *stream(context: AuthenticatedContext, cursor: number, signal: AbortSignal) {
    while (!signal.aborted) {
      const events = await this.after(context, cursor, 100);
      for (const event of events) { cursor = event.id; yield event; }
      if (!events.length) await new Promise<void>((resolve) => setTimeout(resolve, this.pollMs));
    }
  }
  async append(event: Omit<DurableEvent, "id">): Promise<DurableEvent> {
    const result = await this.db.prepare(`INSERT INTO event_records
      (organization_id,project_id,type,data,created_at) VALUES (?,?,?,?,?)`)
      .bind(event.organizationId, event.projectId, event.type, JSON.stringify(event.data), event.createdAt).run();
    return durableEventSchema.parse({ ...event, id: Number(result.meta.last_row_id) });
  }
}

export class D1TransactionalOutbox implements TransactionalOutbox {
  constructor(private readonly db: D1Database, private readonly now = () => new Date()) {}
  async append(job: JobEnvelope): Promise<void> {
    await this.db.prepare(`INSERT OR IGNORE INTO outbox
      (id,organization_id,project_id,queue,payload,created_at,available_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(job.jobId, job.organizationId, job.projectId, queueFor(job.kind), JSON.stringify(job),
        job.requestedAt, job.requestedAt).run();
  }
  async claim(limit: number): Promise<LeasedOutboxRecord[]> {
    const now = this.now();
    const expired = new Date(now.getTime() - 5 * 60_000).toISOString();
    const candidates = await this.db.prepare(`SELECT id FROM outbox WHERE delivered_at IS NULL
      AND available_at<=? AND (claim_expires_at IS NULL OR claim_expires_at<=?) ORDER BY created_at LIMIT ?`)
      .bind(now.toISOString(), now.toISOString(), Math.max(1, Math.min(limit, 100))).all<{ id: string }>();
    const leased: LeasedOutboxRecord[] = [];
    for (const candidate of candidates.results) {
      const token = crypto.randomUUID();
      const expiry = new Date(now.getTime() + 5 * 60_000).toISOString();
      const changed = await this.db.prepare(`UPDATE outbox SET claimed_at=?,claim_token=?,claim_expires_at=?,
        attempts=attempts+1 WHERE id=? AND delivered_at IS NULL AND
        (claim_expires_at IS NULL OR claim_expires_at<=?)`).bind(now.toISOString(), token, expiry,
          candidate.id, now.toISOString()).run();
      if (!changed.meta.changes) continue;
      const row = await this.db.prepare("SELECT payload,attempts FROM outbox WHERE id=? AND claim_token=?")
        .bind(candidate.id, token).first<{ payload: string; attempts: number }>();
      if (row) leased.push({ outboxId: candidate.id, envelope: jobEnvelopeSchema.parse(JSON.parse(row.payload)),
        attempt: Number(row.attempts), claimToken: token });
    }
    void expired;
    return leased;
  }
  async markDelivered(id: string, token: string): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE outbox SET delivered_at=?,claim_token=NULL,claim_expires_at=NULL
      WHERE id=? AND claim_token=? AND delivered_at IS NULL`).bind(this.now().toISOString(), id, token).run();
    return result.meta.changes === 1;
  }
  async markFailed(id: string, token: string, retryAt: Date): Promise<boolean> {
    const now = this.now();
    const result = await this.db.prepare(`UPDATE outbox SET claimed_at=NULL,claim_token=NULL,
      claim_expires_at=NULL,available_at=?,last_error_at=? WHERE id=? AND claim_token=? AND delivered_at IS NULL`)
      .bind(new Date(Math.max(now.getTime(), retryAt.getTime())).toISOString(), now.toISOString(), id, token).run();
    return result.meta.changes === 1;
  }
}

export class D1JobControl implements JobControl {
  constructor(private readonly db: D1Database, private readonly now = () => new Date()) {}
  async claim(job: JobEnvelope) {
    const row = await this.db.prepare("SELECT state FROM jobs WHERE id=? AND organization_id=?")
      .bind(job.jobId, job.organizationId).first<{ state: string }>();
    if (!row) throw new RepositoryError("NOT_FOUND", "Job not found");
    if (["succeeded", "canceled"].includes(row.state)) return "already_complete" as const;
    if (["running", "cancel_requested"].includes(row.state)) return "already_running" as const;
    const now = this.now().toISOString();
    const result = await this.db.prepare(`UPDATE jobs SET state='running',attempt_count=attempt_count+1,
      heartbeat_at=?,updated_at=? WHERE id=? AND organization_id=? AND state IN ('queued','failed')`)
      .bind(now, now, job.jobId, job.organizationId).run();
    return result.meta.changes ? "claimed" as const : "already_running" as const;
  }
  async assertOrganizationOwnsInputs(job: JobEnvelope): Promise<void> {
    const project = await this.db.prepare("SELECT 1 FROM projects WHERE id=? AND organization_id=? AND state='active'")
      .bind(job.projectId, job.organizationId).first();
    if (!project) throw new RepositoryError("NOT_FOUND", "Job inputs not found");
    if (typeof job.payload.uploadId === "string") {
      const upload = await this.db.prepare(`SELECT 1 FROM upload_sessions WHERE id=? AND project_id=?
        AND organization_id=?`).bind(job.payload.uploadId, job.projectId, job.organizationId).first();
      if (!upload) throw new RepositoryError("NOT_FOUND", "Job inputs not found");
    }
  }
  async cancellationRequested(jobId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT state FROM jobs WHERE id=?").bind(jobId).first<{ state: string }>();
    return row?.state === "cancel_requested";
  }
  async heartbeat(jobId: string, stage: string, progress: number): Promise<void> {
    const now = this.now().toISOString();
    await this.db.prepare(`UPDATE jobs SET stage=?,progress=?,heartbeat_at=?,updated_at=?
      WHERE id=? AND state IN ('running','cancel_requested')`).bind(stage, progress, now, now, jobId).run();
  }
  async succeed(jobId: string, output: Record<string, unknown>): Promise<void> {
    await this.db.prepare(`UPDATE jobs SET state='succeeded',progress=1,result=?,updated_at=?
      WHERE id=? AND state='running'`).bind(JSON.stringify(output), this.now().toISOString(), jobId).run();
  }
  async fail(jobId: string, failure: ClassifiedJobFailure): Promise<void> {
    await this.db.prepare(`UPDATE jobs SET state=CASE WHEN state='cancel_requested' THEN 'canceled' ELSE 'failed' END,
      error_code=?,error_message=?,error_retryable=?,updated_at=? WHERE id=?
      AND state IN ('running','cancel_requested')`)
      .bind(failure.code, failure.message, failure.retryable ? 1 : 0, this.now().toISOString(), jobId).run();
  }
}

function queueFor(kind: JobEnvelope["kind"]): "ingest" | "analysis" | "render" {
  if (kind === "ingest" || kind === "delete") return "ingest";
  return kind === "render" ? "render" : "analysis";
}
function projectFromRow(row: Row): Project { return projectSchema.parse({ id: row.id, name: row.name,
  kind: row.kind, origin: row.origin, revision: Number(row.revision), state: row.state,
  createdAt: row.created_at, updatedAt: row.updated_at }); }
function uploadFromRow(row: Row): StoredUploadSession { return { ...uploadSessionSchema.parse({ id: row.id,
  projectId: row.project_id, displayName: row.display_name, expectedBytes: Number(row.expected_bytes),
  partSizeBytes: Number(row.part_size_bytes), state: row.state, expiresAt: row.expires_at,
  createdAt: row.created_at }), objectKey: String(row.object_key), multipartUploadId: String(row.multipart_upload_id),
  checksumSha256: String(row.checksum_sha256) }; }
function eventFromRow(row: Row): DurableEvent { return durableEventSchema.parse({ id: Number(row.id),
  type: row.type, organizationId: row.organization_id, projectId: row.project_id,
  data: typeof row.data === "string" ? JSON.parse(row.data) : row.data, createdAt: row.created_at }); }
function screenletterFromRow(row: Row): ScreenletterRecording { return screenletterRecordingSchema.parse({
  id: row.id, projectId: row.project_id, ownerId: row.owner_id, name: row.name, mode: row.mode,
  state: row.state, sourceAssetId: row.source_asset_id, proxyAssetId: row.proxy_asset_id,
  publishedAssetId: row.published_asset_id, shareToken: row.share_token,
  shareRevision: Number(row.share_revision), failureCode: row.failure_code, createdAt: row.created_at,
  updatedAt: row.updated_at, deletedAt: row.deleted_at }); }
