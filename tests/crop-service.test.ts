import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ArtifactStore } from "../src/core/artifact-store";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import { starterTemplates } from "../src/shared/templates";
import type { ShortProject } from "../src/shared/domain";
import { captionState, episode } from "./factories";

const directories: string[] = [];
const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];
const now = "2026-07-28T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function setup(speakerLayerId = "speaker") {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-crops-"));
  directories.push(directory);
  const repository = new Repository(openDatabase(join(directory, "short-editor.db")));
  repositories.push(repository);
  const source = episode({ durationMs: 60_000 });
  repository.insertEpisode(source);
  const project: ShortProject = {
    id: randomUUID(),
    episodeId: source.id,
    candidateId: null,
    title: "Crop fixture",
    sourceRanges: [{ startMs: 10_000, endMs: 20_000 }],
    templateId: starterTemplates[2]!.id,
    templateLineage: {
      templateId: starterTemplates[2]!.id,
      templateVersion: 1,
      parentTemplateId: null
    },
    composition: {
      ...structuredClone(starterTemplates[2]!.composition),
      layers: structuredClone(starterTemplates[2]!.composition.layers).map((layer) =>
        layer.id === "speaker" ? { ...layer, id: speakerLayerId } : layer
      )
    },
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
  const store = new ArtifactStore(directory, repository);
  const service = new CoreService(repository, {} as never, new JobQueue(repository), store);
  return { directory, repository, source, project, store, service };
}

function addVisualArtifact(context: ReturnType<typeof setup>) {
  return context.store.finalize({
    kind: "analysis_visual_input",
    ownerType: "episode",
    ownerId: context.source.id,
    ownerRevision: 1,
    relativePath: `artifacts/episodes/${context.source.id}/analysis-inputs/${randomUUID()}/visual.json`,
    producerVersion: "visual-sampling-v1",
    bytes: Buffer.from(JSON.stringify({
      capabilities: {
        activity: "supported",
        speakerFraming: "supported",
        faceDetection: "supported",
        screenShareDetection: "supported"
      },
      samples: [
        {
          atMs: 10_000,
          activity: 0.5,
          speakerFraming: 0.8,
          faceCount: 1,
          screenShare: true,
          faces: [{ x: 0.4, y: 0.1, width: 0.1, height: 0.2 }],
          people: [{ x: 0.3, y: 0.1, width: 0.3, height: 0.8 }],
          screens: [{ x: 0.05, y: 0.05, width: 0.9, height: 0.7 }]
        }
      ],
      provenance: {}
    }))
  });
}

function addRenderAndSchedules(context: ReturnType<typeof setup>) {
  const renderId = randomUUID();
  context.repository.db.prepare(`
    INSERT INTO renders(id,short_id,project_revision,encoder_json,state,created_at,updated_at)
    VALUES(?,?,1,'{}','succeeded',?,?)
  `).run(renderId, context.project.id, now, now);
  for (const [index, status] of ["draft", "published"].entries()) {
    context.repository.db.prepare(`
      INSERT INTO schedule_entries(
        id,short_id,render_id,episode_id,publish_at,timezone,status,priority,rationale,
        locked,needs_rerender,revision,created_at,updated_at
      ) VALUES(?,?,?,?,?,'UTC',?,0,'fixture',?,0,1,?,?)
    `).run(
      randomUUID(),
      context.project.id,
      renderId,
      context.source.id,
      `2026-08-0${index + 1}T12:00:00.000Z`,
      status,
      status === "published" ? 1 : 0,
      now,
      now
    );
  }
}

