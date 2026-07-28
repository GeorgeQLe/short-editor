import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { z } from "zod";
import {
  OPENAI_ADAPTER_VERSION,
  OPENAI_ANALYSIS_PROMPT_VERSION,
  OPENAI_ANALYSIS_SCHEMA_VERSION,
  OPENAI_SPEECH_OPTIONS_VERSION,
  openAiAnalysisOptionsSchema,
  openAiSpeechOptionsSchema,
  type OpenAiAnalysisOptions,
  type OpenAiAnalysisResult,
  type OpenAiSpeechOptions,
  type OpenAiSpeechResult,
  type ProviderRequestMetadata,
  type TranscriptSegment
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import {
  episodeAnalysisJsonSchema,
  episodeAnalysisOutputSchema
} from "../core/local-analysis.js";

const API_BASE = "https://api.openai.com/v1";
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const CHUNK_SECONDS = 20 * 60;

type PreparedChunk = { path: string; offsetMs: number };
type HttpResult = {
  payload: unknown;
  requestId: string | null;
};

export interface OpenAiAdapterDependencies {
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
  prepareAudio: (inputPath: string, signal: AbortSignal) => Promise<{
    chunks: PreparedChunk[];
    cleanup: () => Promise<void>;
  }>;
  readText: (path: string) => Promise<string>;
}

const defaults: OpenAiAdapterDependencies = {
  fetch,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random: Math.random,
  prepareAudio: prepareAudioChunks,
  readText: (path) => readFile(path, "utf8")
};

export class OpenAiHttpAdapter {
  constructor(private readonly dependencies: OpenAiAdapterDependencies = defaults) {}

  async speech(input: {
    apiKey: string;
    inputPath: string;
    options: OpenAiSpeechOptions;
    signal: AbortSignal;
    authorize: () => Promise<boolean>;
    onProgress?: (progress: number, stage: string) => void;
  }): Promise<OpenAiSpeechResult> {
    const options = openAiSpeechOptionsSchema.parse(input.options);
    const prepared = await this.dependencies.prepareAudio(input.inputPath, input.signal);
    const rawChunks: Array<z.infer<ReturnType<typeof z.json>>> = [];
    const segments: TranscriptSegment[] = [];
    let language = "und";
    let requestId: string | null = null;
    try {
      for (let index = 0; index < prepared.chunks.length; index += 1) {
        const chunk = prepared.chunks[index]!;
        input.onProgress?.(
          0.1 + (index / prepared.chunks.length) * 0.8,
          `uploading audio chunk ${index + 1} of ${prepared.chunks.length}`
        );
        const bytes = await readFile(chunk.path);
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: "audio/mpeg" }), basename(chunk.path));
        form.append("model", options.modelId);
        if (options.mode === "diarization") {
          form.append("response_format", "diarized_json");
          form.append("chunking_strategy", "auto");
        } else {
          form.append("response_format", "verbose_json");
          form.append("timestamp_granularities[]", "segment");
          if (options.wordTimestamps) form.append("timestamp_granularities[]", "word");
        }
        const response = await this.postWithRetry(
          `${API_BASE}/audio/transcriptions`,
          input.apiKey,
          form,
          options.timeoutMs,
          input.signal,
          input.authorize
        );
        requestId ??= response.requestId;
        rawChunks.push(z.json().parse(response.payload));
        const normalized = normalizeSpeechChunk(
          response.payload,
          options,
          chunk.offsetMs,
          index
        );
        if (language === "und") language = normalized.language;
        segments.push(...normalized.segments);
      }
      if (!segments.length) {
        throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned an empty transcript", 422);
      }
      const createdAt = new Date().toISOString();
      const actualModel = returnedModel(rawChunks, options.modelId);
      if (actualModel !== options.modelId || rawChunks.some((chunk) =>
        chunk && typeof chunk === "object" &&
        typeof (chunk as { model?: unknown }).model === "string" &&
        (chunk as { model: string }).model !== options.modelId
      )) {
        throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned a different speech model", 422);
      }
      const metadata = requestMetadata(
        options.modelId,
        actualModel,
        requestId,
        OPENAI_SPEECH_OPTIONS_VERSION,
        null,
        null,
        createdAt
      );
      return {
        operation: "speech",
        mode: options.mode,
        language,
        segments,
        rawOutput: { chunks: rawChunks },
        provenance: provenance(metadata),
        requestMetadata: metadata
      };
    } finally {
      await prepared.cleanup();
    }
  }

  async analyze(input: {
    apiKey: string;
    inputPaths: string[];
    options: OpenAiAnalysisOptions;
    signal: AbortSignal;
    authorize: () => Promise<boolean>;
    onProgress?: (progress: number, stage: string) => void;
  }): Promise<OpenAiAnalysisResult> {
    const options = openAiAnalysisOptionsSchema.parse(input.options);
    input.onProgress?.(0.1, "reading approved analysis inputs");
    const inputs = await Promise.all(input.inputPaths.map((path) => this.dependencies.readText(path)));
    input.onProgress?.(0.25, "requesting strict structured analysis");
    const response = await this.postWithRetry(
      `${API_BASE}/responses`,
      input.apiKey,
      JSON.stringify({
        model: options.modelId,
        input: [
          {
            role: "system",
            content: "Analyze the approved episode transcript and visual samples. Return only the requested typed episode analysis."
          },
          {
            role: "user",
            content: inputs.join("\n\n")
          }
        ],
        temperature: options.temperature,
        text: {
          format: {
            type: "json_schema",
            name: "episode_analysis",
            strict: true,
            schema: episodeAnalysisJsonSchema
          }
        }
      }),
      options.timeoutMs,
      input.signal,
      input.authorize,
      "application/json"
    );
    const body = response.payload as Record<string, unknown>;
    if (body.status !== "completed") {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned incomplete analysis output", 422);
    }
    const content = responseContent(body);
    if (content.some((item) => item.type === "refusal")) {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI refused the structured analysis request", 422);
    }
    const outputText = content.find((item) => item.type === "output_text")?.text;
    if (typeof outputText !== "string") {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned no structured analysis output", 422);
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(outputText);
    } catch {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned malformed structured analysis JSON", 422);
    }
    const output = episodeAnalysisOutputSchema.safeParse(candidate);
    if (!output.success) {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI analysis output does not match the schema", 422);
    }
    const returned = typeof body.model === "string" ? body.model : options.modelId;
    if (returned !== options.modelId) {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned a different analysis model", 422);
    }
    const createdAt = new Date().toISOString();
    const metadata = requestMetadata(
      options.modelId,
      returned,
      response.requestId ?? (typeof body.id === "string" ? body.id : null),
      `${OPENAI_ANALYSIS_PROMPT_VERSION}+${OPENAI_ANALYSIS_SCHEMA_VERSION}`,
      OPENAI_ANALYSIS_PROMPT_VERSION,
      OPENAI_ANALYSIS_SCHEMA_VERSION,
      createdAt
    );
    input.onProgress?.(0.95, "validated strict structured analysis");
    return {
      operation: "analysis",
      schemaVersion: OPENAI_ANALYSIS_SCHEMA_VERSION,
      output: output.data,
      rawOutput: z.json().parse(response.payload),
      provenance: provenance(metadata),
      requestMetadata: metadata
    };
  }

  private async postWithRetry(
    url: string,
    apiKey: string,
    body: BodyInit,
    timeoutMs: number,
    cancellationSignal: AbortSignal,
    authorize: () => Promise<boolean>,
    contentType?: string
  ): Promise<HttpResult> {
    let lastRetryable = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (cancellationSignal.aborted) throw cancelled();
      if (!await authorize()) {
        throw new AppError("CLOUD_NOT_AUTHORIZED", "Cloud authorization was revoked", 403);
      }
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      const signal = AbortSignal.any([cancellationSignal, timeout.signal]);
      try {
        const response = await this.dependencies.fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(contentType ? { "Content-Type": contentType } : {})
          },
          body,
          signal
        });
        const payload = await safeJson(response);
        if (response.ok) {
          return { payload, requestId: response.headers.get("x-request-id") };
        }
        const retryable = response.status === 429 || retryableServerStatus(response.status);
        if (!retryable) {
          throw new AppError(
            "PROVIDER_UNAVAILABLE",
            `OpenAI request failed with HTTP ${response.status}`,
            503,
            undefined,
            false
          );
        }
        lastRetryable = true;
        if (attempt < 3) {
          await sleepWithCancellation(
            this.dependencies.sleep,
            retryDelay(response, attempt, this.dependencies.random),
            cancellationSignal
          );
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (cancellationSignal.aborted) throw cancelled();
        lastRetryable = true;
        if (attempt < 3) {
          await sleepWithCancellation(
            this.dependencies.sleep,
            backoff(attempt, this.dependencies.random),
            cancellationSignal
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "OpenAI is temporarily unavailable after three attempts",
      503,
      undefined,
      lastRetryable
    );
  }
}

