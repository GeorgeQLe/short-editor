import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import { z } from "zod";
import type {
  Asset,
  Episode,
  RenderPreflightFinding,
  RenderPreflightFindingCode,
  RenderPreflightResult,
  ShortProject
} from "../shared/domain.js";
import {
  assetSchema,
  audioDecisionSchema,
  compositionSchema,
  episodeSchema,
  renderPreflightFindingSchema,
  renderPreflightResultSchema,
  sourceRangesSchema,
  templateLineageSchema,
  shortProjectSchema
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import { canonicalJson } from "./analysis-cache.js";
import { buildAudioDecision } from "./audio.js";
import {
  CAPTION_ENGINE_VERSION,
  CaptionEngine
} from "./captions.js";
import {
  CROP_GENERATOR_VERSION,
  CROP_SMOOTHING_VERSION
} from "./crops.js";
import type { Repository } from "./repository.js";

export const RENDER_SNAPSHOT_VERSION = "render-snapshot-v1";
export const MAXIMUM_RENDER_DURATION_MS = 180_000;
export const CONTENT_ID_WARNING_THRESHOLD_MS = 60_000;
export const YOUTUBE_CONTENT_ID_HELP_URL =
  "https://support.google.com/youtube/answer/15424877?hl=en";

const fileStateSchema = z.strictObject({
  size: z.number().int().nonnegative(),
  modifiedAtMs: z.number().nonnegative()
});
const capturedFileSchema = z.strictObject({
  path: z.string().min(1),
  before: fileStateSchema.nullable(),
  after: fileStateSchema.nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  media: z.strictObject({
    durationMs: z.number().int().positive().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    videoCodec: z.string().min(1).nullable(),
    audioCodec: z.string().min(1).nullable()
  }).nullable()
});
export const renderSnapshotSchema = z.strictObject({
  version: z.literal(RENDER_SNAPSHOT_VERSION),
  short: shortProjectSchema,
  template: z.strictObject({
    lineage: templateLineageSchema,
    materializedComposition: compositionSchema
  }),
  sourceRanges: sourceRangesSchema,
  output: z.strictObject({
    width: z.literal(1080),
    height: z.literal(1920),
    videoCodec: z.literal("h264"),
    audioCodec: z.literal("aac"),
    container: z.literal("mp4"),
    maximumDurationMs: z.literal(MAXIMUM_RENDER_DURATION_MS),
    durationMs: z.number().int().positive()
  }),
  decisions: z.strictObject({
    captions: z.strictObject({
      engineVersion: z.string().min(1),
      analysis: z.unknown().nullable()
    }),
    crops: z.strictObject({
      generatorVersion: z.string().min(1),
      smoothingVersion: z.string().min(1),
      layers: z.array(z.unknown())
    }),
    audio: audioDecisionSchema.nullable()
  }),
  resources: z.strictObject({
    episode: z.strictObject({ identity: episodeSchema, file: capturedFileSchema }),
    assets: z.array(z.strictObject({ identity: assetSchema, file: capturedFileSchema }))
  }),
  dependencyVersions: z.strictObject({
    ffmpeg: z.string().min(1).nullable(),
    ffprobe: z.string().min(1).nullable()
  })
});
export type RenderSnapshot = z.infer<typeof renderSnapshotSchema>;

type FindingDefinition = Omit<RenderPreflightFinding, "code" | "details">;

export const renderPreflightFindingRegistry = {
  SHORT_NOT_APPROVED: definition("error", "approval", "The Short revision is not approved.", "Approve this exact Short revision before rendering."),
  SOURCE_MISSING: definition("error", "source", "The Episode source is unavailable.", "Relink or restore the Episode source."),
  SOURCE_CHANGED: definition("error", "source", "The Episode source no longer matches its inventoried identity.", "Re-import or explicitly relink the source before rendering."),
  SOURCE_PROBE_FAILED: definition("error", "source", "The Episode source could not be inspected.", "Verify that the source is readable and contains supported media."),
  SOURCE_VIDEO_STREAM_MISSING: definition("error", "source", "The Episode source has no supported video stream.", "Select a source containing a supported video stream."),
  SOURCE_VIDEO_STREAM_UNSUPPORTED: definition("error", "source", "The Episode video stream is unsupported.", "Use the guaranteed H.264 input format."),
  SOURCE_AUDIO_STREAM_MISSING: definition("error", "source", "The Episode source has no audio stream.", "Select a source with audio or add a valid audio workflow before rendering."),
  SOURCE_AUDIO_STREAM_UNSUPPORTED: definition("error", "source", "The Episode audio stream is unsupported.", "Use the guaranteed AAC input format."),
  SOURCE_RANGE_INVALID: definition("error", "range", "A selected source range is outside the Episode media.", "Adjust the range to fit the Episode duration."),
  ASSET_MISSING: definition("error", "asset", "A bound composition asset is unavailable.", "Restore the asset or remove its layer binding."),
  ASSET_CHANGED: definition("error", "asset", "A bound asset changed while it was inspected.", "Wait for the file to stabilize, then run preflight again."),
  ASSET_KIND_MISMATCH: definition("error", "asset", "A bound asset does not match its composition layer.", "Bind an asset of the required type."),
  ASSET_INTEGRITY_FAILED: definition("error", "asset", "An application-owned asset failed integrity verification.", "Restore or recreate the owned asset."),
  ASSET_PROBE_FAILED: definition("error", "asset", "A bound asset could not be inspected.", "Verify that the asset is readable and uses a supported media format."),
  CAPTION_OVERFLOW: definition("warning", "caption", "A caption exceeds its layout bounds.", "Shorten the caption or adjust its size and width."),
  CAPTION_SAFE_AREA: definition("warning", "caption", "A caption crosses the safe area.", "Move or resize the caption inside the safe area."),
  CAPTION_MISSING_GLYPH: definition("warning", "caption", "The packaged font cannot render part of a caption.", "Replace unsupported characters or choose supported text."),
  CAPTION_SHORT_CUE: definition("warning", "caption", "A caption cue is shorter than 500 ms.", "Lengthen the cue for readability."),
  CAPTION_OVERLAP: definition("warning", "caption", "Caption cues overlap.", "Adjust cue timing to avoid overlap."),
  CAPTION_OUTSIDE_SOURCE_RANGE: definition("warning", "caption", "A caption cue is outside the selected source ranges.", "Move or remove the cue."),
  CAPTION_FONT_UNAVAILABLE: definition("error", "caption", "The packaged caption font is unavailable.", "Repair the application font installation."),
  CROP_BOUNDS_INVALID: definition("error", "crop", "A crop decision exceeds normalized source bounds.", "Adjust or regenerate the crop decision."),
  CROP_TIMESTAMP_INVALID: definition("error", "crop", "A crop decision is outside the Short timeline.", "Move or remove the crop decision."),
  AUDIO_BED_INVALID: definition("error", "audio", "The selected background audio is invalid.", "Bind a readable audio asset with valid duration."),
  AUDIO_SPEECH_BACKGROUND_RATIO: definition("warning", "audio", "Background audio may obscure speech.", "Lower the background bed or restore source speech."),
  AUDIO_SOURCE_MISSING: definition("error", "audio", "Source audio is required but unavailable.", "Use a source with audio or explicitly revise the audio plan."),
  DURATION_EXCEEDED: definition("error", "duration", "The Short exceeds the 180 second output limit.", "Reduce selected source ranges to 180 seconds or less."),
  FFMPEG_UNAVAILABLE: definition("error", "dependency", "FFmpeg is unavailable.", "Install or configure a supported FFmpeg executable."),
  FFPROBE_UNAVAILABLE: definition("error", "dependency", "FFprobe is unavailable.", "Install or configure a supported FFprobe executable."),
  OUTPUT_SETTINGS_INVALID: definition("error", "output", "Output settings do not match the v1 render contract.", "Use 1080×1920 H.264/AAC MP4 output settings."),
  SAFE_AREA_INVALID: definition("error", "safe_area", "The composition safe area exceeds the output canvas.", "Reduce the safe-area insets."),
  CONTENT_ID_WARNING: {
    ...definition("warning", "content_id", "Shorts over 60 seconds may be affected by active Content ID claims.", "Review music and rights before publishing."),
    helpUrl: YOUTUBE_CONTENT_ID_HELP_URL
  }
} as const satisfies Record<RenderPreflightFindingCode, FindingDefinition>;

export interface RenderPreflightOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  resolveOwnedPath?: (relativePath: string) => string;
  now?: () => string;
  beforeInsert?: () => void | Promise<void>;
  run?: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

interface FileSnapshot {
  path: string;
  before: FileState | null;
  after: FileState | null;
  contentHash: string | null;
  media: MediaProbe | null;
}

interface FileState {
  size: number;
  modifiedAtMs: number;
}

interface MediaProbe {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export class RenderPreflightService {
  private readonly run: NonNullable<RenderPreflightOptions["run"]>;

  constructor(
    private readonly repository: Repository,
    private readonly captionEngine = new CaptionEngine(),
    private readonly options: RenderPreflightOptions = {}
  ) {
    this.run = options.run ?? runProcess;
  }

  async preflight(shortId: string, expectedRevision: number): Promise<RenderPreflightResult> {
    const project = this.repository.getShort(shortId);
    if (project.revision !== expectedRevision) {
      throw revisionConflict(expectedRevision, project.revision);
    }
    const episode = this.repository.getEpisode(project.episodeId);
    const findings: RenderPreflightFinding[] = [];
    if (!project.approved) findings.push(finding("SHORT_NOT_APPROVED"));

    const [ffmpeg, ffprobe] = await Promise.all([
      this.dependencyVersion(this.options.ffmpegPath ?? process.env.SHORT_EDITOR_FFMPEG ?? "ffmpeg"),
      this.dependencyVersion(this.options.ffprobePath ?? process.env.SHORT_EDITOR_FFPROBE ?? "ffprobe")
    ]);
    if (ffmpeg === null) findings.push(finding("FFMPEG_UNAVAILABLE"));
    if (ffprobe === null) findings.push(finding("FFPROBE_UNAVAILABLE"));

    const ffprobePath = this.options.ffprobePath ?? process.env.SHORT_EDITOR_FFPROBE ?? "ffprobe";
    const source = await this.inspectResource(episode.sourcePath, ffprobe === null ? null : ffprobePath);
    this.sourceFindings(episode, project, source, ffprobe !== null, findings);

    const assets = await this.inspectAssets(project, ffprobe === null ? null : ffprobePath, findings);
    const durationMs = outputDuration(project);
    if (durationMs > MAXIMUM_RENDER_DURATION_MS) {
      findings.push(finding("DURATION_EXCEEDED", { durationMs, maximumDurationMs: MAXIMUM_RENDER_DURATION_MS }));
    }
    if (durationMs > CONTENT_ID_WARNING_THRESHOLD_MS) {
      findings.push(finding("CONTENT_ID_WARNING", { durationMs }));
    }
    this.outputFindings(project, durationMs, findings);

    let captionAnalysis: ReturnType<CaptionEngine["analyze"]> | null = null;
    try {
      const captionsVisible = project.composition.layers.some(
        (layer) => layer.visible && layer.type === "captions"
      );
      captionAnalysis = this.captionEngine.analyze(
        project.captions.cues,
        project.captions.style,
        project.composition,
        project.sourceRanges,
        project.captions.enabled && captionsVisible
      );
      for (const warning of captionAnalysis.warnings) {
        findings.push(finding(warning.code, { cueId: warning.cueId }));
      }
    } catch (error) {
      if (error instanceof AppError && error.code === "DEPENDENCY_UNAVAILABLE") {
        findings.push(finding("CAPTION_FONT_UNAVAILABLE"));
      } else {
        throw error;
      }
    }

    let audioDecision: ReturnType<typeof buildAudioDecision> | null = null;
    try {
      const bed = project.audio.bedAssetId === null
        ? null
        : assets.find((value) => value.asset.id === project.audio.bedAssetId)?.asset ?? null;
      audioDecision = buildAudioDecision({
        episodeId: episode.id,
        sourceRanges: project.sourceRanges,
        audio: project.audio,
        bedDurationMs: bed?.durationMs ?? null
      });
      for (const warning of audioDecision.warnings) {
        findings.push(finding(warning.code));
      }
    } catch (error) {
      if (error instanceof AppError || error instanceof z.ZodError) {
        findings.push(finding("AUDIO_BED_INVALID", project.audio.bedAssetId
          ? { assetId: project.audio.bedAssetId }
          : undefined));
      } else {
        throw error;
      }
    }

    const dependencyVersions = { ffmpeg, ffprobe };
    const snapshot = renderSnapshotSchema.parse({
      version: RENDER_SNAPSHOT_VERSION,
      short: project,
      template: {
        lineage: project.templateLineage,
        materializedComposition: project.composition
      },
      sourceRanges: project.sourceRanges,
      output: {
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
        maximumDurationMs: MAXIMUM_RENDER_DURATION_MS,
        durationMs
      },
      decisions: {
        captions: {
          engineVersion: CAPTION_ENGINE_VERSION,
          analysis: captionAnalysis
        },
        crops: {
          generatorVersion: CROP_GENERATOR_VERSION,
          smoothingVersion: CROP_SMOOTHING_VERSION,
          layers: project.composition.layers
            .filter((layer): layer is Extract<
              ShortProject["composition"]["layers"][number],
              { type: "video" }
            > => layer.visible && layer.type === "video")
            .map((layer) => ({
              layerId: layer.id,
              automatic: layer.automaticCropTrack,
              manual: layer.manualCropTrack
            }))
        },
        audio: audioDecision
      },
      resources: {
        episode: { identity: episode, file: source },
        assets: assets.map(({ asset, file }) => ({ identity: asset, file }))
      },
      dependencyVersions
    });
    const snapshotHash = hashCanonicalSnapshot(snapshot);
    const createdAt = (this.options.now ?? (() => new Date().toISOString()))();
    const orderedFindings = normalizeRenderPreflightFindings(findings);
    const result = renderPreflightResultSchema.parse({
      id: randomUUID(),
      shortId,
      revision: expectedRevision,
      snapshotHash,
      status: orderedFindings.some((item) => item.severity === "error") ? "failed" : "passed",
      findings: orderedFindings,
      dependencyVersions,
      createdAt
    });
    await this.options.beforeInsert?.();
    return this.repository.insertRenderPreflight(expectedRevision, snapshot, result);
  }

  private async dependencyVersion(binary: string): Promise<string | null> {
    try {
      const result = await this.run(binary, ["-version"]);
      return parseDependencyVersion(result.stdout);
    } catch {
      return null;
    }
  }

  private async inspectResource(path: string, ffprobePath: string | null): Promise<FileSnapshot> {
    let before: Stats;
    try {
      before = await stat(path);
      if (!before.isFile()) throw new Error("not a file");
    } catch {
      return { path, before: null, after: null, contentHash: null, media: null };
    }
    const [hashResult, probeResult] = await Promise.allSettled([
      hashFile(path),
      ffprobePath === null ? Promise.resolve(null) : this.probeMedia(ffprobePath, path)
    ]);
    const contentHash = hashResult.status === "fulfilled" ? hashResult.value : null;
    const media = probeResult.status === "fulfilled" ? probeResult.value : null;
    let after: Stats | null = null;
    try {
      after = await stat(path);
    } catch {
      // Recorded below as a changed resource.
    }
    return {
      path,
      before: fileState(before),
      after: after ? fileState(after) : null,
      contentHash,
      media
    };
  }

  private async probeMedia(binary: string, path: string): Promise<MediaProbe> {
    const result = await this.run(binary, [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,duration",
      "-of", "json",
      path
    ]);
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: unknown };
      streams?: Array<Record<string, unknown>>;
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    return {
      durationMs: milliseconds(parsed.format?.duration ?? video?.duration ?? audio?.duration),
      width: positiveInteger(video?.width),
      height: positiveInteger(video?.height),
      videoCodec: nonempty(video?.codec_name),
      audioCodec: nonempty(audio?.codec_name)
    };
  }

  private sourceFindings(
    episode: Episode,
    project: ShortProject,
    source: FileSnapshot,
    probeAttempted: boolean,
    findings: RenderPreflightFinding[]
  ): void {
    if (episode.missing || episode.status === "source_missing" || source.before === null) {
      findings.push(finding("SOURCE_MISSING", { episodeId: episode.id }));
      return;
    }
    if (!sameFileState(source.before, source.after)) {
      findings.push(finding("SOURCE_CHANGED", { episodeId: episode.id }));
    }
    if (
      source.before.size !== episode.fileSize ||
      Math.round(source.before.modifiedAtMs) !== episode.modifiedAtMs ||
      (episode.contentHash !== null && source.contentHash !== episode.contentHash)
    ) {
      findings.push(finding("SOURCE_CHANGED", { episodeId: episode.id }));
    }
    if (source.media === null) {
      if (probeAttempted) findings.push(finding("SOURCE_PROBE_FAILED", { episodeId: episode.id }));
      return;
    }
    if (
      source.media.durationMs !== episode.durationMs ||
      source.media.width !== episode.width ||
      source.media.height !== episode.height ||
      source.media.videoCodec !== episode.videoCodec?.toLowerCase() ||
      source.media.audioCodec !== episode.audioCodec?.toLowerCase()
    ) {
      findings.push(finding("SOURCE_CHANGED", { episodeId: episode.id }));
    }
    if (source.media.videoCodec === null) {
      findings.push(finding("SOURCE_VIDEO_STREAM_MISSING", { episodeId: episode.id }));
    } else if (source.media.videoCodec !== "h264") {
      findings.push(finding("SOURCE_VIDEO_STREAM_UNSUPPORTED", { episodeId: episode.id }));
    }
    if (source.media.audioCodec === null && !project.audio.sourceMuted) {
      findings.push(finding("SOURCE_AUDIO_STREAM_MISSING", { episodeId: episode.id }));
      findings.push(finding("AUDIO_SOURCE_MISSING", { episodeId: episode.id }));
    } else if (source.media.audioCodec !== null && source.media.audioCodec !== "aac") {
      findings.push(finding("SOURCE_AUDIO_STREAM_UNSUPPORTED", { episodeId: episode.id }));
    }
    const duration = source.media.durationMs ?? episode.durationMs;
    project.sourceRanges.forEach((range, rangeIndex) => {
      if (duration === null || range.endMs > duration) {
        findings.push(finding("SOURCE_RANGE_INVALID", { rangeIndex }));
      }
    });
  }

  private async inspectAssets(
    project: ShortProject,
    ffprobePath: string | null,
    findings: RenderPreflightFinding[]
  ): Promise<Array<{ asset: Asset; file: FileSnapshot }>> {
    const bindings = new Map<string, Array<{
      layerId: string;
      expectedKind: Asset["kind"] | "media";
    }>>();
    const addBinding = (
      assetId: string,
      binding: { layerId: string; expectedKind: Asset["kind"] | "media" }
    ) => {
      const existing = bindings.get(assetId) ?? [];
      existing.push(binding);
      bindings.set(assetId, existing);
    };
    for (const layer of project.composition.layers) {
      if (!layer.visible) continue;
      if (!layer.assetId) continue;
      const expectedKind: Asset["kind"] = layer.type === "logo" ? "logo"
        : layer.type === "video" ? "video"
          : layer.type === "image" ? "image"
            : "image";
      if (layer.type === "captions" || layer.type === "shape") continue;
      addBinding(layer.assetId, {
        layerId: layer.id,
        expectedKind: layer.type === "media" ? "media" : expectedKind
      });
    }
    if (project.audio.bedAssetId) {
      addBinding(project.audio.bedAssetId, {
        layerId: "audio-bed",
        expectedKind: "audio"
      });
    }
    const results: Array<{ asset: Asset; file: FileSnapshot }> = [];
    for (const [assetId, assetBindings] of [...bindings]
      .sort(([left], [right]) => left.localeCompare(right))) {
      let asset: Asset;
      try {
        asset = this.repository.getAsset(assetId);
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_FOUND") {
          for (const binding of assetBindings) {
            findings.push(finding("ASSET_MISSING", { assetId, layerId: binding.layerId }));
          }
          continue;
        }
        throw error;
      }
      for (const binding of assetBindings) {
        const kindMismatch = binding.expectedKind === "media"
          ? asset.kind !== "image" && asset.kind !== "video"
          : asset.kind !== binding.expectedKind &&
            !(binding.expectedKind === "image" && asset.kind === "logo");
        if (kindMismatch) {
          findings.push(finding("ASSET_KIND_MISMATCH", {
            assetId,
            layerId: binding.layerId,
            expectedKind: binding.expectedKind,
            actualKind: asset.kind
          }));
        }
      }
      let path: string | null = asset.sourcePath;
      if (path === null && asset.ownedArtifactPath !== null) {
        try {
          path = this.options.resolveOwnedPath?.(asset.ownedArtifactPath) ?? null;
        } catch {
          path = null;
        }
      }
      if (path === null) {
        findings.push(finding("ASSET_INTEGRITY_FAILED", { assetId }));
        continue;
      }
      const file = await this.inspectResource(path, ffprobePath);
      results.push({ asset, file });
      if (file.before === null) {
        for (const binding of assetBindings) {
          findings.push(finding("ASSET_MISSING", { assetId, layerId: binding.layerId }));
        }
      } else if (!sameFileState(file.before, file.after)) {
        findings.push(finding("ASSET_CHANGED", { assetId }));
      } else if (file.media === null && ffprobePath !== null) {
        findings.push(finding("ASSET_PROBE_FAILED", { assetId }));
      } else if (file.media && !supportedAssetMedia(asset.kind, file.media)) {
        findings.push(finding("ASSET_PROBE_FAILED", { assetId }));
      } else if (asset.kind === "audio" && file.media && (
        file.media.audioCodec === null ||
        file.media.durationMs === null ||
        asset.durationMs !== file.media.durationMs
      )) {
        findings.push(finding("AUDIO_BED_INVALID", { assetId }));
      } else if (file.media && (
        asset.width !== file.media.width ||
        asset.height !== file.media.height ||
        asset.durationMs !== file.media.durationMs
      )) {
        findings.push(finding("ASSET_INTEGRITY_FAILED", { assetId }));
      }
      if (asset.ownedArtifactPath) {
        const record = this.repository.listArtifactRecords(asset.id)
          .find((item) => item.relativePath === asset.ownedArtifactPath);
        if (
          !record ||
          record.state !== "complete" ||
          file.contentHash === null ||
          record.contentHash !== file.contentHash ||
          record.byteLength !== file.before?.size
        ) findings.push(finding("ASSET_INTEGRITY_FAILED", { assetId }));
      }
    }
    return results;
  }

  private outputFindings(
    project: ShortProject,
    durationMs: number,
    findings: RenderPreflightFinding[]
  ): void {
    if (project.composition.width !== 1080 || project.composition.height !== 1920) {
      findings.push(finding("OUTPUT_SETTINGS_INVALID"));
    }
    const safe = project.composition.safeArea;
    if (
      safe.left + safe.right >= 1080 ||
      safe.top + safe.bottom >= 1920
    ) findings.push(finding("SAFE_AREA_INVALID"));
    for (const layer of project.composition.layers) {
      if (!layer.visible) continue;
      if (layer.type !== "video") continue;
      for (const control of [
        ...layer.automaticCropTrack.frames,
        ...layer.manualCropTrack
      ]) {
        if (control.atMs > durationMs) {
          findings.push(finding("CROP_TIMESTAMP_INVALID", {
            layerId: layer.id,
            atMs: control.atMs
          }));
        }
        if (!("x" in control)) continue;
        if (
          control.x < 0 || control.y < 0 ||
          control.width <= 0 || control.height <= 0 ||
          control.x + control.width > 1 ||
          control.y + control.height > 1
        ) findings.push(finding("CROP_BOUNDS_INVALID", { layerId: layer.id, atMs: control.atMs }));
      }
    }
  }
}

