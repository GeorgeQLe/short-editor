import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OpenAiHttpAdapter } from "../src/electron/openai-adapter";
import type { OpenAiAdapterDependencies } from "../src/electron/openai-adapter";

const analysisOutput = {
  summary: "A complete typed analysis.",
  topics: ["editing"],
  highlights: [{
    startMs: 0,
    endMs: 2_000,
    title: "Strong opening",
    reason: "Self-contained idea",
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

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function dependencies(
  fetchImplementation: OpenAiAdapterDependencies["fetch"],
  chunks = [{ path: "package.json", offsetMs: 0 }]
) {
  const cleanup = vi.fn(async () => undefined);
  const sleep = vi.fn(async () => undefined);
  const authorize = vi.fn(async () => true);
  return {
    adapter: new OpenAiHttpAdapter({
      fetch: fetchImplementation,
      sleep,
      random: () => 0,
      prepareAudio: async () => ({ chunks, cleanup }),
      readText: async (path) => path.includes("transcript")
        ? JSON.stringify({ segments: [{ text: "Approved transcript" }] })
        : JSON.stringify({ samples: [{ activity: 0.5 }] })
    }),
    cleanup,
    sleep,
    authorize
  };
}

describe("OpenAI speech adapter", () => {
  it("requests verbose transcription and normalizes optional word timings", async () => {
    const requests: RequestInit[] = [];
    const { adapter, cleanup, authorize } = dependencies(
      (async (_url, init) => {
        requests.push(init!);
        return response({
          model: "whisper-1",
          language: "en",
          segments: [{ start: 0, end: 2, text: "Hello world." }],
          words: [
            { start: 0, end: 0.8, word: "Hello" },
            { start: 0.8, end: 2, word: "world." }
          ]
        }, 200, { "x-request-id": "req-speech" });
      }) as typeof fetch
    );
    const result = await adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: true,
        timeoutMs: 10_000
      },
      signal: new AbortController().signal,
      authorize
    });

    expect(result).toMatchObject({
      mode: "transcription",
      language: "en",
      requestMetadata: {
        providerRequestId: "req-speech",
        requestedModelId: "whisper-1",
        returnedModelId: "whisper-1"
      }
    });
    expect(result.segments[0]).toMatchObject({
      startMs: 0,
      endMs: 2_000,
      speaker: null,
      words: [
        { startMs: 0, endMs: 800, text: "Hello" },
        { startMs: 800, endMs: 2_000, text: "world." }
      ]
    });
    const form = requests[0]!.body as FormData;
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["segment", "word"]);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("offsets multi-chunk diarization and namespaces speakers per request", async () => {
    let call = 0;
    const forms: FormData[] = [];
    const { adapter } = dependencies(
      (async (_url, init) => {
        forms.push(init!.body as FormData);
        call += 1;
        return response({
          model: "gpt-4o-transcribe-diarize",
          language: "en",
          segments: [{ start: 0, end: 1, text: `Chunk ${call}`, speaker: "A" }]
        });
      }) as typeof fetch,
      [
        { path: "package.json", offsetMs: 0 },
        { path: "package.json", offsetMs: 1_200_000 }
      ]
    );
    const result = await adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "diarization",
        modelId: "gpt-4o-transcribe-diarize",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      signal: new AbortController().signal,
      authorize: async () => true
    });

    expect(result.segments).toMatchObject([
      { startMs: 0, endMs: 1_000, speaker: "chunk-0001:A", words: [] },
      { startMs: 1_200_000, endMs: 1_201_000, speaker: "chunk-0002:A", words: [] }
    ]);
    expect(forms.every((form) =>
      form.get("response_format") === "diarized_json" &&
      form.get("chunking_strategy") === "auto" &&
      form.getAll("timestamp_granularities[]").length === 0
    )).toBe(true);
  });

  it("cleans temporary chunks and rejects empty output", async () => {
    const { adapter, cleanup } = dependencies(
      (async () => response({ model: "whisper-1", language: "en", segments: [] })) as typeof fetch
    );
    await expect(adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      signal: new AbortController().signal,
      authorize: async () => true
    })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("OpenAI structured analysis adapter", () => {
  it("uses strict Responses JSON Schema and preserves raw typed output", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const { adapter } = dependencies(
      (async (_url, init) => {
        requestBody = JSON.parse(String(init!.body));
        return response({
          id: "resp-1",
          status: "completed",
          model: "gpt-5-mini",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(analysisOutput) }]
          }]
        }, 200, { "x-request-id": "req-analysis" });
      }) as typeof fetch
    );
    const result = await adapter.analyze({
      apiKey: "test-secret",
      inputPaths: ["/transcript.json", "/visual.json"],
      options: {
        modelId: "gpt-5-mini",
        timeoutMs: 10_000,
        temperature: 0,
        visual: { intervalMs: 2_000, maximumSamples: 50 }
      },
      signal: new AbortController().signal,
      authorize: async () => true
    });

    expect(result.output).toEqual(analysisOutput);
    expect(result.rawOutput).toMatchObject({ id: "resp-1", status: "completed" });
    expect(requestBody).toMatchObject({
      model: "gpt-5-mini",
      text: {
        format: {
          type: "json_schema",
          name: "episode_analysis",
          strict: true
        }
      }
    });
  });

  it.each([
    [{ status: "incomplete", model: "gpt-5-mini", output: [] }, "incomplete"],
    [{
      status: "completed",
      model: "gpt-5-mini",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }]
    }, "refused"],
    [{
      status: "completed",
      model: "gpt-5-mini",
      output: [{ type: "message", content: [{ type: "output_text", text: "{" }] }]
    }, "malformed"],
    [{
      status: "completed",
      model: "different-model",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysisOutput) }] }]
    }, "different"]
  ])("rejects %s provider output as invalid", async (body, _label) => {
    const { adapter } = dependencies((async () => response(body)) as typeof fetch);
    await expect(adapter.analyze({
      apiKey: "test-secret",
      inputPaths: ["/transcript.json"],
      options: {
        modelId: "gpt-5-mini",
        timeoutMs: 10_000,
        temperature: 0,
        visual: { intervalMs: 2_000, maximumSamples: 50 }
      },
      signal: new AbortController().signal,
      authorize: async () => true
    })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
  });
});

