import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { analysisCacheIdentity, canonicalJson } from "../src/core/analysis-cache";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { ProcessOpenAiProvider } from "../src/core/openai-provider";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import type {
  AnalysisArtifact,
  OpenAiBridgeRequest,
  OpenAiSpeechResult
} from "../src/shared/domain";
import { episode } from "./factories";

const servers: Array<{ close(callback?: () => void): unknown }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

const createdAt = new Date().toISOString();
const speechResult: OpenAiSpeechResult = {
  operation: "speech",
  mode: "transcription",
  language: "en",
  segments: [{
    id: randomUUID(),
    startMs: 0,
    endMs: 1_000,
    text: "Accepted provider transcript.",
    words: [],
    speaker: null,
    confidence: null
  }],
  rawOutput: {
    chunks: [{
      model: "whisper-1",
      language: "en",
      segments: [{ start: 0, end: 1, text: "Accepted provider transcript." }]
    }]
  },
  provenance: {
    provider: "openai",
    providerClass: "cloud",
    modelId: "whisper-1",
    providerVersion: "openai-http-v1",
    optionsVersion: "openai-speech-v1",
    providerRequestId: "req-1",
    requestedModelId: "whisper-1",
    returnedModelId: "whisper-1",
    adapterVersion: "openai-http-v1",
    promptVersion: null,
    schemaVersion: null,
    createdAt
  },
  requestMetadata: {
    providerRequestId: "req-1",
    requestedModelId: "whisper-1",
    returnedModelId: "whisper-1",
    cloudClassification: "cloud",
    adapterVersion: "openai-http-v1",
    promptVersion: null,
    schemaVersion: null,
    optionsVersion: "openai-speech-v1",
    createdAt
  }
};

function setup() {
  const repository = new Repository(openDatabase(":memory:"));
  const source = episode({ status: "ready", contentHash: "a".repeat(64) });
  repository.insertEpisode(source);
  const handles = new Set<string>();
  const jobs = new JobQueue(repository, (handle) => handles.has(handle));
  const service = new CoreService(
    repository,
    {} as never,
    jobs,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    handles
  );
  return { repository, source, handles, jobs, service };
}

function authorize(
  service: CoreService,
  sourceId: string,
  handle: string,
  operationClasses: Array<"transcription" | "analysis">
) {
  service.synchronizeCredentialHandles([handle]);
  return service.grantCloudAuthorization({
    scopeType: "project",
    scopeId: sourceId,
    provider: "openai",
    operationClasses,
    credentialHandle: handle,
    dataDescription: "Approved episode inputs",
    networkUseConfirmed: true,
    costsConfirmed: true
  });
}

describe("OpenAI core authorization and artifact policy", () => {
  it("uses explicit speech modes and separate analysis authorization", () => {
    const { repository, source, service } = setup();
    const handle = `credential:${randomUUID()}`;
    authorize(service, source.id, handle, ["transcription"]);

    const speech = service.startAnalysis(source.id, "openai", {
      speechMode: "diarization"
    });
    const row = repository.db.prepare("SELECT payload_json FROM jobs WHERE id=?")
      .get(speech.id) as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({
      operation: "transcription",
      credentialHandle: handle,
      options: {
        mode: "diarization",
        modelId: "gpt-4o-transcribe-diarize",
        wordTimestamps: false
      }
    });

    repository.replaceTranscriptWithProvenance(
      source.id,
      speechResult.segments,
      "en",
      speechResult.provenance
    );
    expect(() => service.startOpenAiAnalysis(source.id, {
      modelId: "gpt-5-mini"
    })).toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));
    repository.db.close();
  });

  it("reports structured analysis as unconfigured without an exact model", () => {
    const { repository, source, service } = setup();
    const handle = `credential:${randomUUID()}`;
    authorize(service, source.id, handle, ["analysis"]);
    repository.replaceTranscriptWithProvenance(
      source.id,
      speechResult.segments,
      "en",
      speechResult.provenance
    );
    const original = process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL;
    delete process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL;
    try {
      expect(() => service.startOpenAiAnalysis(source.id))
        .toThrow(expect.objectContaining({ code: "DEPENDENCY_UNAVAILABLE" }));
    } finally {
      if (original === undefined) delete process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL;
      else process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL = original;
    }
    repository.db.close();
  });

  it("stores raw speech separately from its accepted projection and revision", () => {
    const { repository, source, service } = setup();
    const revision = service.storeOpenAiSpeech(
      source.id,
      speechResult,
      service.openAiSpeechInputHash(source.id, {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false
      })
    );
    const artifact = repository.listAnalysisArtifacts(source.id)[0]!;
    expect(revision.acceptedState).toBe("accepted");
    expect(artifact).toMatchObject({
      kind: "transcript",
      state: "accepted",
      rawOutput: {
        providerOutput: speechResult.rawOutput,
        requestMetadata: speechResult.requestMetadata
      },
      acceptedProjection: {
        transcriptRevisionId: revision.id,
        revision: revision.revision,
        segments: speechResult.segments
      }
    });
    repository.db.close();
  });

  it("computes provider status locally without exposing credential handles", async () => {
    const { repository, source, service } = setup();
    const handle = `credential:${randomUUID()}`;
    authorize(service, source.id, handle, ["transcription"]);
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");
    const base = `http://127.0.0.1:${address.port}/v1`;

    const capabilities = await (await fetch(`${base}/providers/capabilities`)).json();
    const status = await (await fetch(`${base}/providers/status?episodeId=${source.id}`)).json();
    expect(capabilities.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai", operations: expect.arrayContaining(["diarization"]) })
    ]));
    expect(status.data.find((item: { provider: string }) => item.provider === "openai")).toMatchObject({
      provider: "openai",
      credentialConfigured: true,
      authorization: { transcription: true, analysis: false }
    });
    expect(JSON.stringify(status)).not.toContain(handle);
    repository.db.close();
  });
});

