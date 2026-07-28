import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import type {
  AnalysisArtifact,
  ProviderProvenance,
  Render,
  ScheduleEntry,
  ShortProject,
  TranscriptSegment
} from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { captionState, episode, segments } from "./factories";

const repositories: Repository[] = [];
const servers: Server[] = [];
const mcpClients: Client[] = [];
const now = "2026-07-27T16:00:00.000Z";
const provenance: ProviderProvenance = {
  provider: "fixture-provider",
  providerClass: "local",
  modelId: "fixture-model",
  providerVersion: "1",
  optionsVersion: "transcript-v1",
  createdAt: now
};

afterEach(async () => {
  await Promise.all(mcpClients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
});

function setup(durationMs = 120_000) {
  const repository = new Repository(openDatabase(":memory:"));
  repositories.push(repository);
  const source = episode({ durationMs });
  repository.insertEpisode(source);
  const original = segments(1);
  repository.replaceTranscriptWithProvenance(source.id, original, "en", provenance);
  return { repository, source, original };
}

function shortProject(episodeId: string): ShortProject {
  const template = starterTemplates[0]!;
  return {
    id: randomUUID(),
    episodeId,
    candidateId: null,
    title: "Transcript-dependent Short",
    sourceRanges: [{ startMs: 0, endMs: 5_000 }],
    templateId: template.id,
    templateLineage: {
      templateId: template.id,
      templateVersion: template.version,
      parentTemplateId: null
    },
    composition: structuredClone(template.composition),
    captions: captionState(),
    audio: {
      sourceGainDb: 0,
      sourceMuted: false,
      cutFadeMs: 0,
      bedAssetId: null,
      bedGainDb: null,
      warnings: []
    },
    copy: {
      cleanedTranscript: "Old transcript",
      rewrite: "",
      hookVariants: [],
      titles: [],
      description: "",
      hashtags: [],
      thumbnailText: ""
    },
    copyState: "accepted",
    copySource: "legacy_accepted",
    approved: true,
    revision: 4,
    createdAt: now,
    updatedAt: now
  };
}

function render(shortId: string, state: Render["state"] = "succeeded"): Render {
  return {
    id: randomUUID(),
    shortId,
    projectRevision: 4,
    preflightId: null,
    encoder: {
      ffmpegVersion: "7",
      videoCodec: "h264",
      audioCodec: "aac",
      settings: {}
    },
    outputPath: null,
    sidecarPath: null,
    validation: null,
    state,
    error: null,
    contentHash: null,
    decisionHash: null,
    createdAt: now,
    updatedAt: now
  };
}

function schedule(
  shortId: string,
  renderId: string,
  episodeId: string,
  status: ScheduleEntry["status"],
  publishAt: string
): ScheduleEntry {
  return {
    id: randomUUID(),
    shortId,
    renderId,
    episodeId,
    publishAt,
    timezone: "UTC",
    status,
    priority: 0,
    rationale: "fixture",
    locked: status === "published",
    youtubeUrl: status === "published" ? "https://youtu.be/published" : null,
    needsRerender: false,
    revision: 3,
    createdAt: now,
    updatedAt: now
  };
}

function analysis(
  episodeId: string,
  kind: AnalysisArtifact["kind"],
  state: AnalysisArtifact["state"]
): AnalysisArtifact {
  return {
    id: randomUUID(),
    entityId: episodeId,
    ownerType: "episode",
    kind,
    state,
    provenance,
    inputHash: `sha256:${randomUUID()}`,
    rawOutput: { immutable: true },
    acceptedProjection: { prior: true },
    createdAt: now
  };
}

describe("accepted transcript repository revisions", () => {
  it("atomically invalidates every Episode-dependent result while preserving published entries and raw transcript artifacts", () => {
    const { repository, source, original } = setup();
    const firstShort = repository.createShort(shortProject(source.id));
    const secondShort = repository.createShort(shortProject(source.id));
    const firstRender = repository.insertRender(render(firstShort.id));
    const failedRender = repository.insertRender(render(secondShort.id, "failed"));
    const draft = repository.insertScheduleEntry(schedule(
      firstShort.id,
      firstRender.id,
      source.id,
      "draft",
      "2026-08-01T12:00:00.000Z"
    ));
    const published = repository.insertScheduleEntry(schedule(
      secondShort.id,
      failedRender.id,
      source.id,
      "published",
      "2026-08-02T12:00:00.000Z"
    ));
    const episodeAnalysis = repository.insertAnalysisArtifact(
      analysis(source.id, "episode_analysis", "accepted")
    );
    const proposedAnalysis = repository.insertAnalysisArtifact(
      analysis(source.id, "episode_analysis", "proposed")
    );
    const rawTranscript = repository.insertAnalysisArtifact(
      analysis(source.id, "transcript", "accepted")
    );

    const edited: TranscriptSegment[] = [{
      ...original[0]!,
      startMs: 100,
      endMs: 4_900,
      text: "Manually corrected text.",
      words: [{
        text: "corrected",
        startMs: 500,
        endMs: 1_200,
        speaker: null
      }],
      speaker: "host",
      confidence: null
    }];
    const accepted = repository.updateAcceptedTranscript(source.id, 1, "fr", edited);

    expect(accepted).toMatchObject({
      revision: 2,
      language: "fr",
      segments: edited,
      acceptedState: "accepted",
      provenance: {
        provider: "manual",
        modelId: "manual-edit",
        optionsVersion: "full-snapshot-v1"
      }
    });
    expect(repository.listTranscriptRevisions(source.id)).toMatchObject([
      { revision: 1, acceptedState: "superseded", segments: original },
      { revision: 2, acceptedState: "accepted", segments: edited }
    ]);
    expect(repository.getTranscriptRevision(source.id, 1)).toMatchObject({
      revision: 1,
      acceptedState: "superseded",
      segments: original
    });
    expect(repository.getTranscript(source.id)).toEqual(edited);
    const projection = repository.db.prepare(`
      SELECT start_ms,end_ms,text,words_json,speaker,confidence
      FROM transcript_segments WHERE episode_id=?
    `).get(source.id) as Record<string, unknown>;
    expect({ ...projection, words_json: JSON.parse(String(projection.words_json)) }).toEqual({
      start_ms: 100,
      end_ms: 4_900,
      text: "Manually corrected text.",
      words_json: edited[0]!.words,
      speaker: "host",
      confidence: null
    });

    expect(repository.getShort(firstShort.id)).toMatchObject({ approved: false, revision: 5 });
    expect(repository.getShort(secondShort.id)).toMatchObject({ approved: false, revision: 5 });
    expect(repository.listRenders(firstShort.id)[0]).toMatchObject({ state: "stale" });
    expect(repository.listRenders(secondShort.id)[0]).toMatchObject({ state: "failed" });
    expect(repository.getScheduleEntry(draft.id)).toMatchObject({
      needsRerender: true,
      revision: 4
    });
    expect(repository.getScheduleEntry(published.id)).toEqual(published);

    const artifacts = new Map(repository.listAnalysisArtifacts(source.id)
      .map((artifact) => [artifact.id, artifact]));
    expect(artifacts.get(episodeAnalysis.id)?.state).toBe("superseded");
    expect(artifacts.get(proposedAnalysis.id)?.state).toBe("superseded");
    expect(artifacts.get(rawTranscript.id)).toEqual(rawTranscript);
  });

  it.each([
    ["empty text", (value: TranscriptSegment[]) => [{ ...value[0]!, text: "   " }]],
    ["overlapping segments", (value: TranscriptSegment[]) => [
      { ...value[0]!, endMs: 3_000 },
      { ...value[0]!, id: randomUUID(), startMs: 2_000, endMs: 4_000 }
    ]],
    ["unordered segments", (value: TranscriptSegment[]) => [
      { ...value[0]!, startMs: 3_000, endMs: 4_000 },
      { ...value[0]!, id: randomUUID(), startMs: 1_000, endMs: 2_000 }
    ]],
    ["word outside segment", (value: TranscriptSegment[]) => [{
      ...value[0]!,
      words: [{ text: "outside", startMs: 4_500, endMs: 5_500 }]
    }]],
    ["unordered words", (value: TranscriptSegment[]) => [{
      ...value[0]!,
      words: [
        { text: "later", startMs: 2_000, endMs: 3_000 },
        { text: "earlier", startMs: 1_000, endMs: 1_500 }
      ]
    }]],
    ["timing outside media", (value: TranscriptSegment[]) => [{
      ...value[0]!,
      endMs: 120_001
    }]]
  ])("rejects %s without changing revisions or dependents", (_label, mutate) => {
    const { repository, source, original } = setup();
    const project = repository.createShort(shortProject(source.id));
    expect(() => repository.updateAcceptedTranscript(
      source.id,
      1,
      "en",
      mutate(original)
    )).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(repository.listTranscriptRevisions(source.id)).toHaveLength(1);
    expect(repository.getTranscript(source.id)).toEqual(original);
    expect(repository.getShort(project.id)).toMatchObject({ approved: true, revision: 4 });
  });

  it("reports exact optimistic conflict details and performs no second invalidation", () => {
    const { repository, source, original } = setup();
    const project = repository.createShort(shortProject(source.id));
    repository.updateAcceptedTranscript(source.id, 1, "en", [{
      ...original[0]!,
      text: "First client wins."
    }]);
    const before = repository.getShort(project.id);

    expect(() => repository.updateAcceptedTranscript(source.id, 1, "en", [{
      ...original[0]!,
      text: "Stale client loses."
    }])).toThrow(expect.objectContaining({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 1, actualRevision: 2 }
    }));
    expect(repository.listTranscriptRevisions(source.id)).toHaveLength(2);
    expect(repository.getShort(project.id)).toEqual(before);
    expect(JSON.stringify(repository.listTranscriptRevisions(source.id)))
      .not.toContain("Stale client loses.");
  });
});

