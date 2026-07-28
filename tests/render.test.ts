import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../src/core/artifact-store";
import { CaptionEngine } from "../src/core/captions";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import {
  buildRenderGraph,
  RENDER_GRAPH_VERSION
} from "../src/core/render-composition";
import { CompositionRenderer } from "../src/core/render";
import {
  RenderPreflightService,
  renderSnapshotSchema
} from "../src/core/render-preflight";
import { Repository } from "../src/core/repository";
import {
  renderStartRequestSchema,
  renderStartResultSchema,
  type ShortProject
} from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { captionState, episode } from "./factories";

const directories: string[] = [];
const repositories: Repository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function graphSnapshot(templateIndex = 1) {
  const template = starterTemplates[templateIndex]!;
  const now = "2026-07-28T12:00:00.000Z";
  const source = episode({
    sourcePath: "/media/Source with spaces.mp4",
    canonicalPath: "/media/Source with spaces.mp4",
    contentHash: "a".repeat(64),
    fileSize: 100,
    modifiedAtMs: 100,
    durationMs: 10_000
  });
  const short: ShortProject = {
    id: randomUUID(),
    episodeId: source.id,
    candidateId: null,
    title: "Graph",
    sourceRanges: [{ startMs: 1_000, endMs: 3_000 }, { startMs: 5_000, endMs: 7_000 }],
    templateId: template.id,
    templateLineage: {
      templateId: template.id,
      templateVersion: template.version,
      parentTemplateId: null
    },
    composition: structuredClone(template.composition),
    captions: captionState([{
      id: randomUUID(),
      startMs: 1_000,
      endMs: 2_000,
      text: "It's 50% ready: now",
      words: [{ startMs: 1_000, endMs: 1_400, text: "It's" }]
    }]),
    audio: {
      sourceGainDb: -1,
      sourceMuted: false,
      cutFadeMs: 100,
      bedAssetId: null,
      bedGainDb: null,
      warnings: []
    },
    copy: {
      cleanedTranscript: "", rewrite: "", hookVariants: [], titles: [],
      description: "", hashtags: [], thumbnailText: ""
    },
    copyState: "accepted",
    copySource: "legacy_accepted",
    approved: true,
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
  const trackedLayer = short.composition.layers.find((layer) => layer.type === "video");
  if (trackedLayer?.type === "video") {
    trackedLayer.automaticCropTrack.frames = [
      { atMs: 0, x: 0, y: 0, width: 0.7, height: 1 },
      { atMs: 4_000, x: 0.3, y: 0, width: 0.7, height: 1 }
    ];
    trackedLayer.manualCropTrack = [
      { id: randomUUID(), mode: "crop", atMs: 1_000, x: 0.1, y: 0, width: 0.7, height: 1 },
      { id: randomUUID(), mode: "crop", atMs: 2_000, x: 0.2, y: 0, width: 0.7, height: 1 },
      { id: randomUUID(), mode: "automatic", atMs: 3_000 }
    ];
  }
  return renderSnapshotSchema.parse({
    version: "render-snapshot-v1",
    short,
    template: {
      lineage: short.templateLineage,
      materializedComposition: short.composition
    },
    sourceRanges: short.sourceRanges,
    output: {
      width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac",
      container: "mp4", maximumDurationMs: 180_000, durationMs: 4_000
    },
    decisions: {
      captions: { engineVersion: "captions-v1", analysis: null },
      crops: { generatorVersion: "crop-v1", smoothingVersion: "smooth-v1", layers: [] },
      audio: {
        version: "audio-decisions-v1",
        outputDurationMs: 4_000,
        source: short.sourceRanges.map((range, index) => ({
          source: "episode",
          episodeId: source.id,
          sourceStartMs: range.startMs,
          sourceEndMs: range.endMs,
          outputStartMs: index * 2_000,
          outputEndMs: (index + 1) * 2_000,
          gainDb: -1,
          muted: false,
          fadeInMs: 100,
          fadeOutMs: 100
        })),
        bed: null,
        warnings: []
      }
    },
    resources: {
      episode: {
        identity: source,
        file: {
          path: source.sourcePath,
          before: { size: 100, modifiedAtMs: 100 },
          after: { size: 100, modifiedAtMs: 100 },
          contentHash: "a".repeat(64),
          media: {
            durationMs: 10_000, width: 1920, height: 1080,
            videoCodec: "h264", audioCodec: "aac"
          }
        }
      },
      assets: []
    },
    dependencyVersions: { ffmpeg: "8.1.2", ffprobe: "8.1.2" }
  });
}

describe("explicit FFmpeg render contracts and graph", () => {
  it("defaults sidecars to null and rejects unknown start fields", () => {
    const request = {
      shortId: randomUUID(),
      expectedRevision: 1,
      preflightId: randomUUID()
    };
    expect(renderStartRequestSchema.parse(request)).toEqual({ ...request, sidecarFormat: null });
    expect(renderStartRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
  });

  it.each([0, 1, 2])(
    "builds starter template %i deterministically without shell interpolation",
    (templateIndex) => {
    const snapshot = graphSnapshot(templateIndex);
    const first = buildRenderGraph(snapshot, "/tmp/filter script", "/tmp/output file.mp4", "/tmp/fonts");
    const second = buildRenderGraph(snapshot, "/tmp/filter script", "/tmp/output file.mp4", "/tmp/fonts");
    expect(second).toEqual(first);
    expect(first.graphHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.script).toContain("concat=n=2:v=1:a=0");
    expect(first.script).toContain("asplit=2");
    expect(first.script).toContain("fontcolor=0xffdc5e");
    expect(first.script).toContain("if(lt(t\\,");
    expect(first.outputArgs).toContain("/tmp/output file.mp4");
    expect(first.outputArgs).toContain("+faststart");
    expect(first.outputArgs).toContain("pipe:1");
  });
});

describe.runIf(Boolean(process.env.CI_REAL_MEDIA) || process.platform !== "win32")(
  "real FFmpeg composition",
  () => {
    it("renders, validates, hashes, and finalizes a snapshot-bound MP4 and sidecar", async () => {
      const directory = mkdtempSync(join(tmpdir(), "short-editor-render-"));
      directories.push(directory);
      const sourcePath = join(directory, "source with spaces.mp4");
      execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath
      ]);
      const state = statSync(sourcePath);
      const repository = new Repository(openDatabase(join(directory, "editor.db")));
      repositories.push(repository);
      const source = episode({
        sourcePath,
        canonicalPath: sourcePath,
        contentHash: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
        fileSize: state.size,
        modifiedAtMs: Math.round(state.mtimeMs),
        durationMs: 2_000,
        width: 320,
        height: 240
      });
      repository.insertEpisode(source);
      const template = starterTemplates[1]!;
      const now = new Date().toISOString();
      const project: ShortProject = {
        ...graphSnapshot(1).short,
        id: randomUUID(),
        episodeId: source.id,
        sourceRanges: [{ startMs: 0, endMs: 1_000 }],
        templateId: template.id,
        templateLineage: {
          templateId: template.id, templateVersion: 1, parentTemplateId: null
        },
        composition: structuredClone(template.composition),
        captions: captionState(execFileSync("ffmpeg", ["-hide_banner", "-filters"], {
          encoding: "utf8"
        }).includes(" drawtext ")
          ? [{
              id: randomUUID(),
              startMs: 0,
              endMs: 800,
              text: "Hello world",
              words: [
                { startMs: 0, endMs: 350, text: "Hello" },
                { startMs: 350, endMs: 800, text: "world" }
              ]
            }]
          : []),
        audio: {
          sourceGainDb: 0, sourceMuted: false, cutFadeMs: 50,
          bedAssetId: null, bedGainDb: null, warnings: []
        },
        createdAt: now,
        updatedAt: now
      };
      const speakerLayer = project.composition.layers.find(
        (layer) => layer.type === "video"
      );
      if (speakerLayer?.type === "video") {
        speakerLayer.automaticCropTrack.frames = [
          { atMs: 0, x: 0, y: 0, width: 0.75, height: 1 },
          { atMs: 1_000, x: 0.25, y: 0, width: 0.75, height: 1 }
        ];
      }
      repository.createShort(project);
      const store = new ArtifactStore(directory, repository);
      const jobs = new JobQueue(repository);
      const captions = new CaptionEngine();
      const preflight = await new RenderPreflightService(repository, captions, {
        resolveOwnedPath: (path) => store.resolveOwnedPath(path)
      }).preflight(project.id, 1);
      expect(preflight.status).toBe("passed");
      const failedPreflight = repository.insertRenderPreflight(
        1,
        repository.getRenderPreflight(preflight.id).snapshot,
        { ...preflight, id: randomUUID(), status: "failed" }
      );
      expect(() => repository.startRenderAttempt({
        shortId: project.id,
        expectedRevision: 1,
        preflightId: failedPreflight.id,
        sidecarFormat: null
      })).toThrow(/passing/);
      expect(() => repository.startRenderAttempt({
        shortId: project.id,
        expectedRevision: 2,
        preflightId: preflight.id,
        sidecarFormat: null
      })).toThrow(/edited by another client/);
      expect(repository.listRenders()).toEqual([]);
      expect(repository.listJobs()).toEqual([]);
      const started = repository.startRenderAttempt({
        shortId: project.id,
        expectedRevision: 1,
        preflightId: preflight.id,
        sidecarFormat: "webvtt"
      });
      expect(renderStartResultSchema.parse(started)).toEqual(started);
      const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
      const payload = repository.db.prepare(
        "SELECT payload_json FROM jobs WHERE id=?"
      ).get(started.job.id) as { payload_json: string };
      try {
        await new CompositionRenderer(repository, store, jobs, captions).render(
          started.job,
          JSON.parse(payload.payload_json)
        );
      } catch (error) {
        throw error;
      }
      const completed = repository.getRender(started.render.id);
      expect(completed).toMatchObject({
        state: "succeeded",
        preflightId: preflight.id,
        decisionHash: preflight.snapshotHash,
        sidecarPath: `artifacts/renders/${started.render.id}/captions.vtt`
      });
      expect(completed.outputPath).toBe(`artifacts/renders/${started.render.id}/final.mp4`);
      expect(completed.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(completed.validation).toMatchObject({
        valid: true,
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac"
      });
      expect((completed.encoder.settings as Record<string, unknown>).graphVersion)
        .toBe(RENDER_GRAPH_VERSION);
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(sourceHash);
    }, 90_000);
  }
);
