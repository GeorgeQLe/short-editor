import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PythonWorkerSupervisor,
  assertCredentialFreeLaunch
} from "../src/core/python-worker-supervisor";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "python-worker-fixture.mjs");
const supervisors: PythonWorkerSupervisor[] = [];

function supervisor(mode = "normal", overrides: Record<string, unknown> = {}) {
  const instance = new PythonWorkerSupervisor({
    launch: { command: process.execPath, args: [fixture, mode] },
    coreVersion: "test",
    startupTimeoutMs: 500,
    heartbeatTimeoutMs: 250,
    jobTimeoutMs: 500,
    cancellationGraceMs: 100,
    shutdownGraceMs: 100,
    maximumRestarts: 0,
    ...overrides
  });
  supervisors.push(instance);
  return instance;
}

const transcription = {
  kind: "transcription" as const,
  sourcePath: "/media/source.mp4",
  modelId: "fixture",
  language: "en" as const,
  wordTimestamps: true
};

afterEach(async () => {
  await Promise.allSettled(supervisors.splice(0).map((instance) => instance.stop()));
});

describe("PythonWorkerSupervisor", () => {
  it("handshakes, reports capability/status, validates results, and forwards progress", async () => {
    const instance = supervisor();
    const snapshot = await instance.start();
    expect(snapshot.workerVersion).toBe("fixture-1");
    expect(snapshot.capabilities).toHaveLength(4);
    expect((await instance.capabilities())[0]).toMatchObject({
      operation: "transcription",
      available: true
    });
    expect(await instance.status()).toMatchObject({ state: "ready" });
    const progress: Array<[number, string]> = [];
    const result = await instance.runJob(randomUUID(), transcription, (value, stage) => {
      progress.push([value, stage]);
    });
    expect(progress).toEqual([[0.5, "working"]]);
    expect(result).toMatchObject({ kind: "transcription", diarization: "absent" });
  });

  it.each(["malformed", "partial", "wrong-version"])(
    "maps %s startup output to PROVIDER_OUTPUT_INVALID",
    async (mode) => {
      await expect(supervisor(mode).start()).rejects.toMatchObject({
        code: "PROVIDER_OUTPUT_INVALID"
      });
    }
  );

  it("maps a missing runtime to DEPENDENCY_UNAVAILABLE", async () => {
    const instance = supervisor("normal", {
      launch: { command: join(here, "definitely-missing-python"), args: [] }
    });
    await expect(instance.start()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: true
    });
  });

  it("rejects oversized results before parsing or storage", async () => {
    const instance = supervisor("oversize", { maxFrameBytes: 1024 });
    await instance.start();
    await expect(instance.runJob(randomUUID(), transcription)).rejects.toMatchObject({
      code: "PROVIDER_OUTPUT_INVALID"
    });
  });

  it("maps a crash and heartbeat timeout to recoverable provider failures", async () => {
    const crashed = supervisor("crash");
    await crashed.start();
    await expect(crashed.runJob(randomUUID(), transcription)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true
    });

    const silent = supervisor("no-heartbeat", { heartbeatTimeoutMs: 60 });
    await silent.start();
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(silent.state).toBe("stopped");
  });

  it("restarts a crashed worker within the configured bound", async () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-worker-restart-"));
    const marker = join(directory, "crashed");
    try {
      const instance = supervisor("crash-once", {
        launch: { command: process.execPath, args: [fixture, "crash-once", marker] },
        maximumRestarts: 1
      });
      await instance.start();
      await expect(instance.runJob(randomUUID(), transcription)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE"
      });
      const deadline = Date.now() + 1_000;
      while (instance.state !== "ready" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(instance.state).toBe("ready");
      await expect(instance.runJob(randomUUID(), transcription)).resolves.toMatchObject({
        kind: "transcription"
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("times out a hung job and returns a retryable provider error", async () => {
    const instance = supervisor("hang", { jobTimeoutMs: 60 });
    await instance.start();
    await expect(instance.runJob(randomUUID(), transcription)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true
    });
  });

  it("bounds cancellation and restarts a worker that will not acknowledge it", async () => {
    const instance = supervisor("hang");
    await instance.start();
    const jobId = randomUUID();
    const result = instance.runJob(jobId, transcription);
    await expect(instance.cancel(jobId)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(result).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("rejects credentials in process arguments and keeps the worker SQLite-free", () => {
    expect(() => assertCredentialFreeLaunch({
      command: "python",
      args: ["worker.py", "--api-key=sk-sensitive"]
    })).toThrowError(/credentials/i);
    const workerSource = readFileSync(join(here, "..", "resources", "worker", "worker.py"), "utf8");
    expect(workerSource).not.toMatch(/^\s*(?:import|from)\s+sqlite3?\b/im);
    expect(workerSource).not.toContain("short-editor.db");
  });

  it("fully redacts worker stderr before exposing diagnostics", async () => {
    const diagnostics: string[] = [];
    const instance = supervisor("stderr", {
      onDiagnostic: (message: string) => diagnostics.push(message)
    });
    await instance.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(diagnostics).toEqual(["[python worker stderr redacted]"]);
    expect(JSON.stringify(diagnostics)).not.toContain("sk-sensitive");
    expect(JSON.stringify(diagnostics)).not.toContain("/private/");
  });
});
