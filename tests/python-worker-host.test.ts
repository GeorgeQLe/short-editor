import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PythonWorkerSupervisor,
  developmentPythonWorkerLaunch
} from "../src/core/python-worker-supervisor";

const here = dirname(fileURLToPath(import.meta.url));
const supervisors: PythonWorkerSupervisor[] = [];
const directories: string[] = [];

function host(modelInstalled = true) {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-whisper-"));
  directories.push(directory);
  if (modelInstalled) {
    mkdirSync(join(directory, "fixture"), { recursive: true });
    writeFileSync(join(directory, "fixture", "model.bin"), "fixture");
  }
  const launch = developmentPythonWorkerLaunch(process.cwd());
  launch.env = {
    ...process.env,
    PYTHONPATH: [
      join(here, "fixtures", "python"),
      process.env.PYTHONPATH
    ].filter(Boolean).join(delimiter),
    SHORT_EDITOR_WHISPER_MODEL_DIR: directory,
    SHORT_EDITOR_WHISPER_MODEL_IDS: "fixture"
  };
  const instance = new PythonWorkerSupervisor({
    launch,
    coreVersion: "test",
    startupTimeoutMs: 2_000,
    cancellationGraceMs: 1_000,
    shutdownGraceMs: 500,
    maximumRestarts: 0
  });
  supervisors.push(instance);
  return instance;
}

function transcription(source = "normal.wav", wordTimestamps = true) {
  return {
    kind: "transcription" as const,
    sourcePath: join("/fixture", source),
    modelId: "fixture",
    language: "en" as const,
    wordTimestamps
  };
}

afterEach(async () => {
  await Promise.allSettled(supervisors.splice(0).map((instance) => instance.stop()));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("development Python faster-whisper host", () => {
  it("transcribes under a network deny and returns normalized timing, progress, and provenance", async () => {
    const instance = host();
    await expect(instance.start()).resolves.toMatchObject({
      workerVersion: "0.2.0",
      status: { state: "ready" }
    });
    expect(await instance.capabilities()).toContainEqual({
      operation: "transcription",
      available: true,
      providers: ["faster-whisper"],
      features: ["english", "segments", "word-timestamps", "no-diarization"]
    });
    const progress: string[] = [];
    const result = await instance.runJob(
      randomUUID(),
      transcription(),
      (_value, stage) => progress.push(stage)
    );
    expect(progress).toContain("loading local transcription model");
    expect(result).toMatchObject({
      kind: "transcription",
      language: "en",
      diarization: "absent",
      provenance: {
        provider: "faster-whisper",
        providerClass: "local",
        modelId: "fixture",
        optionsVersion: "transcription-v1"
      },
      segments: [
        { startMs: 0, endMs: 2_000, text: "Hello world." },
        { startMs: 2_000, endMs: 4_000, text: "Second thought." }
      ]
    });
    if (result.kind !== "transcription") throw new Error("Unexpected result");
    expect(result.words).toEqual([
      { startMs: 0, endMs: 800, text: "Hello", confidence: 0.95 },
      { startMs: 800, endMs: 2_000, text: "world.", confidence: 0.85 },
      { startMs: 2_000, endMs: 2_800, text: "Second", confidence: 0.8 },
      { startMs: 2_800, endMs: 4_000, text: "thought.", confidence: 0.75 }
    ]);
  });

  it("represents unavailable words and explicit absence of diarization", async () => {
    const result = await host().runJob(randomUUID(), transcription("normal.wav", false));
    expect(result).toMatchObject({ kind: "transcription", words: null, diarization: "absent" });
  });

  it("returns an actionable non-retryable missing-model failure without fallback", async () => {
    const instance = host(false);
    await expect(instance.start()).resolves.toMatchObject({ status: { state: "degraded" } });
    await expect(instance.runJob(randomUUID(), transcription())).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: false
    });
  });

  it("returns silence, rejects unsupported audio, and acknowledges cancellation", async () => {
    const instance = host();
    const silence = await instance.runJob(randomUUID(), transcription("silence.wav"));
    expect(silence).toMatchObject({ kind: "transcription", segments: [], words: [] });

    await expect(
      instance.runJob(randomUUID(), transcription("unsupported.wav"))
    ).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });

    const jobId = randomUUID();
    const running = instance.runJob(jobId, transcription("slow.wav"));
    const cancelled = expect(running).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await instance.cancel(jobId);
    await cancelled;
  });

  it("keeps the worker SQLite-free and does not contain network clients", () => {
    const source = readFileSync(join(here, "..", "resources", "worker", "worker.py"), "utf8");
    expect(source).not.toMatch(/^\s*(?:import|from)\s+sqlite3?\b/im);
    expect(source).not.toContain("short-editor.db");
    expect(source).not.toMatch(/^\s*(?:import|from)\s+(?:requests|urllib|httpx|aiohttp)\b/im);
    expect(source).toContain("local_files_only=True");
  });
});
