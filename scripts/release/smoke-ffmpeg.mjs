#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execute = promisify(execFile);
const [ffmpeg, ffprobe, font] = process.argv.slice(2).map(resolve);
if (!ffmpeg || !ffprobe || !font) {
  throw new Error("Usage: smoke-ffmpeg.mjs <ffmpeg> <ffprobe> <font>");
}
const root = join(tmpdir(), `siftcut-ffmpeg-smoke-${process.pid}`);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
try {
  const input = join(root, "fixture.mp4");
  const output = join(root, "captioned.mp4");
  await run(ffmpeg, [
    "-hide_banner", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
    "-y", input
  ]);
  const probe = JSON.parse((await run(ffprobe, [
    "-v", "error", "-show_streams", "-of", "json", input
  ])).stdout);
  if (!probe.streams?.some((stream) => stream.codec_name === "h264") ||
      !probe.streams?.some((stream) => stream.codec_name === "aac")) {
    throw new Error("fixture does not contain H.264 video and AAC audio");
  }
  const escapedFont = font.replaceAll("\\", "/").replaceAll(":", "\\:");
  await run(ffmpeg, [
    "-hide_banner", "-nostdin", "-i", input,
    "-vf", `drawtext=fontfile='${escapedFont}':text='SiftCut':x=20:y=20:fontsize=28:fontcolor=white`,
    "-c:v", "libx264", "-c:a", "aac", "-y", output
  ]);
  if ((await readFile(output)).length < 1_000) throw new Error("caption render is empty");
  const [version, encoders, filters, build] = await Promise.all([
    run(ffmpeg, ["-version"]),
    run(ffmpeg, ["-hide_banner", "-encoders"]),
    run(ffmpeg, ["-hide_banner", "-filters"]),
    run(ffmpeg, ["-hide_banner", "-buildconf"])
  ]);
  const evidence = `${version.stdout}${version.stderr}${encoders.stdout}${
    filters.stdout
  }${build.stdout}`;
  for (const requirement of [
    [/ffmpeg version 8\.1\.2/i, "FFmpeg 8.1.2"],
    [/\blibx264\b/i, "libx264"],
    [/\baac\b/i, "AAC"],
    [/\bdrawtext\b/i, "drawtext"],
    [/(?:freetype|libfreetype)/i, "FreeType"],
    [/(?:harfbuzz|libharfbuzz)/i, "HarfBuzz"]
  ]) if (!requirement[0].test(evidence)) throw new Error(`Missing ${requirement[1]} capability`);
  process.stdout.write("FFmpeg probe and captioned H.264/AAC render passed.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function run(command, args) {
  return execute(command, args, {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
}
