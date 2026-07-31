#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import tar from "tar-stream";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const downloads = join(root, "build/release-inputs/downloads");
const output = join(root, "build/release-inputs/release");
const archiveName = "short-editor-ffmpeg-8.1.2-corresponding-source.tar.gz";
const inputPaths = [
  "ffmpeg-8.1.2.tar.xz",
  "x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz",
  "freetype-2.14.1.tar.xz",
  "harfbuzz-14.2.1.tar.xz"
].map((name) => ({ source: join(downloads, name), archive: `upstream/${name}` }));
for (const path of [
  "docs/release-sources.md",
  "scripts/release/release-config.sh",
  "scripts/release/common.sh",
  "scripts/release/build-ffmpeg-macos-arm64.sh",
  "scripts/release/pkg-config-static.sh",
  "scripts/release/smoke-ffmpeg.sh",
  "resources/licenses/FFmpeg-GPLv2.txt",
  "resources/licenses/x264-GPLv2.txt"
]) inputPaths.push({ source: join(root, path), archive: path });

await mkdir(output, { recursive: true });
const contents = [];
for (const input of inputPaths) {
  const info = await stat(input.source);
  const bytes = await readFile(input.source);
  contents.push({
    ...input,
    size: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
}
const sourceManifest = Buffer.from(`${JSON.stringify({
  schemaVersion: 1,
  description: "Complete corresponding source inputs and reproducible build recipe",
  contents: contents.map(({ archive, size, sha256 }) => ({ path: archive, size, sha256 }))
}, null, 2)}\n`);
const entries = [
  ...contents,
  {
    source: null,
    archive: "SOURCE-MANIFEST.json",
    size: sourceManifest.length,
    sha256: createHash("sha256").update(sourceManifest).digest("hex"),
    bytes: sourceManifest
  }
].sort((left, right) => left.archive.localeCompare(right.archive));
const destination = join(output, archiveName);
const partial = `${destination}.partial`;
const pack = tar.pack();
const writing = pipeline(
  pack,
  createGzip({ level: 9, mtime: 0 }),
  createWriteStream(partial, { mode: 0o600 })
);
for (const entry of entries) {
  const stream = pack.entry({
    name: `short-editor-ffmpeg-source/${entry.archive}`,
    size: entry.size,
    mode: 0o644,
    uid: 0,
    gid: 0,
    uname: "",
    gname: "",
    mtime: new Date(0)
  });
  if (entry.source) await pipeline(createReadStream(entry.source), stream);
  else stream.end(entry.bytes);
}
pack.finalize();
await writing;
await rename(partial, destination);
const archiveBytes = await readFile(destination);
const evidence = {
  name: basename(destination),
  size: archiveBytes.length,
  sha256: createHash("sha256").update(archiveBytes).digest("hex")
};
await writeFile(
  join(output, `${archiveName}.json`),
  `${JSON.stringify(evidence, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
