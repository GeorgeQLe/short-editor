import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PYTHON_WORKER_PROTOCOL_VERSION,
  pythonWorkerCommandSchema,
  pythonWorkerEventSchema,
  pythonWorkerJobSchema,
  workerOperationKinds
} from "../src/shared/domain";

describe("Python worker v1 protocol", () => {
  it("defines strict, credential-free discriminated operations", () => {
    const jobs = [
      {
        kind: "transcription", sourcePath: "/media/source.mp4", modelId: "small.en",
        language: "en", wordTimestamps: true
      },
      {
        kind: "diarization", sourcePath: "/media/source.mp4", modelId: "speaker",
        minimumSpeakers: null, maximumSpeakers: null
      },
      {
        kind: "visual_sampling", sourcePath: "/media/source.mp4",
        intervalMs: 1_000, maximumSamples: 100
      },
      {
        kind: "provider_call", provider: "ollama", modelId: "local",
        credentialHandle: null, operation: "analysis", inputArtifactPaths: ["/artifacts/input.json"],
        schemaVersion: "analysis-v1", options: {}
      }
    ];
    expect(jobs.map(({ kind }) => kind)).toEqual(workerOperationKinds);
    jobs.forEach((job) => expect(pythonWorkerJobSchema.safeParse(job).success).toBe(true));
    expect(pythonWorkerJobSchema.safeParse({ ...jobs[0], apiKey: "secret" }).success).toBe(false);
    expect(pythonWorkerJobSchema.safeParse({
      ...jobs[3],
      options: { nested: { apiKey: "secret" } }
    }).success).toBe(false);
  });

  it("rejects mismatched versions, unknown fields, and partial messages", () => {
    const requestId = randomUUID();
    const hello = {
      protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
      type: "hello",
      requestId,
      coreVersion: "0.1.0"
    };
    expect(pythonWorkerCommandSchema.parse(hello)).toEqual(hello);
    expect(pythonWorkerCommandSchema.safeParse({ ...hello, protocolVersion: "v2" }).success).toBe(false);
    expect(pythonWorkerCommandSchema.safeParse({ ...hello, token: "secret" }).success).toBe(false);
    expect(pythonWorkerEventSchema.safeParse({
      protocolVersion: "v1", type: "job.result", jobId: randomUUID()
    }).success).toBe(false);
  });
});