export async function prepareAudioChunks(
  inputPath: string,
  signal: AbortSignal
): Promise<{ chunks: PreparedChunk[]; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "short-editor-openai-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const pattern = join(directory, "chunk-%04d.mp3");
    const segmentListPath = join(directory, "segment-list.csv");
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-i", inputPath,
      "-vn", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k",
      "-f", "segment", "-segment_time", String(CHUNK_SECONDS),
      "-segment_list", segmentListPath, "-segment_list_type", "csv",
      "-reset_timestamps", "1", pattern
    ], signal);
    const files = (await readdir(directory))
      .filter((name) => /^chunk-\d{4}\.mp3$/.test(name))
      .sort();
    if (!files.length) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "FFmpeg produced no upload audio", 503);
    }
    const offsets = new Map(
      (await readFile(segmentListPath, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const [fileName, start] = line.split(",");
        const seconds = Number(start);
        if (!fileName || !Number.isFinite(seconds) || seconds < 0) {
          throw new AppError("DEPENDENCY_UNAVAILABLE", "FFmpeg returned invalid chunk timing", 503);
        }
        return [basename(fileName.replace(/^"|"$/g, "")), Math.round(seconds * 1_000)] as const;
      })
    );
    const chunks: PreparedChunk[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const path = join(directory, files[index]!);
      if ((await stat(path)).size >= MAX_UPLOAD_BYTES) {
        throw new AppError("DEPENDENCY_UNAVAILABLE", "Prepared audio exceeds the provider upload limit", 503);
      }
      const offsetMs = offsets.get(files[index]!);
      if (offsetMs === undefined) {
        throw new AppError("DEPENDENCY_UNAVAILABLE", "FFmpeg omitted chunk timing", 503);
      }
      chunks.push({ path, offsetMs });
    }
    return { chunks, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function runFfmpeg(args: string[], signal: AbortSignal): Promise<void> {
  const binary = process.env.SHORT_EDITOR_FFMPEG ?? "ffmpeg";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    const cancel = () => child.kill();
    signal.addEventListener("abort", cancel, { once: true });
    child.once("error", () => reject(new AppError(
      "DEPENDENCY_UNAVAILABLE",
      "FFmpeg is unavailable for OpenAI audio preparation",
      503
    )));
    child.once("exit", (code) => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) reject(cancelled());
      else if (code === 0) resolve();
      else reject(new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "FFmpeg could not prepare upload audio",
        503
      ));
    });
  });
}

