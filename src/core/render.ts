import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  Job,
  Render,
  RenderDeterminism,
  RenderValidationResult
} from "../shared/domain.js";
import {
  RENDER_DETERMINISM_VERSION,
  renderValidationResultSchema
} from "../shared/domain.js";
import { AppError, normalizeError } from "../shared/errors.js";
import type { ArtifactStore, ExternalArtifactReservation } from "./artifact-store.js";
import { generateCaptionSidecars, type CaptionEngine } from "./captions.js";
import type { JobQueue } from "./jobs.js";
import { buildRenderGraph, RENDER_GRAPH_VERSION } from "./render-composition.js";
import {
  parseDependencyVersion,
  renderSnapshotSchema,
  type RenderSnapshot
} from "./render-preflight.js";
import type { Repository, StoredArtifact } from "./repository.js";
import { canonicalJson } from "./analysis-cache.js";

export interface RenderValidation {
  valid: boolean;
  errors: string[];
  width: number | null;
  height: number | null;
  durationMs: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export async function validateRender(
  outputPath: string,
  ffprobePath = process.env.SHORT_EDITOR_FFPROBE ?? "ffprobe",
  maxDurationMs = 180_000
): Promise<RenderValidation> {
  try { await access(outputPath); }
  catch { throw new AppError("NOT_FOUND", "Render output does not exist", 404); }
  const data = await runProbe(ffprobePath, outputPath);
  const streams = data.streams as Array<Record<string, unknown>> ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const format = data.format as Record<string, unknown> | undefined;
  const width = video ? Number(video.width) : null;
  const height = video ? Number(video.height) : null;
  const durationMs = format?.duration ? Math.round(Number(format.duration) * 1000) : null;
  const videoCodec = video ? String(video.codec_name) : null;
  const audioCodec = audio ? String(audio.codec_name) : null;
  const errors: string[] = [];
  if (width !== 1080 || height !== 1920) errors.push("Output must be 1080×1920");
  if (videoCodec !== "h264") errors.push("Video codec must be H.264");
  if (audioCodec !== "aac") errors.push("Audio codec must be AAC");
  if (durationMs === null || durationMs <= 0 || durationMs > maxDurationMs) {
    errors.push(`Duration must be positive and at most ${maxDurationMs / 1000} seconds`);
  }
  if (!audio) errors.push("Output must contain audio");
  return { valid: errors.length === 0, errors, width, height, durationMs, videoCodec, audioCodec };
}

export interface RenderJobPayload {
  apiVersion: "v1";
  type: "render";
  shortId: string;
  projectRevision: number;
  renderId: string;
  preflightId: string;
  sidecarFormat: "srt" | "webvtt" | null;
}

export type PendingRenderDeterminism =
  Omit<RenderDeterminism, "comparison" | "referenceRenderId">;

export class CompositionRenderer {
  constructor(
    private readonly repository: Repository,
    private readonly artifacts: ArtifactStore,
    private readonly jobs: JobQueue,
    private readonly captionEngine: CaptionEngine,
    private readonly options: {
      ffmpegPath?: string;
      ffprobePath?: string;
      runVersion?: (binary: string) => Promise<string>;
      normalize?: (
        path: string,
        ffmpegPath: string,
        durationMs: number
      ) => Promise<Omit<PendingRenderDeterminism, "identityHash">>;
    } = {}
  ) {}

