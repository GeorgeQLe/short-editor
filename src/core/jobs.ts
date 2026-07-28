import { randomUUID } from "node:crypto";
import type { Job } from "../shared/domain.js";
import { AppError, normalizeError } from "../shared/errors.js";
import type { Repository } from "./repository.js";

export interface JobRequest {
  type: Job["type"];
  entityId?: string;
  payload?: unknown;
  provider?: "local" | "openai";
  cloudOperationClass?: string;
  cloudScope?: { type: "project" | "batch"; id: string };
}

export class JobQueue {
  constructor(
    private readonly repository: Repository,
    private readonly credentialHandleAvailable: (handle: string) => boolean = () => false
  ) {}

  enqueue(request: JobRequest): Job {
    let payload = request.payload ?? {};
    if (request.provider === "openai") {
      if (!request.entityId || !request.cloudOperationClass) throw cloudNotAuthorized();
      const scope = request.cloudScope ?? { type: "project" as const, id: request.entityId };
      const authorization = this.repository.findCloudAuthorization(
        scope.type, scope.id, request.provider, request.cloudOperationClass
      );
      if (
        !authorization?.credentialHandle ||
        !this.credentialHandleAvailable(authorization.credentialHandle)
      ) throw cloudNotAuthorized();
      payload = {
        operation: request.cloudOperationClass,
        authorizationScope: scope,
        options: payload,
        credentialHandle: authorization.credentialHandle
      };
    }
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(), type: request.type, entityId: request.entityId ?? null,
      provider: request.provider ?? null,
      state: "queued", progress: 0, stage: "queued", attempts: 0,
      cancelRequested: false, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    };
    this.repository.insertJob(job, payload);
    return job;
  }

  enqueueUnique(request: JobRequest): Job {
    const existing = this.repository.db.prepare(`
      SELECT id FROM jobs
      WHERE type=? AND state IN ('queued','running')
        AND ((entity_id IS NULL AND ? IS NULL) OR entity_id=?)
      ORDER BY created_at LIMIT 1
    `).get(request.type, request.entityId ?? null, request.entityId ?? null) as
      { id: string } | undefined;
    if (existing) return this.list().find((job) => job.id === existing.id)!;
    return this.enqueue(request);
  }

  list(): Job[] {
    return this.repository.listJobs();
  }

  cancel(id: string): Job {
    this.repository.db.transaction(() => {
      const row = this.repository.db.prepare(`
        SELECT state,payload_reference FROM jobs WHERE id=?
      `).get(id) as { state: Job["state"]; payload_reference: string | null } | undefined;
      if (!row || (row.state !== "queued" && row.state !== "running")) {
        throw new AppError("INVALID_STATE", "Job cannot be cancelled", 409);
      }
      const now = new Date().toISOString();
      this.repository.db.prepare(`
        UPDATE jobs SET cancel_requested=1,
          state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,
          stage=CASE WHEN state='queued' THEN 'cancelled' ELSE stage END,
          error_code=CASE WHEN state='queued' THEN 'JOB_CANCELLED' ELSE error_code END,
          error_message=CASE WHEN state='queued' THEN 'Render was cancelled before it started'
            ELSE error_message END,
          updated_at=?
        WHERE id=? AND state IN ('queued','running')
      `).run(now, id);
      if (row.state === "queued" && row.payload_reference?.startsWith("render:")) {
        const renderId = row.payload_reference.slice("render:".length);
        const changed = this.repository.db.prepare(`
          UPDATE renders SET state='cancelled',error_code='JOB_CANCELLED',
            error_message='Render was cancelled before it started',updated_at=?
          WHERE id=? AND state='queued'
        `).run(now, renderId);
        if (!changed.changes) {
          throw new AppError(
            "INVALID_STATE",
            "Queued Render cancellation lost a concurrent state transition",
            409
          );
        }
      } else if (row.state === "running" && row.payload_reference?.startsWith("render:")) {
        const renderState = this.repository.db.prepare(
          "SELECT state FROM renders WHERE id=?"
        ).get(row.payload_reference.slice("render:".length)) as
          { state: RenderState } | undefined;
        if (renderState?.state === "succeeded") {
          throw new AppError("INVALID_STATE", "Render already completed successfully", 409);
        }
      }
    }).immediate();
    return this.repository.listJobs().find((job) => job.id === id)!;
  }

  recover(): number {
    return this.repository.recoverJobs();
  }

  claimNext(): { job: Job; payload: unknown } | undefined {
    return this.repository.db.transaction(() => {
      const row = this.repository.db.prepare(`
        SELECT id FROM jobs WHERE state='queued' AND cancel_requested=0 ORDER BY created_at LIMIT 1
      `).get() as { id: string } | undefined;
      if (!row) return undefined;
      const stored = this.repository.db.prepare(
        "SELECT entity_id,provider,payload_json FROM jobs WHERE id=?"
      ).get(row.id) as {
        entity_id: string | null;
        provider: string | null;
        payload_json: string;
      };
      const payload = JSON.parse(stored.payload_json) as unknown;
      if (stored.provider === "openai" && !this.cloudPayloadIsCurrentlyAuthorized(
        stored.entity_id,
        payload
      )) {
        const now = new Date().toISOString();
        this.repository.db.prepare(`
          UPDATE jobs SET state='failed',stage='failed',error_code='CLOUD_NOT_AUTHORIZED',
            error_message=?,updated_at=? WHERE id=? AND state='queued'
        `).run(cloudNotAuthorized().message, now, row.id);
        return undefined;
      }
      const now = new Date().toISOString();
      this.repository.db.prepare(`
        UPDATE jobs SET state='running',stage='starting',attempts=attempts+1,updated_at=? WHERE id=?
      `).run(now, row.id);
      return { job: this.repository.listJobs().find((job) => job.id === row.id)!, payload };
    })();
  }

  private cloudPayloadIsCurrentlyAuthorized(entityId: string | null, payload: unknown): boolean {
    if (!entityId || !payload || typeof payload !== "object") return false;
    const candidate = payload as {
      operation?: unknown;
      credentialHandle?: unknown;
      authorizationScope?: { type?: unknown; id?: unknown };
    };
    if (
      typeof candidate.operation !== "string" ||
      typeof candidate.credentialHandle !== "string" ||
      (candidate.authorizationScope?.type !== "project" &&
        candidate.authorizationScope?.type !== "batch") ||
      typeof candidate.authorizationScope.id !== "string"
    ) {
      return false;
    }
    const authorization = this.repository.findCloudAuthorization(
      candidate.authorizationScope.type,
      candidate.authorizationScope.id,
      "openai",
      candidate.operation
    );
    return authorization?.credentialHandle === candidate.credentialHandle &&
      this.credentialHandleAvailable(candidate.credentialHandle);
  }

  progress(id: string, progress: number, stage: string): void {
    this.repository.db.prepare(`
      UPDATE jobs SET progress=?,stage=?,updated_at=? WHERE id=? AND state='running'
    `).run(Math.max(0, Math.min(1, progress)), stage, new Date().toISOString(), id);
  }

  complete(id: string): void {
    this.repository.db.prepare(`
      UPDATE jobs SET state='succeeded',progress=1,stage='complete',updated_at=? WHERE id=? AND state='running'
    `).run(new Date().toISOString(), id);
  }

  finalizeCancelled(id: string): void {
    this.repository.db.prepare(`
      UPDATE jobs SET state='cancelled',stage='cancelled',updated_at=? WHERE id=? AND state='running'
    `).run(new Date().toISOString(), id);
  }

  fail(id: string, error: unknown): void {
    const appError = normalizeError(error);
    this.repository.db.prepare(`
      UPDATE jobs SET state='failed',stage='failed',error_code=?,error_message=?,updated_at=?
      WHERE id=? AND state='running'
    `).run(appError.code, appError.message, new Date().toISOString(), id);
  }

  cancellationRequested(id: string): boolean {
    const row = this.repository.db.prepare("SELECT cancel_requested FROM jobs WHERE id=?").get(id) as
      { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  renderCompleted(jobId: string): boolean {
    return Boolean(this.repository.db.prepare(`
      SELECT 1 FROM jobs j
      JOIN renders r ON j.payload_reference='render:' || r.id
      WHERE j.id=? AND r.state='succeeded'
    `).get(jobId));
  }
}

function cloudNotAuthorized(): AppError {
  return new AppError(
    "CLOUD_NOT_AUTHORIZED",
    "This cloud job requires a current persisted authorization and protected credential",
    403
  );
}

export class JobRunner {
  private timer?: NodeJS.Timeout;
  private working = false;
  private stopping = false;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly queue: JobQueue,
    private readonly handlers: Partial<Record<Job["type"], (job: Job, payload: unknown) => Promise<void>>>
  ) {}

  start(intervalMs = 300): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.working) {
      await new Promise<void>((resolvePromise) => this.idleWaiters.push(resolvePromise));
    }
  }

  async tick(): Promise<void> {
    if (this.working || this.stopping) return;
    const claimed = this.queue.claimNext();
    if (!claimed) return;
    this.working = true;
    try {
      const handler = this.handlers[claimed.job.type];
      if (!handler) throw new AppError(
        "DEPENDENCY_UNAVAILABLE", `No worker is installed for ${claimed.job.type} jobs`, 503
      );
      await handler(claimed.job, claimed.payload);
      if (this.queue.cancellationRequested(claimed.job.id)) {
        if (claimed.job.type === "render" && this.queue.renderCompleted(claimed.job.id)) {
          this.queue.complete(claimed.job.id);
        } else {
          this.queue.finalizeCancelled(claimed.job.id);
        }
      } else {
        this.queue.complete(claimed.job.id);
      }
    } catch (error) {
      const appError = normalizeError(error);
      if (appError.code === "JOB_CANCELLED" || this.queue.cancellationRequested(claimed.job.id)) {
        this.queue.finalizeCancelled(claimed.job.id);
      } else {
        this.queue.fail(claimed.job.id, appError);
      }
    } finally {
      this.working = false;
      this.idleWaiters.splice(0).forEach((resolvePromise) => resolvePromise());
      if (!this.stopping) queueMicrotask(() => void this.tick());
    }
  }
}

type RenderState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "stale";
