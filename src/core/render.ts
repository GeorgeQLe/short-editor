import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { AppError } from "../shared/errors.js";

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
  if (durationMs === null || durationMs > maxDurationMs) errors.push(`Duration must be at most ${maxDurationMs / 1000} seconds`);
  if (!audio) errors.push("Output must contain audio");
  return { valid: errors.length === 0, errors, width, height, durationMs, videoCodec, audioCodec };
}

function runProbe(binary: string, path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json", path
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => reject(
      error.code === "ENOENT"
        ? new AppError("DEPENDENCY_UNAVAILABLE", `${binary} is unavailable`, 503)
        : error
    ));
    child.on("close", (code) => {
      if (code) return reject(new AppError("VALIDATION_ERROR", stderr || "ffprobe failed", 422));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new AppError("VALIDATION_ERROR", "ffprobe returned invalid JSON", 502)); }
    });
  });
}
