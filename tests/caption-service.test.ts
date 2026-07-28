import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../src/core/artifact-store";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import { starterTemplates } from "../src/shared/templates";
import type { ProviderProvenance, ShortProject } from "../src/shared/domain";
import { captionState, episode, segments } from "./factories";

const directories: string[] = [];
const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];
const now = "2026-07-28T12:00:00.000Z";
const provenance: ProviderProvenance = {
  provider: "fixture",
  providerClass: "local",
  modelId: "fixture",
  providerVersion: "1",
  optionsVersion: "1",
  createdAt: now
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-caption-service-"));
  directories.push(directory);
  const repository = new Repository(openDatabase(join(directory, "short-editor.db")));
  repositories.push(repository);
  const source = episode({ durationMs: 20_000 });
  repository.insertEpisode(source);
  const accepted = repository.replaceTranscriptWithProvenance(
    source.id, segments(4), "en", provenance
  );
  const template = starterTemplates[0]!;
  const project: ShortProject = {
    id: randomUUID(),
    episodeId: source.id,
    candidateId: null,
    title: "Caption fixture",
    sourceRanges: [{ startMs: 0, endMs: 10_000 }],
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
      cleanedTranscript: "",
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
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
  repository.createShort(project);
  const renderId = randomUUID();
  repository.db.prepare(`
    INSERT INTO renders(id,short_id,project_revision,encoder_json,state,created_at,updated_at)
    VALUES(?,?,1,'{}','succeeded',?,?)
  `).run(renderId, project.id, now, now);
  for (const [index, status] of ["draft", "published"].entries()) {
    repository.db.prepare(`
      INSERT INTO schedule_entries(
        id,short_id,render_id,episode_id,publish_at,timezone,status,priority,rationale,
        needs_rerender,revision,created_at,updated_at
      ) VALUES(?,?,?,?,?,'UTC',?,0,'fixture',0,1,?,?)
    `).run(
      randomUUID(), project.id, renderId, source.id,
      `2026-08-01T1${index}:00:00.000Z`, status, now, now
    );
  }
  const store = new ArtifactStore(directory, repository);
  const service = new CoreService(repository, {} as never, new JobQueue(repository), store);
  return { directory, repository, source, accepted, project, service };
}

function editable(project: ShortProject, expectedRevision = project.revision) {
  return {
    expectedRevision,
    enabled: true,
    cues: [{
      id: randomUUID(),
      startMs: 1_000,
      endMs: 1_499,
      text: "Independent caption",
      words: [{ startMs: 1_000, endMs: 1_300, text: "Independent" }]
    }],
    style: project.captions.style
  };
}

describe("caption update lifecycle", () => {
  it("atomically saves warnings and sidecars with exact invalidation semantics", () => {
    const context = setup();
    const acceptedBefore = context.repository.getAcceptedTranscriptRevision(context.source.id);
    const publishedBefore = context.repository.db.prepare(`
      SELECT * FROM schedule_entries WHERE status='published'
    `).get();

    const result = context.service.updateCaptions(
      context.project.id,
      editable(context.project)
    );

    expect(result.short).toMatchObject({
      revision: 2,
      approved: false,
      captions: {
        cues: [expect.objectContaining({ text: "Independent caption" })],
        warnings: [expect.objectContaining({ code: "CAPTION_SHORT_CUE" })]
      }
    });
    expect(result.warnings).toEqual(result.short.captions.warnings);
    expect(result.sidecars).toEqual(result.short.captions.sidecars);
    for (const reference of [result.sidecars.srt, result.sidecars.webvtt]) {
      expect(reference).not.toBeNull();
      expect(reference!.relativePath).toContain(
        `artifacts/shorts/${context.project.id}/revisions/2/`
      );
      expect(existsSync(join(context.directory, reference!.relativePath))).toBe(true);
    }
    expect(readFileSync(
      join(context.directory, result.sidecars.srt!.relativePath), "utf8"
    )).toContain("00:00:01,000 --> 00:00:01,499");
    expect(context.repository.db.prepare(
      "SELECT state FROM renders WHERE short_id=?"
    ).get(context.project.id)).toEqual({ state: "stale" });
    expect(context.repository.db.prepare(`
      SELECT needs_rerender,revision FROM schedule_entries WHERE status='draft'
    `).get()).toEqual({ needs_rerender: 1, revision: 2 });
    expect(context.repository.db.prepare(`
      SELECT * FROM schedule_entries WHERE status='published'
    `).get()).toEqual(publishedBefore);
    expect(context.repository.getAcceptedTranscriptRevision(context.source.id)).toEqual(acceptedBefore);
    expect(context.accepted).toEqual(acceptedBefore);
    const savedCaptions = structuredClone(result.short.captions);
    context.service.updateTranscript(
      context.source.id,
      acceptedBefore.revision,
      "en",
      acceptedBefore.segments.map((segment, index) => index === 0
        ? { ...segment, text: "Later transcript edit" }
        : segment)
    );
    expect(context.repository.getShort(context.project.id).captions).toEqual(savedCaptions);
  });

  it("rejects stale and structurally invalid updates without artifacts or revision changes", () => {
    const context = setup();
    expect(() => context.service.updateCaptions(
      context.project.id,
      editable(context.project, 2)
    )).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    const invalid = editable(context.project);
    const duplicate = invalid.cues[0]!;
    expect(() => context.service.updateCaptions(context.project.id, {
      ...invalid,
      cues: [
        duplicate,
        { ...duplicate, text: "duplicate" }
      ]
    })).toThrow();
    expect(context.repository.getShort(context.project.id)).toMatchObject({
      revision: 1,
      approved: true
    });
    expect(context.repository.listArtifactRecords(context.project.id)).toEqual([]);
  });

  it("provides strict HTTP and MCP parity, including disabled empty sidecars", async () => {
    const context = setup();
    const server = createApi(context.service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const response = await fetch(`${base}/shorts/${context.project.id}/captions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editable(context.project))
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { short: { revision: 2 }, warnings: [{ code: "CAPTION_SHORT_CUE" }] }
    });

    const invalid = await fetch(`${base}/shorts/${context.project.id}/captions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editable(context.project, 2), warnings: [] })
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "caption-service-test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    const mcp = await client.callTool({
      name: "shorts.update_captions",
      arguments: {
        ...editable(context.project, 2),
        enabled: false,
        shortId: context.project.id
      }
    });
    expect(mcp.isError).not.toBe(true);
    const updated = context.repository.getShort(context.project.id);
    expect(updated).toMatchObject({ revision: 3, captions: { enabled: false, warnings: [] } });
    expect(readFileSync(
      join(context.directory, updated.captions.sidecars.srt!.relativePath), "utf8"
    )).toBe("");
    expect(readFileSync(
      join(context.directory, updated.captions.sidecars.webvtt!.relativePath), "utf8"
    )).toBe("WEBVTT\n\n");
  });
});
