import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Asset, Episode, ImportRejectedResult, RelinkSourceResult } from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import type { Repository } from "./repository.js";

const SAMPLE_BYTES = 64 * 1024;

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
}

export interface ImportResult {
  imported: Episode[];
  duplicates: Episode[];
  relinked: Episode[];
  rejected: ImportRejectedResult[];
}

export interface InspectedSource {
  submittedPath: string;
  sourcePath: string;
  canonicalPath: string;
  fileSize: number;
  modifiedAtMs: number;
  fingerprint: string;
  probe: ProbeResult;
  contentHash: string | null;
}

export interface InspectedAssetSource {
  sourcePath: string;
  kind: Extract<Asset["kind"], "image" | "video" | "audio">;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

type ProbeLaunch = string | {
  command: string;
  args: string[];
};

export class MediaService {
  private identityFinalization = Promise.resolve();

  constructor(
    private readonly repository: Repository,
    private readonly ffprobeLaunch: ProbeLaunch = process.env.SHORT_EDITOR_FFPROBE ?? "ffprobe"
  ) {}

  async importPaths(paths: string[]): Promise<ImportResult> {
    const results = await Promise.all(paths.map(async (input) => {
      try {
        const source = await this.inspectSource(input);
        return await this.serializeIdentityFinalization(() => this.finalizeIdentity(source));
      } catch (error) {
        return { kind: "rejected" as const, value: rejectedResult(input, error) };
      }
    }));

    const response: ImportResult = { imported: [], duplicates: [], relinked: [], rejected: [] };
    for (const result of results) {
      if (result.kind === "imported") {
        response.imported.push(this.repository.getEpisode(result.value.id));
      } else if (result.kind === "duplicates") {
        response.duplicates.push(this.repository.getEpisode(result.value.id));
      } else if (result.kind === "relinked") {
        response.relinked.push(this.repository.getEpisode(result.value.id));
      } else {
        response.rejected.push(result.value);
      }
    }
    return response;
  }

  async inspectAsset(input: string): Promise<InspectedAssetSource> {
    const submittedPath = resolve(input);
    let before;
    let sourcePath: string;
    try {
      sourcePath = await realpath(submittedPath);
      before = await stat(sourcePath);
    } catch {
      throw new AppError("NOT_FOUND", "Asset file does not exist or cannot be accessed", 404);
    }
    if (!before.isFile()) throw new AppError("VALIDATION_ERROR", "Asset path is not a file", 422);
    if (before.size === 0) throw new AppError("VALIDATION_ERROR", "Asset file is empty", 422);

    const result = await runJson(this.ffprobeLaunch, [
      "-v", "error", "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,duration",
      "-of", "json", sourcePath
    ]);
    let after;
    try {
      after = await stat(sourcePath);
    } catch {
      throw new AppError("VALIDATION_ERROR", "Asset changed while it was being inspected", 422);
    }
    if (!sameFileState(before, after)) {
      throw new AppError("VALIDATION_ERROR", "Asset changed while it was being inspected", 422);
    }
    const streams = Array.isArray(result.streams)
      ? result.streams.filter(isRecord)
      : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (!video && !audio) {
      throw new AppError("VALIDATION_ERROR", "Asset contains no supported media stream", 422);
    }
    const format = isRecord(result.format) ? result.format : {};
    if (video) {
      const codec = nonemptyString(video.codec_name)?.toLowerCase() ?? null;
      const width = positiveInteger(video.width);
      const height = positiveInteger(video.height);
      if (width === null || height === null) {
        throw new AppError("VALIDATION_ERROR", "Asset dimensions are missing or invalid", 422);
      }
      if (codec === "png" || codec === "mjpeg" || codec === "webp") {
        return { sourcePath, kind: "image", width, height, durationMs: null };
      }
      if (codec !== "h264") {
        throw new AppError("VALIDATION_ERROR", "Unsupported asset video codec", 422);
      }
      const duration = finitePositive(format.duration) ?? finitePositive(video.duration);
      if (duration === null) {
        throw new AppError("VALIDATION_ERROR", "Asset video duration is missing or invalid", 422);
      }
      return {
        sourcePath, kind: "video", width, height,
        durationMs: Math.max(1, Math.round(duration * 1000))
      };
    }
    const codec = nonemptyString(audio!.codec_name)?.toLowerCase() ?? null;
    if (codec !== "aac" && codec !== "mp3" && !codec?.startsWith("pcm_")) {
      throw new AppError("VALIDATION_ERROR", "Unsupported asset audio codec", 422);
    }
    const duration = finitePositive(format.duration) ?? finitePositive(audio!.duration);
    if (duration === null) {
      throw new AppError("VALIDATION_ERROR", "Asset audio duration is missing or invalid", 422);
    }
    return {
      sourcePath, kind: "audio", width: null, height: null,
      durationMs: Math.max(1, Math.round(duration * 1000))
    };
  }

