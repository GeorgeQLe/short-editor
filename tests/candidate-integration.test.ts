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
import {
  candidateGenerationResultSchema,
  type AnalysisArtifact,
  type ProviderProvenance
} from "../src/shared/domain";
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
    const heuristic = service.generateCandidates({
      episodeId: source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    expect(heuristic.candidates).toHaveLength(5);
    expect(heuristic.candidates.every((candidate) =>
      candidate.generationProvenance.transcriptRevision === 2
      && candidate.generationProvenance.provider === null
    )).toBe(true);

    expect(() => service.generateCandidates({
      episodeId: source.id,
      mode: "analysis",
      strategy: "replace_pending",
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
        strategy: "replace_pending",
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
      episodeId: source.id, mode: "analysis", strategy: "replace_pending",
      analysisArtifactId: cases[0]!.id
    })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => service.generateCandidates({
      episodeId: source.id, mode: "analysis", strategy: "replace_pending",
      analysisArtifactId: cases[1]!.id
    })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => service.generateCandidates({
      episodeId: source.id, mode: "analysis", strategy: "replace_pending",
      analysisArtifactId: cases[2]!.id
    })).toThrow(expect.objectContaining({ code: "PROVIDER_OUTPUT_INVALID" }));
    expect(repository.listCandidates(source.id)).toEqual([]);
  });

  it("preserves reviewed decisions, accepted copy, and superseded history across strategies", () => {
    const { repository, source, service } = setup();
    const initial = service.generateCandidates({
      episodeId: source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    const approved = service.reviewCandidate(initial.candidates[0]!.id, 1, "approved");
    const protectedPending = initial.candidates[1]!;
    const accepted = {
      ...service.getCandidateContentPackage(protectedPending.id).proposed,
      titles: ["User title"],
      description: "User-edited description"
    };
    service.acceptCandidateContentPackage(protectedPending.id, 1, accepted);

    const replaced = service.generateCandidates({
      episodeId: source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    expect(replaced.run).toMatchObject({
      strategy: "replace_pending",
      proposedCount: 5,
      insertedCount: 3,
      retainedDecisionConflictCount: 2,
      retainedPendingConflictCount: 0
    });
    expect(candidateGenerationResultSchema.safeParse(replaced).success).toBe(true);
    expect(replaced.diagnostic).toMatchObject({
      sufficient: false, code: "INSUFFICIENT_NOVEL_MATERIAL", generatedCount: 3
    });
    expect(repository.getCandidate(approved.id)).toMatchObject({
      reviewStatus: "approved", revision: 2, state: "active"
    });
    expect(service.getCandidateContentPackage(protectedPending.id).accepted).toEqual(accepted);
    for (const candidate of initial.candidates.slice(2)) {
      expect(repository.getCandidate(candidate.id)).toMatchObject({
        state: "superseded", revision: 2
      });
    }

    const appended = service.generateCandidates({
      episodeId: source.id, mode: "heuristic", count: 5, strategy: "append_pending"
    });
    expect(appended.run).toMatchObject({
      strategy: "append_pending",
      insertedCount: 0,
      retainedDecisionConflictCount: 2,
      retainedPendingConflictCount: 3
    });
    expect(repository.listCandidates(source.id)).toHaveLength(5);
  });

  it("keeps proposals immutable and creates proposed or accepted Short copy explicitly", () => {
    const { repository, source, service } = setup();
    const generated = service.generateCandidates({
      episodeId: source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    const draftCandidate = service.reviewCandidate(generated.candidates[0]!.id, 1, "approved");
    const draft = service.createShort(draftCandidate.id);
    expect(draft).toMatchObject({
      copyState: "proposed", copySource: "candidate_proposal"
    });

    const editable = generated.candidates[1]!;
    const before = service.getCandidateContentPackage(editable.id);
    const edited = {
      ...before.proposed,
      rewrite: "A user-authored rewrite.",
      hashtags: ["edited"]
    };
    const accepted = service.acceptCandidateContentPackage(editable.id, 1, edited);
    expect(accepted.proposed).toEqual(before.proposed);
    expect(accepted.accepted).toEqual(edited);
    const raw = repository.db.prepare(
      "SELECT raw_output_json FROM analysis_artifacts WHERE id=?"
    ).get(before.proposalArtifactId) as { raw_output_json: string };
    expect(JSON.parse(raw.raw_output_json)).toEqual(before.proposed);
    const reviewed = service.reviewCandidate(editable.id, 2, "approved");
    const short = service.createShort(reviewed.id);
    expect(short.copy).toEqual(edited);
    expect(short).toMatchObject({
      copyState: "accepted", copySource: "candidate_accepted"
    });
    const updated = service.updateCopy(short.id, 1, { ...short.copy, titles: ["Short edit"] });
    expect(updated).toMatchObject({
      copyState: "accepted", copySource: "user_accepted"
    });
  });

  it("uses Candidate revisions for both operation orders around regeneration", () => {
    const first = setup();
    const generatedFirst = first.service.generateCandidates({
      episodeId: first.source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    const stale = generatedFirst.candidates[0]!;
    first.service.generateCandidates({
      episodeId: first.source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    expect(() => first.service.reviewCandidate(stale.id, 1, "approved"))
      .toThrow(expect.objectContaining({
        code: "REVISION_CONFLICT",
        details: { expectedRevision: 1, actualRevision: 2 }
      }));
    expect(() => first.service.acceptCandidateContentPackage(
      stale.id, 1, first.service.getCandidateContentPackage(stale.id).proposed
    )).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));

    const second = setup();
    const generatedSecond = second.service.generateCandidates({
      episodeId: second.source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    const reviewed = second.service.reviewCandidate(generatedSecond.candidates[0]!.id, 1, "rejected");
    const acceptedCandidate = generatedSecond.candidates[1]!;
    const packageBefore = second.service.getCandidateContentPackage(acceptedCandidate.id);
    second.service.acceptCandidateContentPackage(
      acceptedCandidate.id, 1, packageBefore.proposed
    );
    second.service.generateCandidates({
      episodeId: second.source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    });
    expect(second.repository.getCandidate(reviewed.id)).toMatchObject({
      state: "active", reviewStatus: "rejected", revision: 2
    });
    expect(second.service.getCandidateContentPackage(acceptedCandidate.id)).toMatchObject({
      candidateRevision: 2,
      accepted: packageBefore.proposed
    });
  }, 10_000);

  it("survives provider switches and rolls the complete generation write back on failure", () => {
    const { repository, source, service } = setup();
    const firstArtifact = artifact(source.id);
    repository.insertAnalysisArtifact(firstArtifact);
    const initial = service.generateCandidates({
      episodeId: source.id,
      mode: "analysis",
      analysisArtifactId: firstArtifact.id,
      count: 5,
      strategy: "replace_pending"
    });
    const protectedCandidate = initial.candidates[0]!;
    const packageBefore = service.getCandidateContentPackage(protectedCandidate.id);
    const userCopy = { ...packageBefore.proposed, titles: ["Provider-independent edit"] };
    service.acceptCandidateContentPackage(protectedCandidate.id, 1, userCopy);

    const switchedProvenance = {
      ...provenance,
      provider: "second-provider",
      modelId: "second-model"
    };
    const secondArtifact = artifact(source.id, output(), { provenance: switchedProvenance });
    repository.insertAnalysisArtifact(secondArtifact);
    const switched = service.generateCandidates({
      episodeId: source.id,
      mode: "analysis",
      analysisArtifactId: secondArtifact.id,
      count: 5,
      strategy: "replace_pending"
    });
    expect(service.getCandidateContentPackage(protectedCandidate.id).accepted).toEqual(userCopy);
    expect(switched.candidates.every((candidate) =>
      candidate.generationProvenance.provider?.provider === "second-provider"
    )).toBe(true);

    const activeBefore = repository.listCandidates(source.id);
    const runCountBefore = (repository.db.prepare(
      "SELECT COUNT(*) count FROM candidate_generation_runs"
    ).get() as { count: number }).count;
    repository.db.exec(`
      CREATE TRIGGER fail_candidate_package
      BEFORE INSERT ON analysis_artifacts
      WHEN NEW.kind='content_package'
      BEGIN
        SELECT RAISE(ABORT, 'injected content-package failure');
      END
    `);
    expect(() => service.generateCandidates({
      episodeId: source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
    })).toThrow(/injected content-package failure/);
    expect(repository.listCandidates(source.id)).toEqual(activeBefore);
    expect((repository.db.prepare(
      "SELECT COUNT(*) count FROM candidate_generation_runs"
    ).get() as { count: number }).count).toBe(runCountBefore);
  });
});

describe("Candidate HTTP and MCP diagnostics", () => {
  it("requires strategy/revisions and exposes atomic Candidate copy operations over HTTP", async () => {
    const { source, service } = setup();
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/v1`;
    const headers = { "Content-Type": "application/json" };

    const missingStrategy = await fetch(`${base}/candidates/generate`, {
      method: "POST", headers, body: JSON.stringify({ episodeId: source.id })
    });
    expect(missingStrategy.status).toBe(422);

    const generatedResponse = await fetch(`${base}/candidates/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        episodeId: source.id, mode: "heuristic", count: 5, strategy: "replace_pending"
      })
    });
    const generated = await generatedResponse.json() as {
      data: { candidates: Array<{ id: string; revision: number }>; run: { strategy: string } };
    };
    expect(generated.data.run.strategy).toBe("replace_pending");
    const selected = generated.data.candidates[0]!;
    const packageResponse = await fetch(`${base}/candidates/${selected.id}/content-package`);
    const packageBody = await packageResponse.json() as {
      data: { proposed: Record<string, unknown>; accepted: null; candidateRevision: number };
    };
    expect(packageBody.data).toMatchObject({ accepted: null, candidateRevision: 1 });

    const acceptedResponse = await fetch(`${base}/candidates/${selected.id}/content-package`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        contentPackage: { ...packageBody.data.proposed, titles: ["HTTP edit"] }
      })
    });
    expect(acceptedResponse.status).toBe(200);
    const staleReview = await fetch(`${base}/candidates/${selected.id}/review`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 1, status: "approved" })
    });
    expect(staleReview.status).toBe(409);
    expect(await staleReview.json()).toMatchObject({
      error: {
        code: "REVISION_CONFLICT",
        details: { expectedRevision: 1, actualRevision: 2 }
      }
    });
  });

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
      body: JSON.stringify({ episodeId: source.id, strategy: "replace_pending" })
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
      .toMatchObject({
        required: expect.arrayContaining(["episodeId", "strategy"]),
        properties: { mode: {}, analysisArtifactId: {}, strategy: {} }
      });
    expect(tools.tools.find((tool) => tool.name === "candidates.review")?.inputSchema)
      .toMatchObject({ required: expect.arrayContaining(["candidateId", "expectedRevision", "status"]) });
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "candidates.get_content_package", "candidates.accept_content_package"
    ]));
    const result = await client.callTool({
      name: "candidates.generate",
      arguments: { episodeId: source.id, mode: "heuristic", strategy: "replace_pending" }
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(JSON.parse(content[0]!.text!)).toMatchObject({
      diagnostic: { sufficient: false, code: "INSUFFICIENT_MATERIAL" }
    });
  });
});
