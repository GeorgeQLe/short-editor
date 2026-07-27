import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Episode } from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import type { Repository } from "./repository.js";

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
}

export class MediaService {
  constructor(
    private readonly repository: Repository,
    private readonly ffprobePath = process.env.SHORT_EDITOR_FFPROBE ?? "ffprobe"
  ) {}

  importPaths(paths: string[]): { imported: Episode[]; duplicates: Episode[]; rejected: { path: string; reason: string }[] } {
    const imported: Episode[] = [];
    const duplicates: Episode[] = [];
    const rejected: { path: string; reason: string }[] = [];
    for (const input of paths) {
      try {
        const absolute = resolve(input);
        if (!existsSync(absolute)) throw new Error("File does not exist");
        const stats = statSync(absolute);
        if (!stats.isFile()) throw new Error("Path is not a file");
        if (extname(absolute).toLowerCase() !== ".mp4") throw new Error("Only MP4 is guaranteed in v1");
        const canonicalPath = realpathSync.native(absolute);
        const byPath = this.repository.findEpisodeByCanonicalPath(canonicalPath);
        const fingerprint = fingerprintFor(stats.size, stats.mtimeMs);
        const byFingerprint = this.repository.findEpisodeByFingerprint(fingerprint);
        if (byPath || byFingerprint) {
          duplicates.push(byPath ?? byFingerprint!);
          continue;
        }
        const now = new Date().toISOString();
        imported.push(this.repository.insertEpisode({
          id: randomUUID(), sourcePath: absolute, canonicalPath, fingerprint, contentHash: null,
          fileSize: stats.size, modifiedAtMs: Math.round(stats.mtimeMs), durationMs: null,
          width: null, height: null, videoCodec: null, audioCodec: null,
          status: "discovered", missing: false, createdAt: now, updatedAt: now
        }));
      } catch (error) {
        rejected.push({ path: input, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { imported, duplicates, rejected };
  }

  async hashEpisode(episodeId: string): Promise<string> {
    const episode = this.repository.getEpisode(episodeId);
    if (!existsSync(episode.sourcePath)) {
      this.repository.updateEpisodeMedia(episodeId, { missing: true, status: "source_missing" });
      throw new AppError("SOURCE_MISSING", "Source media is missing", 409);
    }
    const hash = createHash("sha256");
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(episode.sourcePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", resolvePromise);
      stream.on("error", reject);
    });
    const digest = hash.digest("hex");
    this.repository.updateEpisodeMedia(episodeId, { contentHash: digest });
    return digest;
  }

  async probeEpisode(episodeId: string): Promise<ProbeResult> {
    const episode = this.repository.getEpisode(episodeId);
    if (!existsSync(episode.sourcePath)) {
      this.repository.updateEpisodeMedia(episodeId, { missing: true, status: "source_missing" });
      throw new AppError("SOURCE_MISSING", "Source media is missing", 409);
    }
    const result = await runJson(this.ffprobePath, [
      "-v", "error", "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json", episode.sourcePath
    ]);
    const streams = result.streams as Array<Record<string, unknown>> | undefined;
    const video = streams?.find((stream) => stream.codec_type === "video");
    const audio = streams?.find((stream) => stream.codec_type === "audio");
    if (!video) throw new AppError("VALIDATION_ERROR", "No video stream found", 422);
    const probe: ProbeResult = {
      durationMs: Math.round(Number((result.format as Record<string, unknown>)?.duration) * 1000),
      width: Number(video.width), height: Number(video.height),
      videoCodec: String(video.codec_name), audioCodec: audio ? String(audio.codec_name) : null
    };
    this.repository.updateEpisodeMedia(episodeId, { ...probe, status: "indexing" });
    return probe;
  }
}

export function fingerprintFor(size: number, modifiedAtMs: number): string {
  return createHash("sha256").update(`${size}:${Math.round(modifiedAtMs)}`).digest("hex");
}

async function runJson(binary: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new AppError("DEPENDENCY_UNAVAILABLE", `${binary} is unavailable`, 503));
      } else reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) return reject(new AppError("VALIDATION_ERROR", stderr.trim() || `${binary} failed`, 422));
      try { resolvePromise(JSON.parse(stdout)); }
      catch { reject(new AppError("VALIDATION_ERROR", `${binary} returned invalid JSON`, 502)); }
    });
  });
}