function normalizeSpeechChunk(
  value: unknown,
  options: OpenAiSpeechOptions,
  offsetMs: number,
  chunkIndex: number
): { language: string; segments: TranscriptSegment[] } {
  if (!value || typeof value !== "object") invalidSpeech();
  const body = value as Record<string, unknown>;
  const rawSegments = Array.isArray(body.segments) ? body.segments : [];
  const words = Array.isArray(body.words) ? body.words : [];
  const segments = rawSegments.map((raw, index): TranscriptSegment => {
    if (!raw || typeof raw !== "object") return invalidSpeech();
    const segment = raw as Record<string, unknown>;
    const startMs = secondsToMs(segment.start) + offsetMs;
    const endMs = secondsToMs(segment.end) + offsetMs;
    const text = requiredString(segment.text);
    const speaker = options.mode === "diarization"
      ? `chunk-${String(chunkIndex + 1).padStart(4, "0")}:${requiredString(segment.speaker)}`
      : null;
    const segmentWords = options.mode === "transcription" && options.wordTimestamps
      ? words.filter((word) => wordWithin(word, segment)).map((rawWord) => {
        const word = rawWord as Record<string, unknown>;
        return {
          startMs: secondsToMs(word.start) + offsetMs,
          endMs: secondsToMs(word.end) + offsetMs,
          text: requiredString(word.word ?? word.text)
        };
      })
      : [];
    return {
      id: randomUUID(),
      startMs,
      endMs,
      text,
      words: segmentWords,
      speaker,
      confidence: typeof segment.confidence === "number" ? segment.confidence : null
    };
  });
  return {
    language: typeof body.language === "string" && body.language.length >= 2 ? body.language : "und",
    segments
  };
}