describe("transcript HTTP contract", () => {
  it("round-trips current and exact revisions, nullable no-diarization data, and 1,001 segments", async () => {
    const { repository, source, original } = setup(6_000_000);
    const service = new CoreService(repository, {} as never, new JobQueue(repository));
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/v1/analysis/${source.id}/transcript`;

    const snapshot = segments(1_001).map((segment, index) => index === 0
      ? {
        ...segment,
        text: "Edited words and speaker.",
        words: [{
          text: "Edited",
          startMs: segment.startMs,
          endMs: segment.startMs + 500,
          speaker: null
        }],
        speaker: null,
        confidence: null
      }
      : index === 1
        ? { ...segment, words: null, speaker: undefined, confidence: undefined }
        : segment);
    const response = await fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        language: "es",
        segments: snapshot
      })
    });
    expect(response.status).toBe(200);
    const updated = await response.json() as { data: { revision: number; segments: TranscriptSegment[] } };
    expect(updated.data.revision).toBe(2);
    expect(updated.data.segments).toHaveLength(1_001);
    expect(updated.data.segments[0]).toMatchObject({
      text: "Edited words and speaker.",
      speaker: null,
      confidence: null,
      words: [{ speaker: null }]
    });
    expect(updated.data.segments[1]).toMatchObject({
      words: [],
      speaker: null,
      confidence: null
    });

    const current = await fetch(base).then((result) => result.json()) as {
      data: { revision: number; language: string };
    };
    const exact = await fetch(`${base}?revision=1`).then((result) => result.json()) as {
      data: { revision: number; segments: TranscriptSegment[]; acceptedState: string };
    };
    expect(current.data).toMatchObject({ revision: 2, language: "es" });
    expect(exact.data).toMatchObject({
      revision: 1,
      acceptedState: "superseded",
      segments: original
    });
    expect(repository.db.prepare(
      "SELECT COUNT(*) count FROM transcript_segments WHERE episode_id=?"
    ).get(source.id)).toEqual({ count: 1_001 });
  });

  it("returns conflict, missing-source, validation, and exact-revision errors without transcript text", async () => {
    const { repository, source, original } = setup();
    const service = new CoreService(repository, {} as never, new JobQueue(repository));
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/v1/analysis/${source.id}/transcript`;
    repository.updateAcceptedTranscript(source.id, 1, "en", [{
      ...original[0]!,
      text: "Current accepted secret words."
    }]);

    const stale = await fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        language: "en",
        segments: [{ ...original[0], text: "Sensitive stale transcript." }]
      })
    });
    const staleBody = await stale.json() as {
      error: { code: string; details: { expectedRevision: number; actualRevision: number } };
    };
    expect(stale.status).toBe(409);
    expect(staleBody.error).toMatchObject({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 1, actualRevision: 2 }
    });
    expect(JSON.stringify(staleBody)).not.toContain("Sensitive stale transcript.");

    const invalid = await fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        language: "en",
        segments: [
          { ...original[0], endMs: 3_000, text: "Sensitive invalid transcript one." },
          {
            ...original[0],
            id: randomUUID(),
            startMs: 2_000,
            endMs: 4_000,
            text: "Sensitive invalid transcript two."
          }
        ]
      })
    });
    const invalidBody = await invalid.json();
    expect(invalid.status).toBe(422);
    expect(invalidBody).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(JSON.stringify(invalidBody)).not.toContain("Sensitive invalid transcript");

    const missingRevision = await fetch(`${base}?revision=99`);
    expect(missingRevision.status).toBe(404);
    expect(await missingRevision.json()).toMatchObject({
      error: { code: "NOT_FOUND", details: { episodeId: source.id, revision: 99 } }
    });

    repository.markEpisodeSourceMissing(source.id);
    const missingSource = await fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        language: "en",
        segments: [{ ...original[0], text: "Do not expose this missing-source text." }]
      })
    });
    expect(missingSource.status).toBe(409);
    const missingBody = await missingSource.json();
    expect(missingBody).toMatchObject({ error: { code: "SOURCE_MISSING" } });
    expect(JSON.stringify(missingBody)).not.toContain("Do not expose");
  });
});