  async render(job: Job, payload: RenderJobPayload): Promise<void> {
    const render = this.repository.getRender(payload.renderId);
    if (
      render.state !== "queued" ||
      render.preflightId !== payload.preflightId ||
      render.shortId !== payload.shortId ||
      render.projectRevision !== payload.projectRevision
    ) {
      throw new AppError("INVALID_STATE", "Queued Render does not match its job", 409);
    }
    this.repository.transitionRender(render.id, "queued", { state: "running" });
    const ffmpegPath = this.options.ffmpegPath ?? process.env.SHORT_EDITOR_FFMPEG ?? "ffmpeg";
    const ffprobePath = this.options.ffprobePath ?? process.env.SHORT_EDITOR_FFPROBE ?? "ffprobe";
    let reservation: ExternalArtifactReservation | undefined;
    const finalizedArtifacts: StoredArtifact[] = [];
    let workingDirectory: string | undefined;
    let typedValidation: RenderValidationResult | null = null;
    let normalized: Omit<PendingRenderDeterminism, "identityHash"> | null = null;
    let completedEncoder: Render["encoder"] | null = null;
    try {
      const stored = this.repository.getRenderPreflight(payload.preflightId);
      const snapshot = renderSnapshotSchema.parse(stored.snapshot);
      assertSnapshotBinding(snapshot, payload);
      await this.assertDependencies(snapshot, ffmpegPath, ffprobePath);
      await assertCapturedResources(snapshot);
      if (this.jobs.cancellationRequested(job.id)) {
        this.repository.transitionRender(render.id, "running", { state: "cancelled" });
        return;
      }
      const relativePath = `artifacts/renders/${render.id}/final.mp4`;
      reservation = this.artifacts.reserveExternal({
        kind: "render",
        ownerType: "render",
        ownerId: render.id,
        ownerRevision: render.projectRevision,
        relativePath,
        producerVersion: RENDER_GRAPH_VERSION
      });
      workingDirectory = await mkdtemp(join(tmpdir(), "short-editor-render-"));
      const filterScriptPath = join(workingDirectory, "filter.ffscript");
      const graph = buildRenderGraph(
        snapshot,
        filterScriptPath,
        reservation.temporaryPath,
        this.captionEngine.fontDirectory
      );
      await writeFile(filterScriptPath, graph.script, { flag: "wx" });
      this.jobs.progress(job.id, 0.03, "validated captured inputs");
      await runFfmpeg(
        ffmpegPath,
        ["-hide_banner", "-nostdin", ...graph.inputArgs, ...graph.outputArgs],
        snapshot.output.durationMs,
        (progress) => this.jobs.progress(job.id, 0.05 + progress * 0.82, "encoding"),
        () => this.jobs.cancellationRequested(job.id)
      );
      if (this.jobs.cancellationRequested(job.id)) {
        this.artifacts.discardExternal(reservation);
        reservation = undefined;
        this.repository.transitionRender(render.id, "running", { state: "cancelled" });
        return;
      }
      await this.assertDependencies(snapshot, ffmpegPath, ffprobePath);
      await assertCapturedResources(snapshot);
      const project = this.repository.getShort(payload.shortId);
      if (project.revision !== payload.projectRevision || !project.approved) {
        this.artifacts.discardExternal(reservation);
        reservation = undefined;
        this.repository.transitionRender(render.id, "running", { state: "stale" });
        throw staleRender(payload.projectRevision, project.revision);
      }
      this.jobs.progress(job.id, 0.9, "validating output");
      const ffmpegBuildHash = await mediaDependencyBuildHash(ffmpegPath);
      completedEncoder = {
        ...render.encoder,
        settings: {
          ...(render.encoder.settings as Record<string, unknown>),
          ffmpegBuildHash,
          ffprobeVersion: snapshot.dependencyVersions.ffprobe,
          graphVersion: RENDER_GRAPH_VERSION,
          graphHash: graph.graphHash,
          filterScriptHash: graph.graphHash
        }
      };
      const artifact = await this.artifacts.finalizeExternal(reservation, async (path) => {
        typedValidation = await validateRenderContract(path, ffprobePath);
        if (!typedValidation.valid) {
          throw new AppError("VALIDATION_ERROR", "Rendered media failed output validation", 422);
        }
        this.jobs.progress(job.id, 0.93, "normalizing determinism evidence");
        normalized = await (this.options.normalize ?? normalizeRender)(
          path,
          ffmpegPath,
          typedValidation.durationMs!
        );
      });
      finalizedArtifacts.push(artifact);
      reservation = undefined;
      if (this.jobs.cancellationRequested(job.id)) {
        this.artifacts.discardFinalized(artifact);
        finalizedArtifacts.length = 0;
        this.repository.transitionRender(render.id, "running", { state: "cancelled" });
        return;
      }
      let sidecarPath: string | null = null;
      if (payload.sidecarFormat !== null) {
        const sidecars = generateCaptionSidecars(
          snapshot.short.captions.cues,
          snapshot.sourceRanges,
          snapshot.short.captions.enabled
        );
        const extension = payload.sidecarFormat === "webvtt" ? "vtt" : "srt";
        const sidecar = this.artifacts.finalize({
          kind: payload.sidecarFormat === "webvtt" ? "caption_webvtt" : "caption_srt",
          ownerType: "render",
          ownerId: render.id,
          ownerRevision: render.projectRevision,
          relativePath: `artifacts/renders/${render.id}/captions.${extension}`,
          producerVersion: "captions-v1",
          bytes: sidecars[payload.sidecarFormat]
        });
        finalizedArtifacts.push(sidecar);
        sidecarPath = sidecar.relativePath;
      }
      if (this.jobs.cancellationRequested(job.id)) {
        for (const finalized of finalizedArtifacts.reverse()) {
          this.artifacts.discardFinalized(finalized);
        }
        finalizedArtifacts.length = 0;
        this.repository.transitionRender(render.id, "running", { state: "cancelled" });
        return;
      }
      if (typedValidation === null || normalized === null || completedEncoder === null) {
        throw new AppError("INTERNAL_ERROR", "Render evidence was not completed");
      }
      const normalizedEvidence = normalized as Omit<PendingRenderDeterminism, "identityHash">;
      const completed = this.repository.completeRenderAttempt(render.id, payload.projectRevision, {
        outputPath: artifact.relativePath,
        sidecarPath,
        validation: typedValidation,
        contentHash: artifact.contentHash,
        encoder: completedEncoder,
        determinism: {
          ...normalizedEvidence,
          identityHash: renderDeterminismIdentity(render.decisionHash!, completedEncoder)
        }
      });
      if (completed.state === "stale") {
        for (const finalized of finalizedArtifacts.reverse()) {
          this.artifacts.discardFinalized(finalized);
        }
        finalizedArtifacts.length = 0;
        throw staleRender(
          payload.projectRevision,
          this.repository.getShort(payload.shortId).revision
        );
      }
      if (completed.state === "failed") {
        for (const finalized of finalizedArtifacts.reverse()) {
          this.artifacts.discardFinalized(finalized);
        }
        finalizedArtifacts.length = 0;
        throw new AppError(
          "ARTIFACT_CORRUPT",
          "Normalized render content does not match the established baseline",
          422
        );
      }
      finalizedArtifacts.length = 0;
      this.jobs.progress(job.id, 0.99, "finalized render artifacts");
    } catch (error) {
      if (reservation) this.artifacts.discardExternal(reservation);
      for (const artifact of finalizedArtifacts.reverse()) {
        this.artifacts.discardFinalized(artifact);
      }
      const current = this.repository.getRender(render.id);
      if (current.state === "running") {
        const normalized = normalizeError(error);
        this.repository.transitionRender(render.id, "running", {
          state: this.jobs.cancellationRequested(job.id) ? "cancelled" : "failed",
          ...(typedValidation === null ? {} : { validation: typedValidation }),
          ...(completedEncoder === null ? {} : { encoder: completedEncoder }),
          error: this.jobs.cancellationRequested(job.id)
            ? { code: "JOB_CANCELLED", message: "Render was cancelled" }
            : { code: normalized.code, message: safeRenderError(normalized) }
        });
      }
      if (this.jobs.cancellationRequested(job.id)) return;
      throw error;
    } finally {
      if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async assertDependencies(
    snapshot: RenderSnapshot,
    ffmpegPath: string,
    ffprobePath: string
  ): Promise<void> {
    const version = this.options.runVersion ?? dependencyVersion;
    const [ffmpeg, ffprobe] = await Promise.all([
      version(ffmpegPath),
      version(ffprobePath)
    ]);
    if (
      ffmpeg !== snapshot.dependencyVersions.ffmpeg ||
      ffprobe !== snapshot.dependencyVersions.ffprobe
    ) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "FFmpeg dependencies changed after render preflight",
        503
      );
    }
  }
}

export function renderDeterminismIdentity(
  decisionHash: string,
  encoder: Render["encoder"]
): string {
  return createHash("sha256").update(canonicalJson({
    version: RENDER_DETERMINISM_VERSION,
    decisionHash,
    encoder
  })).digest("hex");
}

export async function normalizeRender(
  path: string,
  ffmpegPath = process.env.SHORT_EDITOR_FFMPEG ?? "ffmpeg",
  durationMs = 180_000
): Promise<Omit<PendingRenderDeterminism, "identityHash">> {
  const videoBytesPerFrame = 1080 * 1920 * 3 / 2;
  const videoLimit = Math.ceil(durationMs / 1000 * 31 + 2) * videoBytesPerFrame;
  const audioLimit = Math.ceil((durationMs + 1_000) / 1000 * 48_000 * 2 * 2);
  try {
    const video = await hashDecodedStream(ffmpegPath, [
      "-v", "error", "-nostdin", "-threads", "1", "-i", path,
      "-map", "0:v:0", "-map_metadata", "-1", "-map_chapters", "-1",
      "-an", "-sn", "-dn", "-vf", "format=pix_fmts=yuv420p",
      "-fps_mode", "passthrough", "-bitexact", "-f", "rawvideo", "pipe:1"
    ], videoLimit);
    const audio = await hashDecodedStream(ffmpegPath, [
      "-v", "error", "-nostdin", "-threads", "1", "-i", path,
      "-map", "0:a:0", "-map_metadata", "-1", "-map_chapters", "-1",
      "-vn", "-sn", "-dn", "-ac", "2", "-ar", "48000",
      "-c:a", "pcm_s16le", "-bitexact", "-f", "s16le", "pipe:1"
    ], audioLimit);
    return {
      version: RENDER_DETERMINISM_VERSION,
      algorithm: "sha256",
      video: {
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        ...video
      },
      audio: {
        sampleFormat: "s16le",
        sampleRate: 48_000,
        channels: 2,
        ...audio
      }
    };
  } catch {
    throw new AppError(
      "ARTIFACT_CORRUPT",
      "Render normalization failed",
      422
    );
  }
}

function hashDecodedStream(
  binary: string,
  args: string[],
  byteLimit: number
): Promise<{ sha256: string; byteCount: number }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const hash = createHash("sha256");
    let byteCount = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      if (child.exitCode === null) child.kill("SIGKILL");
      reject(new Error("normalization failed"));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      byteCount += chunk.byteLength;
      if (byteCount > byteLimit || !Number.isSafeInteger(byteCount)) {
        fail();
        return;
      }
      hash.update(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = Math.min(64_000, stderrBytes + chunk.byteLength);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      void stderrBytes;
      if (settled) return;
      settled = true;
      if (code !== 0 || byteCount === 0) {
        reject(new Error("normalization failed"));
        return;
      }
      resolvePromise({ sha256: hash.digest("hex"), byteCount });
    });
  });
}

