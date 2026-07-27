import { randomUUID } from "node:crypto";
import type { Job } from "../shared/domain.js";
import { AppError, normalizeError } from "../shared/errors.js";
import type { Repository } from "./repository.js";

export interface JobRequest {
  type: Job["type"];
  entityId?: string;
  payload?: unknown;
  provider?: "local" | "openai";
  cloudAuthorized?: boolean;
}

export class JobQueue {
  constructor(private readonly repository: Repository) {}

  enqueue(request: JobRequest): Job {
    if (request.provider === "openai" && !request.cloudAuthorized) {
      throw new AppError(
        "CLOUD_NOT_AUTHORIZED",
        "This cloud job requires explicit authorization after reviewing network and cost implications",
        403
      );
    }
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(), type: request.type, entityId: request.entityId ?? null,
      provider: request.provider ?? null,
      state: "queued", progress: 0, stage: "queued", attempts: 0,
      cancelRequested: false, errorCode: null, errorMessage: null, payloadReference: null,
      createdAt: now, updatedAt: now
    };
    this.repository.insertJob(job, request.payload ?? {});
    return job;
  }

  list(): Job[] {
    return this.repository.listJobs();
  }

  cancel(id: string): Job {
    const result = this.repository.db.prepare(`
      UPDATE jobs SET cancel_requested=1,
        state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,
        stage=CASE WHEN state='queued' THEN 'cancelled' ELSE stage END,
        updated_at=?
      WHERE id=? AND state IN ('queued','running')
    `).run(new Date().toISOString(), id);
    if (!result.changes) throw new AppError("INVALID_STATE", "Job cannot be cancelled", 409);
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
      const now = new Date().toISOString();
      this.repository.db.prepare(`
        UPDATE jobs SET state='running',stage='starting',attempts=attempts+1,updated_at=? WHERE id=?
      `).run(now, row.id);
      const stored = this.repository.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(row.id) as { payload_json: string };
      return { job: this.repository.listJobs().find((job) => job.id === row.id)!, payload: JSON.parse(stored.payload_json) };
    })();
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
}

export class JobRunner {
  private timer?: NodeJS.Timeout;
  private working = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly handlers: Partial<Record<Job["type"], (job: Job, payload: unknown) => Promise<void>>>
  ) {}

  start(intervalMs = 300): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.working) return;
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
        this.queue.finalizeCancelled(claimed.job.id);
      } else {
        this.queue.complete(claimed.job.id);
      }
    } catch (error) {
      this.queue.fail(claimed.job.id, error);
    } finally {
      this.working = false;
      queueMicrotask(() => void this.tick());
    }
  }
}
