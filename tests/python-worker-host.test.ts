import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  PythonWorkerSupervisor,
  developmentPythonWorkerLaunch
} from "../src/core/python-worker-supervisor";

const supervisors: PythonWorkerSupervisor[] = [];

afterEach(async () => {
  await Promise.allSettled(supervisors.splice(0).map((instance) => instance.stop()));
});

describe("development Python worker host", () => {
  it("starts, reports intentionally missing provider dependencies, and shuts down", async () => {
    const instance = new PythonWorkerSupervisor({
      launch: developmentPythonWorkerLaunch(process.cwd()),
      coreVersion: "test",
      startupTimeoutMs: 2_000,
      shutdownGraceMs: 500,
      maximumRestarts: 0
    });
    supervisors.push(instance);
    await expect(instance.start()).resolves.toMatchObject({
      workerVersion: "0.1.0",
      status: { state: "degraded" }
    });
    expect(await instance.capabilities()).toHaveLength(4);
    await expect(instance.runJob(randomUUID(), {
      kind: "transcription",
      sourcePath: "/not/read/by-this-host.mp4",
      modelId: "small.en",
      language: "en",
      wordTimestamps: true
    })).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: true
    });
    await instance.stop();
    expect(instance.state).toBe("stopped");
  });
});
