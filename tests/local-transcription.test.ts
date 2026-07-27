import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LocalTranscriptionProvider,
  localTranscriptionOptionsSchema
} from "../src/core/local-transcription";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import type { PythonWorkerSupervisor } from "../src/core/python-worker-supervisor";
import { episode } from "./factories";

function worker(result: unknown): PythonWorkerSupervisor {
  return {
    runJob: async (
      _jobId: string,
      _job: unknown,
      onProgress?: (progress: number, stage: string) => void
    ) => {
      onProgress?.(0.5, "decoding local audio");
      return result;
    },
    capabilities: async () => [{
      operation: "transcription",
      available: true,
      providers: ["faster-whisper"],
      features: ["english", "word-timestamps"]
    }],
    status: async () => ({
      state: "degraded",
      activeJobIds: [],
      dependencies: [
        { id: "faster-whisper", state: "available", version: "1.2.0", detail: null },
        {
          id: "faster-whisper:model:small.en",
          state: "available",
          version: null,
          detail: null
        },
        {
          id: "faster-whisper:model:large-v3",
          state: "missing",
          version: null,
          detail: "install"
        }
      ]
    })
  } as unknown as PythonWorkerSupervisor;
}

const provenance = {
  provider: "faster-whisper",
  providerClass: "local" as const,
  modelId: "small.en",
  providerVersion: "1.2.0",
  optionsVersion: "transcription-v1",
  createdAt: new Date().toISOString()
};

describe("LocalTranscriptionProvider", () => {
  it("accepts provider model IDs but rejects filesystem paths", () => {
    expect(localTranscriptionOptionsSchema.safeParse({
      modelId: "Systran/faster-whisper-small.en",
      wordTimestamps: true
    }).success).toBe(true);
    expect(localTranscriptionOptionsSchema.safeParse({
      modelId: "/private/models/small.en",
      wordTimestamps: true
    }).success).toBe(false);
    expect(localTranscriptionOptionsSchema.safeParse({
      modelId: "../models/small.en",
      wordTimestamps: true
    }).success).toBe(false);
  });

  it("maps typed worker output to transcript segments and reports model inventory", async () => {
    const provider = new LocalTranscriptionProvider(worker({
      kind: "transcription",
      language: "en",
      segments: [
        { startMs: 0, endMs: 2_000, text: "One thought.", confidence: 0.9 },
        { startMs: 2_000, endMs: 4_000, text: "Next thought.", confidence: null }
      ],
      words: [
        { startMs: 0, endMs: 500, text: "One", confidence: 0.9 },
        { startMs: 500, endMs: 2_000, text: "thought.", confidence: null },
        { startMs: 2_000, endMs: 4_000, text: "Next thought.", confidence: 0.8 }
      ],
      diarization: "absent",
      provenance
    }));
    await expect(provider.status()).resolves.toEqual({
      available: true,
      features: ["english", "word-timestamps"],
      models: [
        { modelId: "small.en", installed: true },
        { modelId: "large-v3", installed: false }
      ]
    });
    const stages: string[] = [];
    const result = await provider.transcribe(
      randomUUID(),
      "/source.mp4",
      { modelId: "small.en", wordTimestamps: true },
      (_progress, stage) => stages.push(stage)
    );
    expect(stages).toEqual(["decoding local audio"]);
    expect(result.segments[0]).toMatchObject({
      text: "One thought.",
      speaker: null,
      words: [
        { startMs: 0, endMs: 500, text: "One", confidence: 0.9 },
        { startMs: 500, endMs: 2_000, text: "thought." }
      ]
    });
  });

  it("does not persist an invented transcript for silence", async () => {
    const provider = new LocalTranscriptionProvider(worker({
      kind: "transcription",
      language: "en",
      segments: [],
      words: [],
      diarization: "absent",
      provenance
    }));
    await expect(provider.transcribe(
      randomUUID(),
      "/silence.wav",
      { modelId: "small.en", wordTimestamps: true }
    )).rejects.toMatchObject({
      code: "PROVIDER_OUTPUT_INVALID",
      message: "No English speech was detected in the selected source"
    });
  });

  it("stores accepted local provenance through the core transaction", () => {
    const repository = new Repository(openDatabase(":memory:"));
    const source = episode({ status: "ready" });
    repository.insertEpisode(source);
    const service = new CoreService(repository, {} as never, new JobQueue(repository));
    const segments = [{
      id: randomUUID(),
      startMs: 0,
      endMs: 1_000,
      text: "Stored locally.",
      words: [],
      speaker: null,
      confidence: 0.9
    }];
    const revision = service.storeGeneratedTranscript(source.id, "en", segments, provenance);
    expect(revision).toMatchObject({
      revision: 1,
      language: "en",
      acceptedState: "accepted",
      provenance
    });
    expect(repository.getEpisode(source.id).status).toBe("ready");
    expect(repository.getTranscript(source.id)).toEqual(segments);
    repository.db.close();
  });
});