function responseContent(body: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(body.output)) return [];
  return body.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as Record<string, unknown>).content;
    return Array.isArray(content)
      ? content.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
      : [];
  });
}

function requestMetadata(
  requestedModelId: string,
  returnedModelId: string,
  providerRequestId: string | null,
  optionsVersion: string,
  promptVersion: string | null,
  schemaVersion: string | null,
  createdAt: string
): ProviderRequestMetadata {
  return {
    providerRequestId,
    requestedModelId,
    returnedModelId,
    cloudClassification: "cloud",
    adapterVersion: OPENAI_ADAPTER_VERSION,
    promptVersion,
    schemaVersion,
    optionsVersion,
    createdAt
  };
}

function provenance(metadata: ProviderRequestMetadata) {
  return {
    provider: "openai",
    providerClass: "cloud" as const,
    modelId: metadata.returnedModelId,
    providerVersion: metadata.adapterVersion,
    optionsVersion: metadata.optionsVersion,
    providerRequestId: metadata.providerRequestId,
    requestedModelId: metadata.requestedModelId,
    returnedModelId: metadata.returnedModelId,
    adapterVersion: metadata.adapterVersion,
    promptVersion: metadata.promptVersion,
    schemaVersion: metadata.schemaVersion,
    createdAt: metadata.createdAt
  };
}

function returnedModel(chunks: unknown[], fallback: string): string {
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object" && typeof (chunk as { model?: unknown }).model === "string") {
      return (chunk as { model: string }).model;
    }
  }
  return fallback;
}

function retryableServerStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelay(response: Response, attempt: number, random: () => number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.min(10_000, Math.max(0, dateDelay));
  }
  return backoff(attempt, random);
}

function backoff(attempt: number, random: () => number): number {
  return Math.min(10_000, 250 * 2 ** (attempt - 1) + Math.floor(random() * 100));
}

async function sleepWithCancellation(
  sleep: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw cancelled();
  let cancel!: () => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(cancelled());
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    await Promise.race([sleep(milliseconds), cancellation]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function secondsToMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return invalidSpeech();
  return Math.round(value * 1_000);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return invalidSpeech();
  return value.trim();
}

function wordWithin(word: unknown, segment: Record<string, unknown>): boolean {
  if (!word || typeof word !== "object") return false;
  const candidate = word as Record<string, unknown>;
  return typeof candidate.start === "number" && typeof candidate.end === "number" &&
    typeof segment.start === "number" && typeof segment.end === "number" &&
    candidate.start >= segment.start && candidate.end <= segment.end;
}

function invalidSpeech(): never {
  throw new AppError("PROVIDER_OUTPUT_INVALID", "OpenAI returned malformed speech output", 422);
}

function cancelled(): AppError {
  return new AppError("JOB_CANCELLED", "OpenAI operation was cancelled", 409);
}