describe("OpenAI core response validation", () => {
  it("rejects a returned model that differs from the requested model", async () => {
    class FakeIpc extends EventEmitter {
      sent?: OpenAiBridgeRequest;
      send(message: { payload: OpenAiBridgeRequest }, callback?: (error: Error | null) => void) {
        this.sent = message.payload;
        callback?.(null);
        queueMicrotask(() => this.emit("message", {
          channel: "short-editor:openai",
          payload: {
            type: "result",
            requestId: this.sent!.requestId,
            jobId: this.sent!.jobId,
            result: {
              ...speechResult,
              requestMetadata: {
                ...speechResult.requestMetadata,
                returnedModelId: "different-model"
              }
            }
          }
        }));
        return true;
      }
    }
    const ipc = new FakeIpc();
    const provider = new ProcessOpenAiProvider(ipc as never);
    await expect(provider.speech(
      randomUUID(),
      `credential:${randomUUID()}`,
      "/episode.mp4",
      {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      {
        scopeType: "project",
        scopeId: randomUUID(),
        operationClass: "transcription"
      }
    )).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
  });

  it("rejects an Electron response correlated to a different job", async () => {
    class FakeIpc extends EventEmitter {
      send(message: { payload: OpenAiBridgeRequest }, callback?: (error: Error | null) => void) {
        callback?.(null);
        queueMicrotask(() => this.emit("message", {
          channel: "short-editor:openai",
          payload: {
            type: "result",
            requestId: message.payload.requestId,
            jobId: randomUUID(),
            result: speechResult
          }
        }));
        return true;
      }
    }
    const provider = new ProcessOpenAiProvider(new FakeIpc() as never);
    await expect(provider.speech(
      randomUUID(),
      `credential:${randomUUID()}`,
      "/episode.mp4",
      {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      {
        scopeType: "project",
        scopeId: randomUUID(),
        operationClass: "transcription"
      }
    )).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
  });
});

describe("central analysis cache identity and winner selection", () => {
  it("is canonical and changes for every output-affecting identity field", () => {
    const base = {
      sourceHash: "sha256:source",
      transcriptId: randomUUID(),
      transcriptRevision: 1,
      provider: "openai",
      modelId: "gpt-5-mini",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      visualSamplingVersion: "visual-v1",
      visualOptions: { maximumSamples: 50, intervalMs: 2_000 },
      outputOptions: { temperature: 0 }
    };
    const first = analysisCacheIdentity(base);
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } }))
      .toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(analysisCacheIdentity({
      ...base,
      visualOptions: { intervalMs: 2_000, maximumSamples: 50 }
    })).toBe(first);
    for (const changed of [
      { ...base, sourceHash: "sha256:other" },
      { ...base, transcriptId: randomUUID() },
      { ...base, transcriptRevision: 2 },
      { ...base, provider: "ollama" },
      { ...base, modelId: "gpt-5" },
      { ...base, promptVersion: "prompt-v2" },
      { ...base, schemaVersion: "schema-v2" },
      { ...base, visualSamplingVersion: "visual-v2" },
      { ...base, visualOptions: { intervalMs: 1_000, maximumSamples: 50 } },
      { ...base, outputOptions: { temperature: 0.5 } }
    ]) {
      expect(analysisCacheIdentity(changed)).not.toBe(first);
    }
  });

  it("selects one successful artifact for concurrent-equivalent writes", async () => {
    const { repository, source } = setup();
    const artifact = (id: string): AnalysisArtifact => ({
      id,
      entityId: source.id,
      ownerType: "episode",
      kind: "episode_analysis",
      state: "proposed",
      provenance: speechResult.provenance,
      inputHash: "sha256:exact",
      rawOutput: { typedOutput: { summary: "same" } },
      acceptedProjection: null,
      createdAt
    });
    const [left, right] = await Promise.all([
      Promise.resolve().then(() => repository.insertAnalysisArtifactWinner(artifact(randomUUID()))),
      Promise.resolve().then(() => repository.insertAnalysisArtifactWinner(artifact(randomUUID())))
    ]);
    expect(right.id).toBe(left.id);
    expect(repository.listAnalysisArtifacts(source.id)).toHaveLength(1);
    repository.db.close();
  });
});