async function validateRenderContract(
  path: string,
  ffprobePath: string
): Promise<RenderValidationResult> {
  const validation = await validateRender(path, ffprobePath);
  return renderValidationResultSchema.parse({
    valid: validation.valid,
    findings: validation.errors.map((message, index) => ({
      code: `OUTPUT_${index + 1}`,
      severity: "error",
      message
    })),
    width: validation.width,
    height: validation.height,
    durationMs: validation.durationMs,
    videoCodec: validation.videoCodec,
    audioCodec: validation.audioCodec,
    validatedAt: new Date().toISOString()
  });
}

function assertSnapshotBinding(snapshot: RenderSnapshot, payload: RenderJobPayload): void {
  if (
    snapshot.short.id !== payload.shortId ||
    snapshot.short.revision !== payload.projectRevision ||
    snapshot.output.durationMs <= 0
  ) {
    throw new AppError("INVALID_STATE", "Render snapshot binding is invalid", 409);
  }
}

async function assertCapturedResources(snapshot: RenderSnapshot): Promise<void> {
  const resources = [
    snapshot.resources.episode.file,
    ...snapshot.resources.assets.map(({ file }) => file)
  ];
  for (const resource of resources) {
    if (!resource.before || !resource.contentHash) {
      throw new AppError("SOURCE_IDENTITY_MISMATCH", "A captured render input is unavailable", 409);
    }
    let current;
    try {
      current = await stat(resource.path);
    } catch {
      throw new AppError("SOURCE_IDENTITY_MISMATCH", "A captured render input is unavailable", 409);
    }
    if (
      current.size !== resource.before.size ||
      current.mtimeMs !== resource.before.modifiedAtMs ||
      await hashFile(resource.path) !== resource.contentHash
    ) {
      throw new AppError(
        "SOURCE_IDENTITY_MISMATCH",
        "A captured render input changed after preflight",
        409
      );
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolvePromise);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function dependencyVersion(binary: string): Promise<string> {
  const result = await runProcess(binary, ["-version"], 64_000);
  const version = parseDependencyVersion(result.stdout);
  if (!version) throw new AppError("DEPENDENCY_UNAVAILABLE", "Media dependency version is unavailable", 503);
  return version;
}

async function mediaDependencyBuildHash(binary: string): Promise<string> {
  const result = await runProcess(binary, ["-version"], 64_000);
  return `sha256:${createHash("sha256").update(result.stdout).digest("hex")}`;
}

function runFfmpeg(
  binary: string,
  args: string[],
  durationMs: number,
  onProgress: (progress: number) => void,
  cancelled: () => boolean
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cancellation = setInterval(() => {
      if (cancelled() && child.exitCode === null) child.kill("SIGTERM");
    }, 100);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-16_000);
      const fields = stdout.split(/\r?\n/);
      stdout = fields.pop() ?? "";
      for (const field of fields) {
        const match = field.match(/^out_time_(?:ms|us)=(\d+)$/);
        if (match) onProgress(Math.min(1, Number(match[1]) / (durationMs * 1000)));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-64_000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearInterval(cancellation);
      reject(error.code === "ENOENT"
        ? new AppError("DEPENDENCY_UNAVAILABLE", "FFmpeg is unavailable", 503)
        : error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearInterval(cancellation);
      if (cancelled()) {
        reject(new AppError("JOB_CANCELLED", "Render was cancelled", 409));
      } else if (code === 0) {
        resolvePromise();
      } else {
        reject(new AppError(
          "VALIDATION_ERROR",
          `FFmpeg failed${code === null ? ` (${signal ?? "unknown signal"})` : ` with exit code ${code}`}`,
          422,
          { stderr: redactStderr(stderr) }
        ));
      }
    });
  });
}

