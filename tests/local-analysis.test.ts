import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  analysisInputHash,
  classifyProviderEndpoint,
  episodeAnalysisOutputSchema,
  LocalVisualSampler,
  OllamaAnalysisProvider,
  ollamaOptionsSchema
} from "../src/core/local-analysis";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import type { PythonWorkerSupervisor } from "../src/core/python-worker-supervisor";
import { episode } from "./factories";

const provenance = {
  provider: "ollama",
  providerClass: "local" as const,
  modelId: "gemma3",
  providerVersion: "0.12.6",
  optionsVersion: "episode-analysis-prompt-v1+episode-analysis-schema-v1",
  createdAt: new Date().toISOString()
};
const output = {
  summary: "A useful explanation.",
  topics: ["editing"],
  highlights: [{
    startMs: 0,
    endMs: 2_000,
    title: "Useful point",
    reason: "Complete idea",
    scores: {
      hook: 0.8,
      coherence: 0.9,
      payoff: 0.7,
      independence: 0.8,
      delivery: 0.6,
      visualActivity: 0.5
    }
  }]
};

function worker(result: unknown): PythonWorkerSupervisor {
  return {
    runJob: async (
      _jobId: string,
      _job: unknown,
      onProgress?: (progress: number, stage: string) => void
    ) => {
      onProgress?.(0.5, "working");
      return result;
    }
  } as unknown as PythonWorkerSupervisor;
}

describe("Ollama endpoint policy", () => {
  it.each([
    ["http://localhost:11434", "local"],
    ["http://127.12.3.4:11434", "local"],
    ["http://[::1]:11434", "local"],
    ["http://10.2.3.4:11434", "network"],
    ["http://172.31.2.3:11434", "network"],
    ["http://192.168.1.4:11434", "network"],
    ["http://[fd00::1]:11434", "network"],
    ["https://ollama.example.com", "cloud"],
    ["http://8.8.8.8:11434", "cloud"]
  ])("classifies %s as %s", (url, expected) => {
    expect(classifyProviderEndpoint(url)).toBe(expected);
  });

  it("requires disclosure for private LAN and authorization for public endpoints", () => {
    expect(ollamaOptionsSchema.safeParse({
      baseUrl: "http://192.168.1.2:11434",
      modelId: "gemma3",
      timeoutMs: 10_000,
      networkDisclosed: false,
      cloudAuthorized: false,
      temperature: 0
    }).success).toBe(false);
    expect(ollamaOptionsSchema.safeParse({
      baseUrl: "https://ollama.example.com",
      modelId: "gemma3",
      timeoutMs: 10_000,
      networkDisclosed: true,
      cloudAuthorized: false,
      temperature: 0
    }).success).toBe(false);
  });
});

