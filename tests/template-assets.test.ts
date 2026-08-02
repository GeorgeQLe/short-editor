import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { MediaService } from "../src/core/media";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import type { Asset, ProviderProvenance } from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { episode, segments } from "./factories";

const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];
const now = "2026-07-27T12:00:00.000Z";
const provenance: ProviderProvenance = {
  provider: "fixture",
  providerClass: "local",
  modelId: "fixture-v1",
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
});

function setup(options: { repository?: Repository; media?: MediaService } = {}) {
  const repository = options.repository ?? new Repository(openDatabase(":memory:"));
  repositories.push(repository);
  const source = episode({ durationMs: 400_000 });
  repository.insertEpisode(source);
  repository.replaceTranscriptWithProvenance(source.id, segments(80), "en", provenance);
  const selectedMedia = options.media ?? ({} as MediaService);
  const service = new CoreService(repository, selectedMedia, new JobQueue(repository));
  const generated = service.generateCandidates({
    episodeId: source.id,
    count: 5,
    strategy: "replace_pending",
    mode: "heuristic"
  });
  const candidate = service.reviewCandidate(generated.candidates[0]!.id, 1, "approved");
  return { repository, service, source, candidate };
}

function storedAsset(
  repository: Repository,
  kind: Asset["kind"]
): Asset {
  const timestamp = new Date().toISOString();
  return repository.saveAsset({
    id: randomUUID(),
    sourcePath: `/fixture/${randomUUID()}`,
    ownedArtifactPath: null,
    kind,
    provenance: "fixture rights",
    reusable: true,
    tags: [],
    width: kind === "audio" ? null : 1200,
    height: kind === "audio" ? null : 800,
    durationMs: kind === "image" || kind === "logo" ? null : 10_000,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

describe("Template lineage and Short snapshots", () => {
  it("ships five immutable built-ins and materializes the news preset from the Short title", () => {
    const { service, candidate } = setup();
    expect(starterTemplates).toHaveLength(5);
    expect(starterTemplates.every((template) => template.builtIn)).toBe(true);
    const project = service.createShort(candidate.id, "news-brief-speaker-v1");
    expect(project.title).toBe(candidate.topic);
    expect(project.captions.style).toMatchObject({
      fontFamily: "Inter",
      fontWeight: 700,
      position: { x: 0.5, y: 0.5 },
      maxWidth: 0.88,
      highlightColor: "#49c7f2",
      textTransform: "uppercase"
    });
    expect(project.composition.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "related-media", type: "media", assetId: null,
        region: { x: 0, y: 0, width: 1, height: 0.52 }
      }),
      expect.objectContaining({
        id: "topic", type: "text", content: { binding: "short_title" }
      }),
      expect.objectContaining({ id: "logo", type: "logo", assetId: null })
    ]));
  });

  it("ships a safe-area-aware screen demo with editable fit and crop tracks", () => {
    const template = starterTemplates.find(({ id }) => id === "screen-demo-v1")!;
    expect(template.composition.safeArea).toEqual({
      top: 150, right: 72, bottom: 300, left: 72
    });
    expect(template.composition.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "screen",
        type: "video",
        fit: "fit",
        cropTarget: "screen",
        manualCropTrack: []
      }),
      expect.objectContaining({ id: "captions", type: "captions" })
    ]));
  });

  it("clones built-ins and clones with immediate lineage and independent compositions", () => {
    const { repository, service } = setup();
    const builtIn = starterTemplates[0]!;
    const first = service.cloneTemplate(builtIn.id, "First clone");
    const second = service.cloneTemplate(first.id, "Second clone", "");

    expect(first).toMatchObject({
      name: "First clone",
      description: builtIn.description,
      version: 1,
      revision: 1,
      parentTemplateId: builtIn.id,
      builtIn: false
    });
    expect(second).toMatchObject({
      description: "",
      version: 1,
      revision: 1,
      parentTemplateId: first.id,
      builtIn: false
    });
    first.composition.background = "#mutation-outside-persistence";
    expect(repository.getTemplate(first.id).composition.background).toBe(
      builtIn.composition.background
    );
    expect(repository.getTemplate(second.id).composition).toEqual(builtIn.composition);
    expect(() => service.updateTemplate(builtIn.id, 1, { name: "No" }))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("updates user templates with CAS and snapshots exact versions into future Shorts only", () => {
    const { service, candidate } = setup();
    const clone = service.cloneTemplate("fullscreen-speaker-v1", "Editable");
    const versionTwo = service.updateTemplate(clone.id, clone.revision, {
      name: "Editable v2",
      composition: { ...clone.composition, background: "#111111" }
    });
    expect(versionTwo).toMatchObject({ version: 2, revision: 2 });
    expect(() => service.updateTemplate(clone.id, 1, { description: "stale" }))
      .toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));

    const firstShort = service.createShort(candidate.id, clone.id);
    const versionThree = service.updateTemplate(clone.id, versionTwo.revision, {
      composition: { ...versionTwo.composition, background: "#222222" }
    });
    const secondShort = service.createShort(candidate.id, clone.id);

    expect(firstShort.templateLineage).toEqual({
      templateId: clone.id,
      templateVersion: 2,
      parentTemplateId: "fullscreen-speaker-v1"
    });
    expect(firstShort.composition.background).toBe("#111111");
    expect(secondShort.templateLineage.templateVersion).toBe(3);
    expect(secondShort.composition.background).toBe("#222222");
    expect(service.getShort(firstShort.id)).toEqual(firstShort);
    expect(versionThree.revision).toBe(3);
  });

  it("allows unbound template assets but validates bound IDs and kinds on Shorts", () => {
    const { repository, service, candidate } = setup();
    const image = storedAsset(repository, "image");
    const video = storedAsset(repository, "video");
    const clone = service.cloneTemplate("split-subject-speaker-v1", "Bound subject");
    const subjectIndex = clone.composition.layers.findIndex((layer) => layer.id === "subject");
    clone.composition.layers[subjectIndex]!.assetId = image.id;
    service.updateTemplate(clone.id, 1, { composition: clone.composition });
    const project = service.createShort(candidate.id, clone.id);
    expect(project.composition.layers[subjectIndex]!.assetId).toBe(image.id);

    const mismatch = structuredClone(project.composition);
    mismatch.layers[subjectIndex]!.assetId = video.id;
    expect(() => service.updateTemplate(clone.id, 2, { composition: mismatch }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => service.updateComposition(project.id, project.revision, mismatch))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    const missing = structuredClone(project.composition);
    missing.layers[subjectIndex]!.assetId = randomUUID();
    expect(() => service.updateTemplate(clone.id, 2, { composition: missing }))
      .toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => service.updateComposition(project.id, project.revision, missing))
      .toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(service.listTemplates().find((template) => template.id === clone.id)?.revision).toBe(2);
    expect(service.getShort(project.id).revision).toBe(project.revision);
  });

  it("accepts image or video in media layers and rejects audio and logo assets", () => {
    const { repository, service } = setup();
    const image = storedAsset(repository, "image");
    const video = storedAsset(repository, "video");
    const audio = storedAsset(repository, "audio");
    const logo = storedAsset(repository, "logo");
    const clone = service.cloneTemplate("news-brief-speaker-v1", "Media variants");
    const bind = (assetId: string) => {
      const composition = structuredClone(clone.composition);
      const media = composition.layers.find((layer) => layer.type === "media")!;
      media.assetId = assetId;
      return composition;
    };
    expect(service.updateTemplate(clone.id, 1, { composition: bind(image.id) }).revision).toBe(2);
    expect(service.updateTemplate(clone.id, 2, { composition: bind(video.id) }).revision).toBe(3);
    expect(() => service.updateTemplate(clone.id, 3, { composition: bind(audio.id) }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => service.updateTemplate(clone.id, 3, { composition: bind(logo.id) }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("Template and asset HTTP/MCP parity", () => {
  it("exposes strict clone/update/import operations and structured failures", async () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-edt02-"));
    const probe = join(directory, "fake-ffprobe.mjs");
    writeFileSync(probe, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  format: {},
  streams: [{ codec_type: "video", codec_name: "png", width: 640, height: 480 }]
}));
`);
    chmodSync(probe, 0o755);
    const repository = new Repository(openDatabase(":memory:"));
    const media = new MediaService(repository, probe);
    const context = setup({ repository, media });
    const assetPath = join(directory, "subject.png");
    writeFileSync(assetPath, "unchanged image fixture");
    const server = createApi(context.service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

    const unknown = await fetch(`${base}/templates/fullscreen-speaker-v1/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HTTP clone", unknown: true })
    });
    expect(unknown.status).toBe(422);
    const clonedResponse = await fetch(`${base}/templates/fullscreen-speaker-v1/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HTTP clone" })
    });
    const clonedPayload = await clonedResponse.json() as { data: { id: string; revision: number } };
    expect(clonedResponse.status).toBe(200);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "edt02-test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    const updated = await client.callTool({
      name: "templates.update",
      arguments: {
        templateId: clonedPayload.data.id,
        expectedRevision: clonedPayload.data.revision,
        description: "Updated through MCP"
      }
    });
    expect(updated.isError).not.toBe(true);
    const imported = await client.callTool({
      name: "assets.import",
      arguments: {
        path: assetPath,
        provenance: "Publisher-owned",
        reusable: false
      }
    });
    expect(imported.isError).not.toBe(true);
    expect(context.repository.listAssets()[0]).toMatchObject({
      sourcePath: realpathSync(assetPath),
      kind: "image",
      width: 640,
      height: 480,
      durationMs: null,
      reusable: false
    });

    const immutable = await fetch(`${base}/templates/fullscreen-speaker-v1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, name: "Forbidden" })
    });
    expect(await immutable.json()).toMatchObject({
      error: { code: "INVALID_STATE", retryable: false }
    });
    const conflict = await client.callTool({
      name: "templates.update",
      arguments: {
        templateId: clonedPayload.data.id,
        expectedRevision: 1,
        name: "Stale"
      }
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining("REVISION_CONFLICT") })
    ]));
  });
});