function runProcess(
  binary: string,
  args: string[],
  cap: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(0, cap); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(0, cap); });
    child.on("error", (error: NodeJS.ErrnoException) => reject(
      error.code === "ENOENT"
        ? new AppError("DEPENDENCY_UNAVAILABLE", "Media dependency is unavailable", 503)
        : error
    ));
    child.on("close", (code) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(new AppError("DEPENDENCY_UNAVAILABLE", "Media dependency failed", 503)));
  });
}

function redactStderr(stderr: string): string {
  return stderr
    .replace(/(?:\/[^ \n:'"]+)+/g, "<path>")
    .replace(/[A-Za-z]:\\[^ \n:'"]+/g, "<path>")
    .slice(-8_000);
}

function safeRenderError(error: AppError): string {
  if (error.code === "VALIDATION_ERROR") return "Render processing or validation failed";
  return error.message.replace(/(?:\/[^ \n:'"]+)+/g, "<path>");
}

function staleRender(expectedRevision: number, actualRevision: number): AppError {
  return new AppError("REVISION_CONFLICT", "Short changed while rendering", 409, {
    expectedRevision,
    actualRevision
  });
}

function runProbe(binary: string, path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json", path
    ], { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(0, 2_000_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-64_000); });
    child.on("error", (error: NodeJS.ErrnoException) => reject(
      error.code === "ENOENT"
        ? new AppError("DEPENDENCY_UNAVAILABLE", `${binary} is unavailable`, 503)
        : error
    ));
    child.on("close", (code) => {
      if (code) return reject(new AppError(
        "VALIDATION_ERROR",
        "ffprobe could not validate the render output",
        422,
        { stderr: redactStderr(stderr) }
      ));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new AppError("VALIDATION_ERROR", "ffprobe returned invalid JSON", 502)); }
    });
  });
}