export function hashCanonicalSnapshot(snapshot: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(snapshot)).digest("hex")}`;
}

export function parseDependencyVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/, 1)[0]?.trim();
  const match = firstLine?.match(/^(?:ffmpeg|ffprobe) version ([^\s]+)/i);
  return match?.[1] ?? null;
}

export function normalizeRenderPreflightFindings(
  findings: readonly RenderPreflightFinding[]
): RenderPreflightFinding[] {
  const order = new Map(
    Object.keys(renderPreflightFindingRegistry).map((code, index) => [code, index])
  );
  const unique = new Map<string, RenderPreflightFinding>();
  for (const item of findings.map((value) => renderPreflightFindingSchema.parse(value))) {
    const identity = canonicalJson({ code: item.code, details: item.details ?? {} });
    if (!unique.has(identity)) unique.set(identity, item);
  }
  return [...unique.values()].sort((left, right) =>
    (order.get(left.code)! - order.get(right.code)!) ||
    canonicalJson(left.details ?? {}).localeCompare(canonicalJson(right.details ?? {}))
  );
}

function definition(
  severity: RenderPreflightFinding["severity"],
  category: RenderPreflightFinding["category"],
  message: string,
  remediation: string
): FindingDefinition {
  return { severity, category, message, remediation };
}

function finding(
  code: RenderPreflightFindingCode,
  details?: RenderPreflightFinding["details"]
): RenderPreflightFinding {
  const value = { ...renderPreflightFindingRegistry[code], code, details };
  if (details === undefined) delete (value as { details?: unknown }).details;
  return renderPreflightFindingSchema.parse(value);
}

function outputDuration(project: ShortProject): number {
  return project.sourceRanges.reduce(
    (total, range) => total + range.endMs - range.startMs,
    0
  );
}

function fileState(value: Stats): FileState {
  return { size: value.size, modifiedAtMs: value.mtimeMs };
}

function sameFileState(left: FileState, right: FileState | null): boolean {
  return right !== null &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function milliseconds(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.round(parsed * 1000))
    : null;
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function supportedAssetMedia(kind: Asset["kind"], media: MediaProbe): boolean {
  if (kind === "audio") {
    return media.audioCodec === "aac" ||
      media.audioCodec === "mp3" ||
      media.audioCodec?.startsWith("pcm_") === true;
  }
  if (kind === "video") return media.videoCodec === "h264";
  return media.videoCodec === "png" ||
    media.videoCodec === "mjpeg" ||
    media.videoCodec === "webp";
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function runProcess(
  binary: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 2_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64_000) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error("media dependency failed"));
    });
  });
}

function revisionConflict(expectedRevision: number, actualRevision: number): AppError {
  return new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
    expectedRevision,
    actualRevision
  });
}