describe("typed local analysis adapters", () => {
  it("validates structured Ollama results and rejects schema drift", async () => {
    const provider = new OllamaAnalysisProvider(worker({
      kind: "provider_call",
      schemaVersion: "episode-analysis-schema-v1",
      output,
      provenance
    }));
    await expect(provider.analyze(randomUUID(), ["/input.json"], {
      baseUrl: "http://127.0.0.1:11434",
      modelId: "gemma3",
      timeoutMs: 10_000,
      networkDisclosed: false,
      cloudAuthorized: false,
      temperature: 0
    })).resolves.toEqual({ output, provenance });

    const malformed = new OllamaAnalysisProvider(worker({
      kind: "provider_call",
      schemaVersion: "episode-analysis-schema-v1",
      output: { ...output, highlights: [{ startMs: 5, endMs: 2 }] },
      provenance
    }));
    await expect(malformed.analyze(randomUUID(), [], {
      baseUrl: "http://127.0.0.1:11434",
      modelId: "gemma3",
      timeoutMs: 10_000,
      networkDisclosed: false,
      cloudAuthorized: false,
      temperature: 0
    })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
    expect(episodeAnalysisOutputSchema.safeParse(output).success).toBe(true);
  });

  it("retains explicit unsupported visual detections", async () => {
    const result = {
      kind: "visual_sampling",
      capabilities: {
        activity: "supported",
        speakerFraming: "unsupported",
        faceDetection: "unsupported",
        screenShareDetection: "unsupported"
      },
      samples: [{
        atMs: 0,
        activity: 0.2,
        speakerFraming: null,
        faceCount: null,
        screenShare: null
      }],
      provenance: {
        ...provenance,
        provider: "ffmpeg",
        modelId: "frame-difference",
        optionsVersion: "visual-sampling-v1"
      }
    };
    await expect(new LocalVisualSampler(worker(result)).sample(
      randomUUID(),
      "/source.mp4",
      { intervalMs: 2_000, maximumSamples: 20 }
    )).resolves.toEqual(result);
  });

  it("changes cache identity for model, prompt inputs, transcript, and visual options", () => {
    const base = {
      sourceHash: "sha256:source",
      transcript: {
        id: randomUUID(),
        episodeId: randomUUID(),
        revision: 1,
        language: "en",
        segments: [],
        provenance,
        acceptedState: "accepted" as const,
        createdAt: provenance.createdAt,
        updatedAt: provenance.createdAt
      },
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        modelId: "gemma3",
        timeoutMs: 10_000,
        networkDisclosed: false,
        cloudAuthorized: false,
        temperature: 0
      },
      visual: { intervalMs: 2_000, maximumSamples: 20 }
    };
    const first = analysisInputHash(base);
    expect(analysisInputHash(base)).toBe(first);
    expect(analysisInputHash({
      ...base,
      ollama: { ...base.ollama, modelId: "qwen3" }
    })).not.toBe(first);
    expect(analysisInputHash({
      ...base,
      visual: { ...base.visual, intervalMs: 1_000 }
    })).not.toBe(first);
    expect(analysisInputHash({
      ...base,
      transcript: { ...base.transcript, revision: 2 }
    })).not.toBe(first);
  });
});

describe("local analysis core policy", () => {
  it("enqueues configured local analysis and gates network/cloud endpoints before the job", () => {
    const repository = new Repository(openDatabase(":memory:"));
    const source = episode({
      status: "ready",
      contentHash: "a".repeat(64)
    });
    repository.insertEpisode(source);
    repository.replaceTranscriptWithProvenance(source.id, [{
      id: randomUUID(),
      startMs: 0,
      endMs: 1_000,
      text: "Accepted transcript.",
      words: [],
      speaker: null,
      confidence: 0.9
    }], "en", provenance);
    const jobs = new JobQueue(repository);
    const service = new CoreService(repository, {} as never, jobs);
    const job = service.startOllamaAnalysis(source.id, {
      baseUrl: "http://127.0.0.1:11434",
      modelId: "gemma3",
      intervalMs: 1_000
    });
    expect(job).toMatchObject({ type: "analyze", provider: "local", state: "queued" });
    expect(() => service.startOllamaAnalysis(source.id, {
      baseUrl: "http://192.168.1.3:11434"
    })).toThrow(expect.objectContaining({ code: "CLOUD_CONFIRMATION_REQUIRED" }));
    expect(() => service.startOllamaAnalysis(source.id, {
      baseUrl: "https://ollama.example.com",
      cloudAuthorized: true
    })).toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));
    repository.grantCloudAuthorization({
      id: randomUUID(),
      scopeType: "project",
      scopeId: source.id,
      provider: "ollama",
      operationClasses: ["analysis"],
      credentialHandle: null,
      grantedAt: new Date().toISOString(),
      revokedAt: null
    });
    expect(service.startOllamaAnalysis(source.id, {
      baseUrl: "https://ollama.example.com"
    })).toMatchObject({ state: "queued", provider: "local" });
    repository.db.close();
  });
});