  async relinkSource(
    episodeId: string,
    candidatePath: string
  ): Promise<RelinkSourceResult> {
    const episode = this.repository.getEpisode(episodeId);
    if (episode.status !== "source_missing") {
      throw new AppError("INVALID_STATE", "Only missing Episode sources can be relinked", 409);
    }
    const source = await this.inspectRelinkCandidate(candidatePath);
    if (episode.contentHash) {
      if (source.contentHash !== episode.contentHash) {
        throw new AppError("SOURCE_IDENTITY_MISMATCH", "Candidate bytes do not match the original source", 409);
      }
      return {
        status: "relinked",
        episode: this.repository.commitEpisodeRelink(episodeId, relinkRecord(source))
      };
    }
    if (
      source.fingerprint !== episode.fingerprint ||
      source.fileSize !== episode.fileSize ||
      !sameProbe(source.probe, probeFromEpisode(episode))
    ) {
      throw new AppError(
        "SOURCE_IDENTITY_MISMATCH",
        "Candidate fingerprint, size, or media metadata does not match the original source",
        409
      );
    }
    const confirmationToken = randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = new Date(now + 10 * 60_000).toISOString();
    this.repository.saveRelinkComparison({
      id: randomUUID(),
      episodeId,
      tokenHash: tokenHash(confirmationToken),
      candidatePath: source.sourcePath,
      canonicalPath: source.canonicalPath,
      fingerprint: source.fingerprint,
      contentHash: source.contentHash!,
      fileSize: source.fileSize,
      modifiedAtMs: source.modifiedAtMs,
      probe: source.probe,
      expiresAt,
      consumedAt: null,
      createdAt: new Date(now).toISOString()
    });
    return { status: "confirmation_required", confirmationToken, expiresAt };
  }

  async confirmRelink(episodeId: string, confirmationToken: string): Promise<{
    status: "relinked";
    episode: Episode;
  }> {
    const comparison = this.repository.findRelinkComparison(tokenHash(confirmationToken));
    if (
      !comparison ||
      comparison.episodeId !== episodeId ||
      comparison.consumedAt ||
      Date.parse(comparison.expiresAt) <= Date.now()
    ) {
      throw new AppError("VALIDATION_ERROR", "Relink confirmation is expired or already used", 422);
    }
    const source = await this.inspectRelinkCandidate(comparison.candidatePath);
    if (
      source.canonicalPath !== comparison.canonicalPath ||
      source.fingerprint !== comparison.fingerprint ||
      source.contentHash !== comparison.contentHash ||
      source.fileSize !== comparison.fileSize ||
      source.modifiedAtMs !== comparison.modifiedAtMs ||
      !sameProbe(source.probe, comparison.probe)
    ) {
      throw new AppError("SOURCE_IDENTITY_MISMATCH", "Candidate changed after it was compared", 409);
    }
    return {
      status: "relinked",
      episode: this.repository.commitEpisodeRelink(
        episodeId, relinkRecord(source), true, comparison.id
      )
    };
  }

  async hashEpisode(episodeId: string): Promise<string> {
    const episode = this.repository.getEpisode(episodeId);
    let before;
    try {
      before = await stat(episode.sourcePath);
    } catch {
      this.repository.markEpisodeSourceMissing(episodeId);
      throw new AppError("SOURCE_MISSING", "Source media is missing", 409);
    }
    const digest = await hashFile(episode.sourcePath);
    const after = await stat(episode.sourcePath);
    if (!sameFileState(before, after)) {
      throw new AppError("VALIDATION_ERROR", "Source changed while it was being inspected", 422);
    }
    this.repository.updateEpisodeMedia(episodeId, { contentHash: digest });
    return digest;
  }

  async probeEpisode(episodeId: string): Promise<ProbeResult> {
    const episode = this.repository.getEpisode(episodeId);
    try {
      await stat(episode.sourcePath);
    } catch {
      this.repository.markEpisodeSourceMissing(episodeId);
      throw new AppError("SOURCE_MISSING", "Source media is missing", 409);
    }
    const probe = await this.probePath(episode.sourcePath);
    this.repository.updateEpisodeMedia(episodeId, { ...probe, status: "indexing" });
    return probe;
  }

  async inspectRelinkCandidate(input: string): Promise<InspectedSource> {
    let source: InspectedSource;
    try {
      source = await this.inspectSource(input, true);
    } catch (error) {
      if (error instanceof AppError && error.message.includes("does not exist")) {
        throw new AppError("SOURCE_MISSING", "Candidate source is missing or inaccessible", 409);
      }
      throw error;
    }
    source.contentHash = await hashStableFile(
      source.sourcePath, source.fileSize, source.modifiedAtMs
    );
    return source;
  }

