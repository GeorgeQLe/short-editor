import { describe, expect, it, vi } from "vitest";
import type { ArtifactStorage } from "../../packages/infrastructure/src/index.js";
import type { JobEnvelope } from "../../packages/saas-contracts/src/index.js";
import {
  WorkerProcessor,
  type JobControl,
  type JobHandler,
  type ScratchSpace
} from "../../apps/worker/src/processor.js";

const JOB: JobEnvelope = {
  schemaVersion: 1,
  jobId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  kind: "ingest",
  inputHash: "c".repeat(64),
  payload: {},
  requestedAt: "2026-08-01T12:00:00.000Z"
};

describe("worker processor", () => {
  it("validates before promotion and always cleans scratch", async () => {
    const calls: string[] = [];
    const control: JobControl = {
      async claim() { return "claimed"; },
      async assertOrganizationOwnsInputs() { calls.push("authorize"); },
      async cancellationRequested() { return false; },
      async heartbeat() {},
      async succeed() { calls.push("succeed"); },
      async fail() { calls.push("fail"); }
    };
    const storage = {
      promote: vi.fn(async () => { calls.push("promote"); })
    } as unknown as ArtifactStorage;
    const scratch: ScratchSpace = {
      async create() { return "/private/scratch/job"; },
      async remove() { calls.push("cleanup"); }
    };
    const handler: JobHandler = {
      stages: () => ["probe"],
      async runStage() {
        return {
          temporaryObjectKey: "temporary/job/proxy",
          finalObjectKey: "orgs/o/projects/p/artifacts/proxy",
          metadata: {}
        };
      },
      async validate() { calls.push("validate"); }
    };
    const processor = new WorkerProcessor(control, storage, scratch, {
      ingest: handler,
      transcribe: handler,
      analyze: handler,
      render: handler,
      delete: handler
    });

    await expect(processor.process(JOB)).resolves.toBe("completed");
    expect(calls).toEqual(["authorize", "validate", "promote", "succeed", "cleanup"]);
  });

  it("short-circuits an already completed redelivery", async () => {
    const control = {
      claim: vi.fn(async () => "already_complete" as const)
    } as unknown as JobControl;
    const processor = new WorkerProcessor(
      control,
      {} as ArtifactStorage,
      {} as ScratchSpace,
      {} as Record<JobEnvelope["kind"], JobHandler>
    );
    await expect(processor.process(JOB)).resolves.toBe("duplicate");
    expect(control.claim).toHaveBeenCalledOnce();
  });
});
