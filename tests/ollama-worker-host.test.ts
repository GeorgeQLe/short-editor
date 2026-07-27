import { randomUUID } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PythonWorkerSupervisor,
  developmentPythonWorkerLaunch
} from "../src/core/python-worker-supervisor";

const supervisors: PythonWorkerSupervisor[] = [];
const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
}

function host(extraEnvironment: NodeJS.ProcessEnv = {}) {
  const launch = developmentPythonWorkerLaunch(process.cwd());
  launch.env = { ...process.env, ...extraEnvironment };
  const instance = new PythonWorkerSupervisor({
    launch,
    coreVersion: "test",
    startupTimeoutMs: 2_000,
    jobTimeoutMs: 3_000,
    maximumRestarts: 0
  });
  supervisors.push(instance);
  return instance;
}

function output() {
  return {
    summary: "Local analysis",
    topics: ["testing"],
    highlights: [{
      startMs: 0,
      endMs: 1_000,
      title: "Test",
      reason: "Typed",
      scores: {
        hook: 0.5,
        coherence: 0.5,
        payoff: 0.5,
        independence: 0.5,
        delivery: 0.5,
        visualActivity: 0.5
      }
    }]
  };
}

function providerJob(baseUrl: string, maximumEndpointClass = "local", cloudConsent = false) {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-ollama-input-"));
  directories.push(directory);
  const inputPath = join(directory, "input.json");
  writeFileSync(inputPath, JSON.stringify({ transcript: "Local input" }));
  return {
    kind: "provider_call" as const,
    provider: "ollama",
    modelId: "fixture-model",
    credentialHandle: null,
    operation: "analysis" as const,
    inputArtifactPaths: [inputPath],
    schemaVersion: "episode-analysis-schema-v1",
    options: {
      baseUrl,
      endpointClass: "local",
      maximumEndpointClass,
      networkConsent: false,
      cloudConsent,
      timeoutMs: 1_000,
      temperature: 0,
      promptVersion: "episode-analysis-prompt-v1",
      outputSchema: { type: "object" }
    }
  };
}

afterEach(async () => {
  await Promise.allSettled(supervisors.splice(0).map((item) => item.stop()));
  await Promise.allSettled(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("development Ollama worker adapter", () => {
  it("discovers the configured endpoint and returns typed structured output", async () => {
    let posted = false;
    const baseUrl = await listen((request, response) => {
      if (request.url === "/api/version") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ version: "fixture-1" }));
        return;
      }
      if (request.url === "/api/generate" && request.method === "POST") {
        posted = true;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ response: JSON.stringify(output()) }));
        return;
      }
      if (request.url === "/api/tags") {
        response.end(JSON.stringify({
          models: [{
            model: "fixture-model",
            size: 123,
            details: { family: "fixture" }
          }]
        }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    const instance = host();
    const result = await instance.runJob(randomUUID(), providerJob(baseUrl));
    expect(posted).toBe(true);
    expect(result).toMatchObject({
      kind: "provider_call",
      schemaVersion: "episode-analysis-schema-v1",
      output: output(),
      provenance: {
        provider: "ollama",
        providerClass: "local",
        modelId: "fixture-model",
        providerVersion: "fixture-1"
      }
    });
    const capabilitiesJob = {
      ...providerJob(baseUrl),
      operation: "capabilities" as const,
      inputArtifactPaths: [],
      schemaVersion: "ollama-capabilities-v1"
    };
    await expect(instance.runJob(randomUUID(), capabilitiesJob)).resolves.toMatchObject({
      output: {
        models: [{ modelId: "fixture-model", size: 123, family: "fixture" }]
      }
    });
  });

  it("maps unavailable and malformed provider responses without fallback", async () => {
    await expect(host().runJob(
      randomUUID(),
      providerJob("http://127.0.0.1:1")
    )).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });

    const baseUrl = await listen((request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(request.url === "/api/version"
        ? JSON.stringify({ version: "fixture-1" })
        : JSON.stringify({ response: "{bad json" }));
    });
    await expect(host().runJob(
      randomUUID(),
      providerJob(baseUrl)
    )).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID", retryable: false });
  });

  it("maps an Ollama request timeout to a retryable unavailable error", async () => {
    const baseUrl = await listen((_request, _response) => {
      // Intentionally leave the capability request unanswered.
    });
    await expect(host().runJob(
      randomUUID(),
      providerJob(baseUrl)
    )).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("reclassifies redirects before transmitting analysis data and preserves stricter policy", async () => {
    let posted = false;
    const redirector = await listen((_request, response) => {
      response.statusCode = 307;
      response.setHeader("Location", "https://ollama.example.com/api/version");
      response.end();
    });
    await expect(host().runJob(
      randomUUID(),
      providerJob(redirector)
    )).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(posted).toBe(false);

    const local = await listen((request, response) => {
      if (request.url === "/api/version") {
        response.end(JSON.stringify({ version: "fixture-1" }));
      } else {
        posted = true;
        response.end(JSON.stringify({ response: JSON.stringify(output()) }));
      }
    });
    await expect(host().runJob(
      randomUUID(),
      providerJob(local, "cloud", false)
    )).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(posted).toBe(false);
    const result = await host().runJob(
      randomUUID(),
      providerJob(local, "cloud", true)
    );
    expect(result).toMatchObject({ provenance: { providerClass: "cloud" } });
    expect(posted).toBe(true);
  });

  it.each([
    ["no-face", 0, false],
    ["multi-face", 2, false],
    ["screen-share", 1, true]
  ])("returns deterministic %s visual detections", async (fixtureId, faceCount, screenShare) => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-visual-fixtures-"));
    directories.push(directory);
    writeFileSync(join(directory, `${fixtureId}.json`), JSON.stringify({
      capabilities: {
        activity: "supported",
        speakerFraming: "supported",
        faceDetection: "supported",
        screenShareDetection: "supported"
      },
      samples: [{
        atMs: 0,
        activity: 0.4,
        speakerFraming: faceCount ? 0.8 : null,
        faceCount,
        screenShare
      }]
    }));
    const result = await host({
      SHORT_EDITOR_VISUAL_FIXTURE_DIR: directory
    }).runJob(randomUUID(), {
      kind: "visual_sampling",
      sourcePath: "/fixture.mp4",
      intervalMs: 1_000,
      maximumSamples: 10,
      fixtureId
    });
    expect(result).toMatchObject({
      kind: "visual_sampling",
      samples: [{ faceCount, screenShare }]
    });
  });
});