  private async inspectSource(input: string, ignoreKnownPath = false): Promise<InspectedSource> {
    const sourcePath = resolve(input);
    let before;
    let canonicalPath: string;
    try {
      [before, canonicalPath] = await Promise.all([stat(sourcePath), realpath(sourcePath)]);
    } catch {
      throw new AppError("VALIDATION_ERROR", "File does not exist or cannot be accessed", 422);
    }
    if (!before.isFile()) throw new AppError("VALIDATION_ERROR", "Path is not a file", 422);
    if (before.size === 0) throw new AppError("VALIDATION_ERROR", "File is empty", 422);

    const byPath = ignoreKnownPath ? undefined : this.repository.findEpisodeByCanonicalPath(canonicalPath);
    if (byPath) {
      return {
        submittedPath: input, sourcePath, canonicalPath, fileSize: before.size,
        modifiedAtMs: Math.round(before.mtimeMs), fingerprint: byPath.fingerprint,
        probe: probeFromEpisode(byPath), contentHash: byPath.contentHash
      };
    }

    const [fingerprint, probe] = await Promise.all([
      quickFingerprint(sourcePath, before.size),
      this.probePath(sourcePath)
    ]);
    const after = await stat(sourcePath);
    if (!sameFileState(before, after)) {
      throw new AppError("VALIDATION_ERROR", "Source changed while it was being inspected", 422);
    }
    return {
      submittedPath: input, sourcePath, canonicalPath, fileSize: before.size,
      modifiedAtMs: Math.round(before.mtimeMs), fingerprint, probe, contentHash: null
    };
  }

  private async finalizeIdentity(source: InspectedSource) {
    const byPath = this.repository.findEpisodeByCanonicalPath(source.canonicalPath);
    if (byPath) return { kind: "duplicates" as const, value: byPath };

    const candidates = this.repository.findEpisodesByFingerprint(source.fingerprint);
    const resolvedCandidateHashes: Array<{ id: string; hash: string }> = [];
    if (candidates.length) {
      source.contentHash ??= await hashStableFile(source.sourcePath, source.fileSize, source.modifiedAtMs);
      for (const candidate of candidates) {
        if (!candidate.contentHash) {
          try {
            const hash = await hashStableFile(
              candidate.sourcePath, candidate.fileSize, candidate.modifiedAtMs
            );
            resolvedCandidateHashes.push({ id: candidate.id, hash });
          } catch {
            continue;
          }
        }
      }
    }

    const finalState = await stat(source.sourcePath);
    if (finalState.size !== source.fileSize ||
        Math.round(finalState.mtimeMs) !== source.modifiedAtMs) {
      throw new AppError("VALIDATION_ERROR", "Source changed while it was being inspected", 422);
    }

    return this.repository.transaction(() => {
      for (const candidate of resolvedCandidateHashes) {
        const current = this.repository.getEpisode(candidate.id);
        if (!current.contentHash) {
          this.repository.updateEpisodeMedia(candidate.id, { contentHash: candidate.hash });
        }
      }
      const duplicate = this.repository.findEpisodeByCanonicalPath(source.canonicalPath)
        ?? (source.contentHash
          ? this.repository.findEpisodeByContentHash(source.contentHash)
          : undefined);
      if (duplicate) {
        if (duplicate.missing && source.contentHash && duplicate.contentHash === source.contentHash) {
          return {
            kind: "relinked" as const,
            value: this.repository.commitEpisodeRelink(duplicate.id, relinkRecord(source))
          };
        }
        return { kind: "duplicates" as const, value: duplicate };
      }

      const unresolved = candidates.find((candidate) =>
        candidate.missing && candidate.contentHash === null &&
        candidate.fileSize === source.fileSize &&
        sameProbe(probeFromEpisode(candidate), source.probe)
      );
      if (unresolved) {
        return {
          kind: "rejected" as const,
          value: {
            path: source.submittedPath,
            code: "VALIDATION_ERROR" as const,
            reason: "A missing source may match this file; explicit relink confirmation is required"
          }
        };
      }

      const now = new Date().toISOString();
      const episode = this.repository.insertEpisode({
        id: randomUUID(), sourcePath: source.sourcePath, canonicalPath: source.canonicalPath,
        fingerprint: source.fingerprint, contentHash: source.contentHash,
        fileSize: source.fileSize, modifiedAtMs: source.modifiedAtMs,
        ...source.probe, status: "indexing", missing: false, relinkRestoreStatus: null,
        createdAt: now, updatedAt: now
      });
      return { kind: "imported" as const, value: episode };
    });
  }

