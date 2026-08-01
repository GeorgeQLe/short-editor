import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
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
import {
  CompositionRenderer,
  normalizeRender,
  renderDeterminismIdentity
} from "../src/core/render";
import {
  RenderPreflightService,
  renderSnapshotSchema
} from "../src/core/render-preflight";
import { Repository } from "../src/core/repository";
import { AppError } from "../src/shared/errors";
import {
  renderStartRequestSchema,
  renderStartResultSchema,
  type ShortProject
} from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { captionState, episode } from "./factories";

const directories: string[] = [];
const repositories: Repository[] = [];
const realFfmpeg = process.env.SHORT_EDITOR_TEST_FFMPEG ?? "";
const realFfprobe = process.env.SHORT_EDITOR_TEST_FFPROBE ?? "";
const runRealMedia = process.env.CI_REAL_MEDIA === "1" &&
  realFfmpeg.length > 0 && realFfprobe.length > 0;

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
    captions: {
      ...captionState([{
      id: randomUUID(),
      startMs: 1_000,
      endMs: 2_000,
      text: "It's 50% ready: now",
      words: [{ startMs: 1_000, endMs: 1_400, text: "It's" }]
      }]),
      style: structuredClone(template.composition.captionStylePreset ?? captionState().style)
    },
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

function mediaGraphSnapshot(kind: "image" | "video") {
  const snapshot = graphSnapshot(3);
  const assetId = randomUUID();
  const layer = snapshot.short.composition.layers.find((item) => item.type === "media")!;
  layer.assetId = assetId;
  snapshot.template.materializedComposition = snapshot.short.composition;
  snapshot.resources.assets.push({
    identity: {
      id: assetId,
      sourcePath: `/media/related.${kind === "image" ? "png" : "mp4"}`,
      ownedArtifactPath: null,
      kind,
      provenance: "fixture",
      reusable: true,
      tags: [],
      width: 1280,
      height: 720,
      durationMs: kind === "image" ? null : 1_000,
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z"
    },
    file: {
      path: `/media/related.${kind === "image" ? "png" : "mp4"}`,
      before: { size: 100, modifiedAtMs: 100 },
      after: { size: 100, modifiedAtMs: 100 },
      contentHash: "b".repeat(64),
      media: {
        durationMs: kind === "image" ? null : 1_000,
        width: 1280,
        height: 720,
        videoCodec: kind === "image" ? "png" : "h264",
        audioCodec: null
      }
    }
  });
  return snapshot;
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

  it("binds determinism identity to decisions and completed encoder provenance", () => {
    const encoder = {
      ffmpegVersion: "8.0",
      videoCodec: "libx264",
      audioCodec: "aac",
      settings: { graphVersion: "graph-v1", graphHash: "sha256:one" }
    };
    const identity = renderDeterminismIdentity("sha256:decision", encoder);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    expect(renderDeterminismIdentity("sha256:decision", encoder)).toBe(identity);
    expect(renderDeterminismIdentity("sha256:other", encoder)).not.toBe(identity);
    expect(renderDeterminismIdentity("sha256:decision", {
      ...encoder,
      settings: { ...encoder.settings, graphHash: "sha256:two" }
    })).not.toBe(identity);
  });

  it.each([0, 1, 2, 3])(
    "builds starter template %i deterministically without shell interpolation",
    (templateIndex) => {
    const snapshot = graphSnapshot(templateIndex);
    const first = buildRenderGraph(snapshot, "/tmp/filter script", "/tmp/output file.mp4", "/tmp/fonts");
    const second = buildRenderGraph(snapshot, "/tmp/filter script", "/tmp/output file.mp4", "/tmp/fonts");
    expect(second).toEqual(first);
    expect(first.graphHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.script).toContain("concat=n=2:v=1:a=0");
    expect(first.script).toContain("asplit=2");
    expect(first.script).toContain(
      templateIndex === 3 ? "fontcolor=0x49c7f2" : "fontcolor=0xffdc5e"
    );
    if (templateIndex === 3) {
      expect(first.script).toContain("text='GRAPH'");
      expect(first.script).toContain("fontfile='/tmp/fonts/Inter-Bold.otf'");
      expect(first.script).not.toContain("related-media");
      expect(first.script).toMatch(/fontcolor=0x49c7f2:[^;]+:x=-?\d/);
    }
    expect(first.script).toContain("if(lt(t\\,");
    expect(first.outputArgs).toContain("/tmp/output file.mp4");
    expect(first.outputArgs).toContain("+faststart");
    expect(first.outputArgs).toContain("pipe:1");
  });

  it("omits hidden visual layers from the final render graph", () => {
    const snapshot = graphSnapshot(1);
    snapshot.short.composition.layers = snapshot.short.composition.layers.map((layer) => ({
      ...layer, visible: false
    }));
    const graph = buildRenderGraph(snapshot, "/tmp/filter", "/tmp/output.mp4", "/tmp/fonts");
    expect(graph.script).not.toContain("episode_segment_");
    expect(graph.script).not.toContain("drawtext=");
    expect(graph.script).toContain("color=c=#000000:s=1080x1920");
  });

  it("bounds and redacts normalization subprocess failures", async () => {
    await expect(normalizeRender(
      "/private/secret/render.mp4",
      "/private/secret/missing-ffmpeg",
      1_000
    )).rejects.toMatchObject({
      code: "ARTIFACT_CORRUPT",
      message: "Render normalization failed"
    });
  });

  it.each(["image", "video"] as const)(
    "renders %s related media for the full composition with final-frame repeat",
    (kind) => {
      const graph = buildRenderGraph(
        mediaGraphSnapshot(kind),
        "/tmp/filter",
        "/tmp/output.mp4",
        "/tmp/fonts"
      );
      expect(graph.inputArgs).toEqual(kind === "image"
        ? ["-i", "/media/Source with spaces.mp4", "-loop", "1", "-framerate", "30", "-i", "/media/related.png"]
        : ["-i", "/media/Source with spaces.mp4", "-i", "/media/related.mp4"]);
      expect(graph.script).toContain("overlay=x=0:y=0:eof_action=repeat:shortest=1");
      expect(graph.script).toContain("overlay=x=0:y=998:eof_action=repeat:shortest=1");
    }
  );
});

