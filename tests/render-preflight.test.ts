import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import {
  hashCanonicalSnapshot,
  normalizeRenderPreflightFindings,
  parseDependencyVersion,
  renderPreflightFindingRegistry,
  RenderPreflightService,
  YOUTUBE_CONTENT_ID_HELP_URL
} from "../src/core/render-preflight";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import {
  renderPreflightFindingCodes,
  renderPreflightRequestSchema,
  renderPreflightResultSchema,
  type RenderPreflightFinding,
  type ShortProject
} from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { captionState, episode } from "./factories";

const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
});

function fixture(durationMs = 30_000, beforeInsert?: () => void | Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-preflight-"));
  const sourcePath = join(directory, "source.mp4");
  writeFileSync(sourcePath, "stable source bytes");
  const state = statSync(sourcePath);
  const repository = new Repository(openDatabase(":memory:"));
  repositories.push(repository);
  const source = episode({
    sourcePath,
    canonicalPath: sourcePath,
    contentHash: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
    fileSize: state.size,
    modifiedAtMs: Math.round(state.mtimeMs),
    durationMs: 240_000
  });
  repository.insertEpisode(source);
  const template = starterTemplates[0]!;
  const now = "2026-07-28T12:00:00.000Z";
  const project: ShortProject = {
    id: randomUUID(),
    episodeId: source.id,
    candidateId: null,
    title: "Preflight fixture",
    sourceRanges: [{ startMs: 0, endMs: durationMs }],
    templateId: template.id,
    templateLineage: {
      templateId: template.id,
      templateVersion: template.version,
      parentTemplateId: template.parentTemplateId
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
  const run = async (_binary: string, args: string[]) => {
    if (args[0] === "-version") {
      return {
        stdout: _binary.includes("probe")
          ? "ffprobe version 7.1 Copyright\n"
          : "ffmpeg version 7.1 Copyright\n",
        stderr: ""
      };
    }
    return {
      stdout: JSON.stringify({
        format: { duration: "240" },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
          { codec_type: "audio", codec_name: "aac" }
        ]
      }),
      stderr: "/private/raw-path-should-never-escape"
    };
  };
  const preflights = new RenderPreflightService(repository, undefined, {
    ffmpegPath: "ffmpeg-fixture",
    ffprobePath: "ffprobe-fixture",
    now: () => now,
    beforeInsert,
    run
  });
  return { repository, project, preflights, sourcePath };
}

describe("render preflight contracts and canonical helpers", () => {
  it("uses strict requests and a complete registry", () => {
    const request = { shortId: randomUUID(), expectedRevision: 1 };
    expect(renderPreflightRequestSchema.parse(request)).toEqual(request);
    expect(renderPreflightRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
    expect(Object.keys(renderPreflightFindingRegistry)).toEqual([...renderPreflightFindingCodes]);
    for (const code of renderPreflightFindingCodes) {
      expect(renderPreflightFindingRegistry[code].message).not.toContain("/");
      expect(renderPreflightFindingRegistry[code].remediation.length).toBeGreaterThan(0);
    }
  });

  it("hashes canonical JSON and parses dependency versions stably", () => {
    expect(hashCanonicalSnapshot({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(hashCanonicalSnapshot({ a: { c: 3, d: 4 }, b: 2 }));
    expect(parseDependencyVersion("ffmpeg version 7.1-static Copyright")).toBe("7.1-static");
    expect(parseDependencyVersion("ffprobe version n7.0.2\nconfiguration: secret")).toBe("n7.0.2");
    expect(parseDependencyVersion("unexpected")).toBeNull();
  });

  it("deduplicates and orders findings by registry and identifier details", () => {
    const make = (code: "SOURCE_MISSING" | "CAPTION_OVERFLOW", details: Record<string, string>): RenderPreflightFinding => ({
      code,
      ...renderPreflightFindingRegistry[code],
      details
    });
    expect(normalizeRenderPreflightFindings([
      make("CAPTION_OVERFLOW", { cueId: "b" }),
      make("SOURCE_MISSING", { episodeId: "e" }),
      make("CAPTION_OVERFLOW", { cueId: "a" }),
      make("CAPTION_OVERFLOW", { cueId: "a" })
    ]).map((value) => [value.code, value.details])).toEqual([
      ["SOURCE_MISSING", { episodeId: "e" }],
      ["CAPTION_OVERFLOW", { cueId: "a" }],
      ["CAPTION_OVERFLOW", { cueId: "b" }]
    ]);
  });
});

describe("immutable render preflight workflow", () => {
  it("persists a passing snapshot without creating a Render, job, or artifact", async () => {
    const context = fixture();
    const before = {
      renders: context.repository.db.prepare("SELECT count(*) count FROM renders").get(),
      jobs: context.repository.db.prepare("SELECT count(*) count FROM jobs").get(),
      artifacts: context.repository.db.prepare("SELECT count(*) count FROM artifact_records").get()
    };
    const result = await context.preflights.preflight(context.project.id, 1);
    expect(renderPreflightResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      shortId: context.project.id,
      revision: 1,
      status: "passed",
      findings: [],
      dependencyVersions: { ffmpeg: "7.1", ffprobe: "7.1" }
    });
    expect(context.repository.getRenderPreflight(result.id).snapshot).toMatchObject({
      version: "render-snapshot-v1",
      short: { id: context.project.id, revision: 1 },
      output: {
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
        maximumDurationMs: 180_000
      }
    });
    expect(() => context.repository.db.prepare(
      "UPDATE render_preflights SET snapshot_hash='changed' WHERE id=?"
    ).run(result.id)).toThrow(/immutable/);
    expect(() => context.repository.db.prepare(
      "DELETE FROM render_preflights WHERE id=?"
    ).run(result.id)).toThrow(/immutable/);
    expect({
      renders: context.repository.db.prepare("SELECT count(*) count FROM renders").get(),
      jobs: context.repository.db.prepare("SELECT count(*) count FROM jobs").get(),
      artifacts: context.repository.db.prepare("SELECT count(*) count FROM artifact_records").get()
    }).toEqual(before);
  });

  it("passes exactly 180 seconds, warns above 60 seconds, and fails over 180 seconds", async () => {
    const exact = fixture(180_000);
    const exactResult = await exact.preflights.preflight(exact.project.id, 1);
    expect(exactResult.status).toBe("passed");
    expect(exactResult.findings).toContainEqual(expect.objectContaining({
      code: "CONTENT_ID_WARNING",
      severity: "warning",
      helpUrl: YOUTUBE_CONTENT_ID_HELP_URL
    }));

    const over = fixture(180_001);
    const overResult = await over.preflights.preflight(over.project.id, 1);
    expect(overResult.status).toBe("failed");
    expect(overResult.findings.map((finding) => finding.code)).toEqual([
      "DURATION_EXCEEDED",
      "CONTENT_ID_WARNING"
    ]);
  });

  it("produces the same hash for unchanged inputs while creating distinct audit records", async () => {
    const context = fixture();
    const first = await context.preflights.preflight(context.project.id, 1);
    const second = await context.preflights.preflight(context.project.id, 1);
    expect(second.id).not.toBe(first.id);
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(context.repository.listRenderPreflights(context.project.id)).toHaveLength(2);
  });

  it("turns approval and independent dependency failures into persisted findings", async () => {
    const context = fixture();
    const unapproved = context.repository.updateShort(context.project.id, 1, {
      composition: structuredClone(context.project.composition)
    });
    const unavailable = new RenderPreflightService(context.repository, undefined, {
      ffmpegPath: "missing-ffmpeg",
      ffprobePath: "missing-ffprobe",
      now: () => "2026-07-28T12:00:00.000Z",
      run: async () => { throw new Error("unavailable"); }
    });
    const result = await unavailable.preflight(unapproved.id, unapproved.revision);
    expect(result.status).toBe("failed");
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "SHORT_NOT_APPROVED",
      "FFMPEG_UNAVAILABLE",
      "FFPROBE_UNAVAILABLE"
    ]);
    expect(context.repository.getRenderPreflight(result.id).result).toEqual(result);
  });

  it("validates every layer when one asset is reused across bindings", async () => {
    const context = fixture();
    const assetId = randomUUID();
    context.repository.saveAsset({
      id: assetId,
      sourcePath: context.sourcePath,
      ownedArtifactPath: null,
      kind: "video",
      provenance: "test",
      reusable: true,
      tags: [],
      width: 1920,
      height: 1080,
      durationMs: 240_000,
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z"
    });
    const composition = structuredClone(context.project.composition);
    for (const layer of composition.layers) layer.assetId = assetId;
    const updated = context.repository.updateShort(context.project.id, 1, { composition });

    const result = await context.preflights.preflight(updated.id, updated.revision);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "ASSET_KIND_MISMATCH",
      details: {
        assetId,
        layerId: "subject",
        expectedKind: "image",
        actualKind: "video"
      }
    }));
  });

  it("persists nothing for a stale request or a concurrent edit before insertion", async () => {
    const stale = fixture();
    await expect(stale.preflights.preflight(stale.project.id, 2)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 2, actualRevision: 1 }
    });
    expect(stale.repository.listRenderPreflights()).toEqual([]);

    let concurrent!: ReturnType<typeof fixture>;
    concurrent = fixture(30_000, () => {
      concurrent.repository.updateShort(concurrent.project.id, 1, { title: "Concurrent edit" });
    });
    await expect(concurrent.preflights.preflight(concurrent.project.id, 1)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 1, actualRevision: 2 }
    });
    expect(concurrent.repository.listRenderPreflights()).toEqual([]);
  });

  it("returns no paths, probe stderr, or internal snapshot through HTTP and MCP", async () => {
    const context = fixture();
    const service = new CoreService(
      context.repository,
      {} as never,
      new JobQueue(context.repository),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      context.preflights
    );
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const response = await fetch(`${base}/renders/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortId: context.project.id, expectedRevision: 1 })
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(context.sourcePath);
    expect(text).not.toContain("raw-path-should-never-escape");
    expect(text).not.toContain("snapshot_json");
    expect(text).not.toContain('"snapshot"');

    const invalid = await fetch(`${base}/renders/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shortId: context.project.id,
        expectedRevision: 1,
        unknown: true
      })
    });
    expect(invalid.status).toBe(422);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "render-preflight-test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    const discovered = (await client.listTools()).tools.find(
      (tool) => tool.name === "renders.preflight"
    );
    expect(discovered?.outputSchema).toBeDefined();
    const mcp = await client.callTool({
      name: "renders.preflight",
      arguments: { shortId: context.project.id, expectedRevision: 1 }
    });
    expect(mcp.isError).not.toBe(true);
    expect(renderPreflightResultSchema.parse(mcp.structuredContent))
      .toEqual(mcp.structuredContent);
    const mcpText = JSON.stringify(mcp.content);
    expect(mcpText).toContain(context.project.id);
    expect(mcpText).not.toContain("render-snapshot-v1");
    expect(mcpText).not.toContain(context.sourcePath);
  }, 10_000);
});
