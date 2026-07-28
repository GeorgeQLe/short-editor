import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import type { AnalysisArtifact, ProviderProvenance } from "../src/shared/domain";
import { episode, segments } from "./factories";

const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];
const now = "2026-07-27T12:00:00.000Z";
const provenance: ProviderProvenance = {
  provider: "fixture-analysis",
  providerClass: "local",
  modelId: "fixture-v1",
  providerVersion: "1",
  optionsVersion: "1",
  createdAt: now
};
const scores = {
  hook: .9, coherence: .9, payoff: .85, independence: .9, delivery: .8, visualActivity: .75
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
});

function setup() {
  const repository = new Repository(openDatabase(":memory:"));
  repositories.push(repository);
  const source = episode({ durationMs: 400_000 });
  repository.insertEpisode(source);
  repository.replaceTranscriptWithProvenance(source.id, segments(80), "en", provenance);
  const service = new CoreService(repository, {} as never, new JobQueue(repository));
  return { repository, source, service };
}

function output() {
  return {
    summary: "Anonymized episode.",
    topics: ["testing"],
    highlights: Array.from({ length: 6 }, (_, index) => ({
      startMs: index * 30_000,
      endMs: index * 30_000 + 20_000,
      title: `Highlight ${index}`,
      reason: "Complete provider-selected idea",
      scores: { ...scores, visualActivity: .6 + index * .05 }
    }))
  };
}

function artifact(
  episodeId: string,
  rawOutput: unknown = output(),
  overrides: Partial<AnalysisArtifact> = {}
): AnalysisArtifact {
  return {
    id: randomUUID(),
    entityId: episodeId,
    ownerType: "episode",
    kind: "episode_analysis",
    state: "accepted",
    provenance,
    inputHash: randomUUID(),
    rawOutput,
    acceptedProjection: null,
    createdAt: now,
    ...overrides
  };
}

describe("Candidate generation service", () => {
  it("binds the actual accepted revision and requires explicit analysis selection", () => {
    const { repository, source, service } = setup();
    repository.replaceTranscriptWithProvenance(source.id, segments(80), "en", provenance);
    const heuristic = service.generateCandidates({ episodeId: source.id, mode: "heuristic", count: 5 });
    expect(heuristic.candidates).toHaveLength(5);
    expect(heuristic.candidates.every((candidate) =>
      candidate.generationProvenance.transcriptRevision === 2
      && candidate.generationProvenance.provider === null
    )).toBe(true);

    expect(() => service.generateCandidates({
      episodeId: source.id,
      mode: "analysis",
      analysisArtifactId: randomUUID()
    })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("accepts direct and typed stored envelopes and keeps provider provenance", () => {
    const { repository, source, service } = setup();
    const direct = artifact(source.id);
    const envelope = artifact(source.id, {
      typedOutput: output(),
      providerOutput: {},
      requestMetadata: {}
    });
    repository.insertAnalysisArtifact(direct);
    repository.insertAnalysisArtifact(envelope);
    for (const selected of [direct, envelope]) {
      const result = service.generateCandidates({
        episodeId: source.id,
        mode: "analysis",
        analysisArtifactId: selected.id,
        count: 5
      });
      expect(result.diagnostic).toEqual({ sufficient: true, requestedCount: 5, generatedCount: 5 });
      expect(result.candidates.every((candidate) =>
        candidate.generationProvenance.artifactId === selected.id
        && candidate.generationProvenance.provider?.provider === provenance.provider
      )).toBe(true);
      expect(result.candidates.map((candidate) => candidate.topic))
        .toEqual(["Highlight 5", "Highlight 4", "Highlight 3", "Highlight 2", "Highlight 1"]);
    }
  });

  it("rejects stale, mismatched, and malformed artifacts without heuristic fallback", () => {
    const { repository, source, service } = setup();
    const otherEpisode = episode({ durationMs: 400_000 });
    repository.insertEpisode(otherEpisode);
    repository.replaceTranscriptWithProvenance(otherEpisode.id, segments(80), "en", provenance);
    const cases = [
      artifact(source.id, output(), { state: "superseded" }),
      artifact(otherEpisode.id),
      artifact(source.id, { unexpected: true })
    ];
    cases.forEach((item) => repository.insertAnalysisArtifact(item));
    expect(() => service.generateCandidates({
      episodeId: source.id, mode: "analysis", analysisArtifactId: cases[0]!.id
    })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => service.generateCandidates({
      episodeId: source.id, mode: "analysis", analysisArtifactId: cases[1]!.id
    })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => service.generateCandidates({
      episodeId: source.id, mode: "analysis", analysisArtifactId: cases[2]!.id
    })).toThrow(expect.objectContaining({ code: "PROVIDER_OUTPUT_INVALID" }));
    expect(repository.listCandidates(source.id)).toEqual([]);
  });
});

describe("Candidate HTTP and MCP diagnostics", () => {
  it("returns the structured insufficient result through both interfaces", async () => {
    const { repository, source, service } = setup();
    repository.replaceTranscriptWithProvenance(source.id, segments(4), "en", provenance);
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/v1`;

    const response = await fetch(`${base}/candidates/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: source.id })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { diagnostic: { code: string } } };
    expect(body.data.diagnostic.code).toBe("INSUFFICIENT_MATERIAL");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: {
        ...(process.env as Record<string, string>),
        SHORT_EDITOR_CORE_URL: base
      },
      stderr: "pipe"
    });
    const client = new Client({ name: "candidate-test", version: "1" });
    clients.push(client);
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === "candidates.generate")?.inputSchema)
      .toMatchObject({ properties: { mode: {}, analysisArtifactId: {} } });
    const result = await client.callTool({
      name: "candidates.generate",
      arguments: { episodeId: source.id, mode: "heuristic" }
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(JSON.parse(content[0]!.text!)).toMatchObject({
      diagnostic: { sufficient: false, code: "INSUFFICIENT_MATERIAL" }
    });
  });
});