describe("crop service CAS mutations", () => {
  it("re-analyzes selected layers once, preserves manual tracks bit-for-bit, and invalidates only unpublished output", () => {
    const context = setup();
    addVisualArtifact(context);
    addRenderAndSchedules(context);
    const control = {
      id: randomUUID(),
      mode: "crop" as const,
      atMs: 1_000,
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.4
    };
    let project = context.service.addManualCropControl(context.project.id, "speaker", {
      expectedRevision: 1,
      control
    });
    const before = JSON.stringify(
      project.composition.layers.find((layer) => layer.id === "speaker")
    );
    project = context.service.reanalyzeCrops(project.id, {
      expectedRevision: project.revision,
      layerIds: ["speaker"]
    });
    const speaker = project.composition.layers.find((layer) => layer.id === "speaker")!;
    const screen = project.composition.layers.find((layer) => layer.id === "screen")!;
    expect(project).toMatchObject({ revision: 3, approved: false });
    expect(speaker.type === "video" && speaker.automaticCropTrack.frames.length).toBeGreaterThan(0);
    expect(speaker.type === "video" && speaker.manualCropTrack).toEqual([control]);
    expect(screen.type === "video" && screen.automaticCropTrack.provenance).toBeNull();
    expect(before).toContain(JSON.stringify(control));
    expect(context.repository.db.prepare("SELECT state FROM renders").get()).toEqual({ state: "stale" });
    expect(context.repository.db.prepare(
      "SELECT status,needs_rerender FROM schedule_entries ORDER BY status"
    ).all()).toEqual([
      { status: "draft", needs_rerender: 1 },
      { status: "published", needs_rerender: 0 }
    ]);

    const manualBefore = JSON.stringify(speaker.type === "video" ? speaker.manualCropTrack : []);
    project = context.service.reanalyzeCrops(project.id, {
      expectedRevision: project.revision,
      layerIds: ["speaker"]
    });
    const repeated = project.composition.layers.find((layer) => layer.id === "speaker")!;
    expect(JSON.stringify(repeated.type === "video" ? repeated.manualCropTrack : []))
      .toBe(manualBefore);
  });

  it("adds, moves, resumes, and removes controls independently with strict conflicts and no stale writes", () => {
    const context = setup();
    const cropId = randomUUID();
    let project = context.service.addManualCropControl(context.project.id, "speaker", {
      expectedRevision: 1,
      control: {
        id: cropId,
        mode: "crop",
        atMs: 1_000,
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.5
      }
    });
    const resumeId = randomUUID();
    project = context.service.addManualCropControl(project.id, "speaker", {
      expectedRevision: project.revision,
      control: { id: resumeId, mode: "automatic", atMs: 5_000 }
    });
    project = context.service.moveManualCropControl(project.id, "speaker", {
      expectedRevision: project.revision,
      controlId: cropId,
      atMs: 2_000,
      crop: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }
    });
    const revision = project.revision;
    expect(() => context.service.removeManualCropControl(project.id, "speaker", {
      expectedRevision: revision - 1,
      controlId: cropId
    })).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(context.service.getShort(project.id).revision).toBe(revision);
    project = context.service.removeManualCropControl(project.id, "speaker", {
      expectedRevision: revision,
      controlId: cropId
    });
    const speaker = project.composition.layers.find((layer) => layer.id === "speaker")!;
    expect(speaker.type === "video" && speaker.manualCropTrack).toEqual([
      { id: resumeId, mode: "automatic", atMs: 5_000 }
    ]);
  });

  it("makes no Short changes when artifacts, layers, timestamps, or revisions are invalid", () => {
    const context = setup();
    const revision = context.project.revision;
    expect(() => context.service.reanalyzeCrops(context.project.id, {
      expectedRevision: revision
    })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => context.service.addManualCropControl(context.project.id, "captions", {
      expectedRevision: revision,
      control: { id: randomUUID(), mode: "automatic", atMs: 0 }
    })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => context.service.addManualCropControl(context.project.id, "speaker", {
      expectedRevision: revision,
      control: { id: randomUUID(), mode: "automatic", atMs: 10_001 }
    })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(context.service.getShort(context.project.id)).toMatchObject({
      revision,
      approved: true
    });
  });

  it("exposes add, move, remove, and re-analysis with HTTP/MCP error parity", async () => {
    const layerId = "speaker/primary";
    const encodedLayerId = encodeURIComponent(layerId);
    const context = setup(layerId);
    addVisualArtifact(context);
    const server = createApi(context.service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const controlId = randomUUID();
    const added = await fetch(
      `${base}/shorts/${context.project.id}/layers/${encodedLayerId}/crops/manual`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          control: {
            id: controlId,
            mode: "crop",
            atMs: 1_000,
            x: 0.1,
            y: 0.1,
            width: 0.4,
            height: 0.4
          }
        })
      }
    );
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ data: { revision: 2 } });

    const invalid = await fetch(`${base}/shorts/${context.project.id}/crops/reanalyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 2, layerIds: ["captions"] })
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "crop-service-test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    const moved = await client.callTool({
      name: "shorts.move_manual_crop",
      arguments: {
        shortId: context.project.id,
        layerId,
        expectedRevision: 2,
        controlId,
        atMs: 2_000,
        crop: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }
      }
    });
    expect(moved.isError).not.toBe(true);
    const reanalyzed = await client.callTool({
      name: "shorts.reanalyze_crops",
      arguments: {
        shortId: context.project.id,
        expectedRevision: 3,
        layerIds: [layerId]
      }
    });
    expect(reanalyzed.isError).not.toBe(true);
    const conflict = await client.callTool({
      name: "shorts.remove_manual_crop",
      arguments: {
        shortId: context.project.id,
        layerId,
        expectedRevision: 3,
        controlId
      }
    });
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict.content)).toContain("REVISION_CONFLICT");
    const removed = await client.callTool({
      name: "shorts.remove_manual_crop",
      arguments: {
        shortId: context.project.id,
        layerId,
        expectedRevision: 4,
        controlId
      }
    });
    expect(removed.isError).not.toBe(true);
    const missing = await client.callTool({
      name: "shorts.remove_manual_crop",
      arguments: {
        shortId: context.project.id,
        layerId,
        expectedRevision: 5,
        controlId
      }
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain("NOT_FOUND");
  });
});