describe.runIf(runRealMedia)(
  "real FFmpeg composition",
  () => {
    it("renders the news split with related media, source audio, topic, and captions", () => {
      if (!execFileSync(realFfmpeg, ["-hide_banner", "-filters"], {
        encoding: "utf8"
      }).includes(" drawtext ")) return;
      const directory = mkdtempSync(join(tmpdir(), "short-editor-news-render-"));
      directories.push(directory);
      const sourcePath = join(directory, "source.mp4");
      const imagePath = join(directory, "related.png");
      const filterPath = join(directory, "filter.txt");
      const outputPath = join(directory, "news.mp4");
      execFileSync(realFfmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=1",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath
      ]);
      execFileSync(realFfmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=navy:s=640x360",
        "-frames:v", "1", imagePath
      ]);
      const snapshot = mediaGraphSnapshot("image");
      snapshot.resources.episode.file.path = sourcePath;
      snapshot.resources.assets[0]!.file.path = imagePath;
      snapshot.resources.assets[0]!.identity.sourcePath = imagePath;
      snapshot.sourceRanges = [{ startMs: 0, endMs: 1_000 }];
      snapshot.short.sourceRanges = snapshot.sourceRanges;
      snapshot.short.captions.cues = [{
        id: randomUUID(),
        startMs: 0,
        endMs: 800,
        text: "News now",
        words: [{ startMs: 0, endMs: 400, text: "News" }]
      }];
      snapshot.output.durationMs = 1_000;
      snapshot.decisions.audio = {
        version: "audio-decisions-v1",
        outputDurationMs: 1_000,
        source: [{
          source: "episode",
          episodeId: snapshot.short.episodeId,
          sourceStartMs: 0,
          sourceEndMs: 1_000,
          outputStartMs: 0,
          outputEndMs: 1_000,
          gainDb: 0,
          muted: false,
          fadeInMs: 0,
          fadeOutMs: 0
        }],
        bed: null,
        warnings: []
      };
      const graph = buildRenderGraph(
        snapshot,
        filterPath,
        outputPath,
        new CaptionEngine().fontDirectory
      );
      writeFileSync(filterPath, graph.script);
      execFileSync(realFfmpeg, [
        "-hide_banner", "-loglevel", "error",
        ...graph.inputArgs,
        ...graph.outputArgs
      ]);
      const probe = JSON.parse(execFileSync(realFfprobe, [
        "-v", "error",
        "-show_entries", "stream=codec_type,width,height",
        "-of", "json",
        outputPath
      ], { encoding: "utf8" })) as {
        streams: Array<{ codec_type: string; width?: number; height?: number }>;
      };
      expect(probe.streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_type: "video", width: 1080, height: 1920 }),
        expect.objectContaining({ codec_type: "audio" })
      ]));
    }, 30_000);

    it("establishes and matches normalized evidence while cleaning failed attempts", async () => {
      const directory = mkdtempSync(join(tmpdir(), "short-editor-render-"));
      directories.push(directory);
      const sourcePath = join(directory, "source with spaces.mp4");
      execFileSync(realFfmpeg, [
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
        captions: captionState(execFileSync(realFfmpeg, ["-hide_banner", "-filters"], {
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
        resolveOwnedPath: (path) => store.resolveOwnedPath(path),
        ffmpegPath: realFfmpeg,
        ffprobePath: realFfprobe
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
        await new CompositionRenderer(repository, store, jobs, captions, {
          ffmpegPath: realFfmpeg,
          ffprobePath: realFfprobe
        }).render(
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
      expect((completed.encoder.settings as Record<string, unknown>).ffmpegBuildHash)
        .toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(completed.determinism).toMatchObject({
        version: "render-determinism-v1",
        algorithm: "sha256",
        comparison: "baseline",
        referenceRenderId: null,
        video: { pixelFormat: "yuv420p", width: 1080, height: 1920 },
        audio: { sampleFormat: "s16le", sampleRate: 48_000, channels: 2 }
      });
      expect(completed.determinism?.video.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(completed.determinism?.audio.sha256).toMatch(/^[0-9a-f]{64}$/);
      const baselineBytes = readFileSync(store.resolveOwnedPath(completed.outputPath!));
      const baselinePath = store.resolveOwnedPath(completed.outputPath!);
      const remuxPath = join(directory, "metadata-remux.mp4");
      execFileSync(realFfmpeg, [
        "-hide_banner", "-loglevel", "error", "-i", baselinePath,
        "-map", "0", "-c", "copy", "-metadata", "title=Different container metadata", remuxPath
      ]);
      const remuxEvidence = await normalizeRender(remuxPath, realFfmpeg, 1_000);
      expect(remuxEvidence.video).toEqual(completed.determinism!.video);
      expect(remuxEvidence.audio).toEqual(completed.determinism!.audio);

      const changedVideoPath = join(directory, "changed-video.mp4");
      execFileSync(realFfmpeg, [
        "-hide_banner", "-loglevel", "error", "-i", baselinePath,
        "-vf", "eq=brightness=0.05", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "copy", changedVideoPath
      ]);
      const changedVideo = await normalizeRender(changedVideoPath, realFfmpeg, 1_000);
      expect(changedVideo.video.sha256).not.toBe(completed.determinism!.video.sha256);
      expect(changedVideo.audio).toEqual(completed.determinism!.audio);

      const changedAudioPath = join(directory, "changed-audio.mp4");
      execFileSync(realFfmpeg, [
        "-hide_banner", "-loglevel", "error", "-i", baselinePath,
        "-c:v", "copy", "-af", "volume=0.5", "-c:a", "aac", changedAudioPath
      ]);
      const changedAudio = await normalizeRender(changedAudioPath, realFfmpeg, 1_000);
      expect(changedAudio.video).toEqual(completed.determinism!.video);
      expect(changedAudio.audio.sha256).not.toBe(completed.determinism!.audio.sha256);

      const runAttempt = async (
        sidecarFormat: "srt" | "webvtt" | null,
        renderer = new CompositionRenderer(repository, store, jobs, captions, {
          ffmpegPath: realFfmpeg,
          ffprobePath: realFfprobe
        })
      ) => {
        const attempt = repository.startRenderAttempt({
          shortId: project.id,
          expectedRevision: 1,
          preflightId: preflight.id,
          sidecarFormat
        });
        const storedPayload = repository.db.prepare(
          "SELECT payload_json FROM jobs WHERE id=?"
        ).get(attempt.job.id) as { payload_json: string };
        await renderer.render(attempt.job, JSON.parse(storedPayload.payload_json));
        return repository.getRender(attempt.render.id);
      };

      const matched = await runAttempt(null);
      expect(matched).toMatchObject({
        state: "succeeded",
        determinism: {
          comparison: "matched",
          referenceRenderId: completed.id,
          identityHash: completed.determinism!.identityHash,
          video: completed.determinism!.video,
          audio: completed.determinism!.audio
        }
      });

      const mismatchingStart = repository.startRenderAttempt({
        shortId: project.id,
        expectedRevision: 1,
        preflightId: preflight.id,
        sidecarFormat: "srt"
      });
      const mismatchPayload = repository.db.prepare(
        "SELECT payload_json FROM jobs WHERE id=?"
      ).get(mismatchingStart.job.id) as { payload_json: string };
      const baselineEvidence = completed.determinism!;
      await expect(new CompositionRenderer(repository, store, jobs, captions, {
        ffmpegPath: realFfmpeg,
        ffprobePath: realFfprobe,
        normalize: async () => ({
          version: "render-determinism-v1",
          algorithm: "sha256",
          video: {
            ...baselineEvidence.video,
            sha256: baselineEvidence.video.sha256.replace(/^./, (value) => value === "0" ? "1" : "0")
          },
          audio: baselineEvidence.audio
        })
      }).render(mismatchingStart.job, JSON.parse(mismatchPayload.payload_json)))
        .rejects.toMatchObject({ code: "ARTIFACT_CORRUPT" });
      const mismatched = repository.getRender(mismatchingStart.render.id);
      expect(mismatched).toMatchObject({
        state: "failed",
        outputPath: null,
        sidecarPath: null,
        contentHash: null,
        error: { code: "ARTIFACT_CORRUPT" },
        determinism: {
          comparison: "mismatch",
          referenceRenderId: completed.id
        }
      });
      expect(existsSync(join(
        directory,
        `artifacts/renders/${mismatchingStart.render.id}/final.mp4`
      ))).toBe(false);
      expect(repository.listArtifactRecords().filter(
        (artifact) => artifact.ownerId === mismatchingStart.render.id
      )).toEqual([]);
      expect(readFileSync(store.resolveOwnedPath(completed.outputPath!))).toEqual(baselineBytes);

      const audioMismatchStart = repository.startRenderAttempt({
        shortId: project.id,
        expectedRevision: 1,
        preflightId: preflight.id,
        sidecarFormat: null
      });
      repository.transitionRender(audioMismatchStart.render.id, "queued", { state: "running" });
      const audioMismatch = repository.completeRenderAttempt(
        audioMismatchStart.render.id,
        1,
        {
          outputPath: `artifacts/renders/${audioMismatchStart.render.id}/final.mp4`,
          sidecarPath: null,
          validation: completed.validation!,
          contentHash: "sha256:attempt",
          encoder: completed.encoder,
          determinism: {
            version: baselineEvidence.version,
            algorithm: baselineEvidence.algorithm,
            identityHash: baselineEvidence.identityHash,
            video: baselineEvidence.video,
            audio: {
              ...baselineEvidence.audio,
              sha256: baselineEvidence.audio.sha256.replace(
                /^./,
                (value) => value === "0" ? "1" : "0"
              )
            }
          }
        }
      );
      expect(audioMismatch).toMatchObject({
        state: "failed",
        outputPath: null,
        contentHash: null,
        error: { code: "ARTIFACT_CORRUPT" },
        determinism: {
          comparison: "mismatch",
          referenceRenderId: completed.id
        }
      });

      const normalizationStart = repository.startRenderAttempt({
        shortId: project.id,
        expectedRevision: 1,
        preflightId: preflight.id,
        sidecarFormat: null
      });
      const normalizationPayload = repository.db.prepare(
        "SELECT payload_json FROM jobs WHERE id=?"
      ).get(normalizationStart.job.id) as { payload_json: string };
      await expect(new CompositionRenderer(repository, store, jobs, captions, {
        ffmpegPath: realFfmpeg,
        ffprobePath: realFfprobe,
        normalize: async () => {
          throw new AppError("ARTIFACT_CORRUPT", "Render normalization failed", 422);
        }
      }).render(normalizationStart.job, JSON.parse(normalizationPayload.payload_json)))
        .rejects.toMatchObject({ code: "ARTIFACT_CORRUPT" });
      expect(repository.getRender(normalizationStart.render.id)).toMatchObject({
        state: "failed",
        validation: { valid: true },
        determinism: null,
        outputPath: null,
        error: { code: "ARTIFACT_CORRUPT", message: "Render normalization failed" }
      });
      expect(repository.listArtifactRecords().filter(
        (artifact) => artifact.ownerId === normalizationStart.render.id
      )).toEqual([]);

      const retried = repository.retryRenderAttempt(normalizationStart.render.id);
      expect(retried.render).toMatchObject({
        lineageId: normalizationStart.render.id,
        previousRenderId: normalizationStart.render.id,
        attempt: 2,
        projectRevision: normalizationStart.render.projectRevision,
        preflightId: normalizationStart.render.preflightId,
        decisionHash: normalizationStart.render.decisionHash,
        state: "queued"
      });
      const retriedPayload = repository.db.prepare(
        "SELECT payload_json FROM jobs WHERE id=?"
      ).get(retried.job.id) as { payload_json: string };
      expect(JSON.parse(retriedPayload.payload_json)).toMatchObject({
        renderId: retried.render.id,
        projectRevision: normalizationStart.render.projectRevision,
        preflightId: normalizationStart.render.preflightId,
        sidecarFormat: null
      });
      const cancelledJob = jobs.cancel(retried.job.id);
      expect(cancelledJob).toMatchObject({
        state: "cancelled",
        cancelRequested: true,
        errorCode: "JOB_CANCELLED"
      });
      expect(repository.getRender(retried.render.id)).toMatchObject({
        state: "cancelled",
        error: { code: "JOB_CANCELLED" }
      });
      expect(() => repository.retryRenderAttempt(normalizationStart.render.id))
        .toThrow(/newer attempt/);
      const finalAttempt = repository.retryRenderAttempt(retried.render.id);
      expect(finalAttempt.render).toMatchObject({
        lineageId: normalizationStart.render.id,
        previousRenderId: retried.render.id,
        attempt: 3
      });
      jobs.cancel(finalAttempt.job.id);
      expect(() => repository.retryRenderAttempt(finalAttempt.render.id))
        .toThrow(/three-attempt limit/);
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(sourceHash);
    }, 150_000);
  }
);
