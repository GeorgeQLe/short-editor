import { jobEnvelopeSchema, type JobEnvelope } from "@siftcut/saas-contracts";
import type { ArtifactStorage, JobControl } from "@siftcut/infrastructure";
export type { JobControl } from "@siftcut/infrastructure";

export interface ScratchSpace {
  create(jobId: string): Promise<string>;
  remove(path: string): Promise<void>;
}

export interface StageOutput {
  temporaryObjectKey?: string;
  finalObjectKey?: string;
  metadata: Record<string, unknown>;
}

export interface JobHandler {
  stages(job: JobEnvelope): ReadonlyArray<string>;
  runStage(job: JobEnvelope, stage: string, scratchPath: string): Promise<StageOutput>;
  validate(stage: string, output: StageOutput): Promise<void>;
}

export interface ClassifiedFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export class CancellationError extends Error {
  constructor() {
    super("Job cancellation requested");
    this.name = "CancellationError";
  }
}

export class WorkerProcessor {
  constructor(
    private readonly control: JobControl,
    private readonly storage: ArtifactStorage,
    private readonly scratch: ScratchSpace,
    private readonly handlers: Record<JobEnvelope["kind"], JobHandler>
  ) {}

  async process(raw: unknown): Promise<"completed" | "duplicate" | "busy"> {
    const job = jobEnvelopeSchema.parse(raw);
    const claim = await this.control.claim(job);
    if (claim === "already_complete") return "duplicate";
    if (claim === "already_running") return "busy";

    let scratchPath: string | undefined;
    try {
      await this.control.assertOrganizationOwnsInputs(job);
      scratchPath = await this.scratch.create(job.jobId);
      const handler = this.handlers[job.kind];
      const stages = handler.stages(job);
      const outputs: Record<string, unknown> = {};
      for (let index = 0; index < stages.length; index += 1) {
        if (await this.control.cancellationRequested(job.jobId)) {
          throw new CancellationError();
        }
        const stage = stages[index]!;
        await this.control.heartbeat(job.jobId, stage, index / stages.length);
        const output = await handler.runStage(job, stage, scratchPath);
        await handler.validate(stage, output);
        if (output.temporaryObjectKey && output.finalObjectKey) {
          // Only validated objects are promoted to immutable final keys.
          await this.storage.promote(output.temporaryObjectKey, output.finalObjectKey);
        }
        outputs[stage] = output.metadata;
      }
      await this.control.heartbeat(job.jobId, "complete", 1);
      await this.control.succeed(job.jobId, outputs);
      return "completed";
    } catch (error) {
      await this.control.fail(job.jobId, classifyFailure(error));
      throw error;
    } finally {
      if (scratchPath) await this.scratch.remove(scratchPath);
    }
  }
}

export function classifyFailure(error: unknown): ClassifiedFailure {
  if (error instanceof CancellationError) {
    return { code: "JOB_CANCELLED", message: error.message, retryable: false };
  }
  if (error instanceof Error && "retryable" in error && typeof error.retryable === "boolean") {
    return {
      code: "WORKER_STAGE_FAILED",
      message: sanitizeMessage(error.message),
      retryable: error.retryable
    };
  }
  return {
    code: "WORKER_STAGE_FAILED",
    message: error instanceof Error ? sanitizeMessage(error.message) : "Worker stage failed",
    retryable: false
  };
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .replace(/(?:\/[^/\s]+){2,}/g, "[redacted-path]")
    .slice(0, 500);
}