describe("transcript MCP parity", () => {
  it("exposes typed current/exact reads, updates, and conflict details", async () => {
    const { repository, source, original } = setup();
    const service = new CoreService(repository, {} as never, new JobQueue(repository));
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: {
        ...(process.env as Record<string, string>),
        SHORT_EDITOR_CORE_URL: `http://127.0.0.1:${port}/v1`
      },
      stderr: "pipe"
    });
    const client = new Client({ name: "transcript-test", version: "1" });
    mcpClients.push(client);
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain("analysis.get_transcript");
    expect(names).toContain("analysis.update_transcript");
    expect(tools.tools.find((tool) => tool.name === "analysis.update_transcript")
      ?.inputSchema.required).toEqual(expect.arrayContaining([
      "episodeId",
      "expectedRevision",
      "language",
      "segments"
    ]));

    const updated = await client.callTool({
      name: "analysis.update_transcript",
      arguments: {
        episodeId: source.id,
        expectedRevision: 1,
        language: "de",
        segments: [{
          ...original[0],
          text: "MCP accepted edit.",
          words: null,
          speaker: null,
          confidence: null
        }]
      }
    });
    expect(updated.isError).not.toBe(true);

    const exact = await client.callTool({
      name: "analysis.get_transcript",
      arguments: { episodeId: source.id, revision: 1 }
    });
    const exactContent = exact.content as Array<{ type: string; text?: string }>;
    const exactText = exactContent[0]?.type === "text" ? exactContent[0].text ?? "" : "";
    expect(JSON.parse(exactText)).toMatchObject({
      revision: 1,
      acceptedState: "superseded",
      segments: original
    });

    const stale = await client.callTool({
      name: "analysis.update_transcript",
      arguments: {
        episodeId: source.id,
        expectedRevision: 1,
        language: "de",
        segments: [{ ...original[0], text: "MCP sensitive stale text." }]
      }
    });
    const staleContent = stale.content as Array<{ type: string; text?: string }>;
    const staleText = staleContent[0]?.type === "text" ? staleContent[0].text ?? "" : "";
    expect(stale.isError).toBe(true);
    expect(staleText).toContain("REVISION_CONFLICT");
    expect(staleText).toContain("\"expectedRevision\":1");
    expect(staleText).toContain("\"actualRevision\":2");
    expect(staleText).not.toContain("MCP sensitive stale text.");
  });
});