  private async probePath(path: string): Promise<ProbeResult> {
    const result = await runJson(this.ffprobeLaunch, [
      "-v", "error", "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,duration",
      "-of", "json", path
    ]);
    const streams = Array.isArray(result.streams)
      ? result.streams as Array<Record<string, unknown>>
      : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (!video) throw new AppError("VALIDATION_ERROR", "No video stream found", 422);
    const format = isRecord(result.format) ? result.format : {};
    const durationSeconds = finitePositive(format.duration) ?? finitePositive(video.duration);
    const width = positiveInteger(video.width);
    const height = positiveInteger(video.height);
    const videoCodec = nonemptyString(video.codec_name);
    const audioCodec = audio ? nonemptyString(audio.codec_name) : null;
    if (durationSeconds === null) {
      throw new AppError("VALIDATION_ERROR", "Video duration is missing or invalid", 422);
    }
    if (width === null || height === null) {
      throw new AppError("VALIDATION_ERROR", "Video dimensions are missing or invalid", 422);
    }
    if (!videoCodec) throw new AppError("VALIDATION_ERROR", "Video codec metadata is missing", 422);
    return {
      durationMs: Math.max(1, Math.round(durationSeconds * 1000)), width, height, videoCodec,
      audioCodec: audioCodec || null
    };
  }

  private async serializeIdentityFinalization<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.identityFinalization;
    let release!: () => void;
    this.identityFinalization = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameProbe(left: ProbeResult, right: ProbeResult): boolean {
  return left.durationMs === right.durationMs &&
    left.width === right.width &&
    left.height === right.height &&
    left.videoCodec === right.videoCodec &&
    left.audioCodec === right.audioCodec;
}

function relinkRecord(source: InspectedSource & { contentHash: string | null }) {
  if (!source.contentHash) {
    throw new AppError("SOURCE_IDENTITY_MISMATCH", "Candidate has no verified content hash", 409);
  }
  return {
    sourcePath: source.sourcePath,
    canonicalPath: source.canonicalPath,
    fingerprint: source.fingerprint,
    contentHash: source.contentHash,
    fileSize: source.fileSize,
    modifiedAtMs: source.modifiedAtMs,
    ...source.probe
  };
}

export async function quickFingerprint(path: string, size: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const offsets = [...new Set([
      0,
      Math.max(0, Math.floor((size - SAMPLE_BYTES) / 2)),
      Math.max(0, size - SAMPLE_BYTES)
    ])];
    const hash = createHash("sha256").update(`quick-v1:${size}:`);
    for (const offset of offsets) {
      const length = Math.min(SAMPLE_BYTES, size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      hash.update(`${offset}:${bytesRead}:`).update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
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

async function hashStableFile(path: string, expectedSize: number, expectedModifiedAtMs: number): Promise<string> {
  const before = await stat(path);
  if (before.size !== expectedSize || Math.round(before.mtimeMs) !== expectedModifiedAtMs) {
    throw new AppError("VALIDATION_ERROR", "Source changed while it was being inspected", 422);
  }
  const digest = await hashFile(path);
  const after = await stat(path);
  if (!sameFileState(before, after)) {
    throw new AppError("VALIDATION_ERROR", "Source changed while it was being inspected", 422);
  }
  return digest;
}

function sameFileState(before: { size: number; mtimeMs: number }, after: { size: number; mtimeMs: number }): boolean {
  return before.size === after.size && before.mtimeMs === after.mtimeMs;
}

function rejectedResult(path: string, error: unknown): ImportRejectedResult {
  if (error instanceof AppError && error.code === "DEPENDENCY_UNAVAILABLE") {
    return { path, code: "DEPENDENCY_UNAVAILABLE", reason: error.message };
  }
  if (error instanceof AppError) {
    return { path, code: "VALIDATION_ERROR", reason: error.message };
  }
  return { path, code: "VALIDATION_ERROR", reason: "Media could not be inspected" };
}

function probeFromEpisode(episode: Episode): ProbeResult {
  return {
    durationMs: episode.durationMs ?? 1, width: episode.width ?? 1, height: episode.height ?? 1,
    videoCodec: episode.videoCodec ?? "unknown", audioCodec: episode.audioCodec
  };
}

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runJson(launch: ProbeLaunch, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const command = typeof launch === "string" ? launch : launch.command;
    const launchArgs = typeof launch === "string" ? args : [...launch.args, ...args];
    const child = spawn(command, launchArgs, { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.resume();
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new AppError("DEPENDENCY_UNAVAILABLE", "FFprobe is unavailable", 503));
      } else {
        reject(new AppError("VALIDATION_ERROR", "Media could not be inspected", 422));
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError("VALIDATION_ERROR", "Media could not be read by FFprobe", 422));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (!isRecord(parsed)) throw new Error("not an object");
        resolvePromise(parsed);
      } catch {
        reject(new AppError("VALIDATION_ERROR", "FFprobe returned invalid metadata", 422));
      }
    });
  });
}