describe("OpenAI retry, authorization, and cancellation policy", () => {
  it("retries 429 three total attempts, honors bounded Retry-After, and rechecks authorization", async () => {
    const fetchMock = vi.fn(async () => response(
      { error: { message: "rate limited" } },
      429,
      { "retry-after": "30" }
    ));
    const { adapter, sleep, authorize } = dependencies(fetchMock as typeof fetch);
    await expect(adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      signal: new AbortController().signal,
      authorize
    })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it("does not retry non-retryable 4xx responses", async () => {
    const fetchMock = vi.fn(async () => response({}, 400));
    const { adapter, sleep } = dependencies(fetchMock as typeof fetch);
    await expect(adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      signal: new AbortController().signal,
      authorize: async () => true
    })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops before a retry when authorization is revoked", async () => {
    const fetchMock = vi.fn(async () => response({}, 503));
    let checks = 0;
    const { adapter } = dependencies(fetchMock as typeof fetch);
    await expect(adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      signal: new AbortController().signal,
      authorize: async () => ++checks === 1
    })).rejects.toMatchObject({ code: "CLOUD_NOT_AUTHORIZED" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps cancellation without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    const { adapter } = dependencies(fetchMock as unknown as typeof fetch);
    await expect(adapter.speech({
      apiKey: "test-secret",
      inputPath: "/episode.mp4",
      options: {
        mode: "transcription",
        modelId: "whisper-1",
        wordTimestamps: false,
        timeoutMs: 10_000
      },
      signal: controller.signal,
      authorize: async () => true
    })).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
