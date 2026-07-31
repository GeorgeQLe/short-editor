#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import tar from "tar-stream";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const upstream = JSON.parse(await readFile(join(root, "resources/models/model-upstream.json")));
const source = resolve(process.argv[2] ?? join(root, "build/model/source"));
const output = resolve(process.argv[3] ?? join(root, "build/model/release"));
const archiveName = "faster-whisper-small.en-e0e3c0a.tar.gz";
const manifestName = "faster-whisper-small.en-e0e3c0a.manifest.json";
const archivePath = join(output, archiveName);
const partial = `${archivePath}.partial`;

await mkdir(output, { recursive: true });
for (const file of upstream.files) {
  const path = join(source, file.path);
  const info = await stat(path);
  if (!info.isFile() || info.size !== file.size) throw new Error(`Invalid model member: ${file.path}`);
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  if (digest !== file.sha256) throw new Error(`Checksum mismatch: ${file.path}`);
}

const pack = tar.pack();
const gzip = createGzip({ level: 9, mtime: 0 });
const writing = pipeline(pack, gzip, createWriteStream(partial, { mode: 0o600 }));
for (const file of upstream.files) {
  const entry = pack.entry({
    name: `small.en/${file.path}`,
    size: file.size,
    mode: 0o644,
    uid: 0,
    gid: 0,
    uname: "",
    gname: "",
    mtime: new Date(0)
  });
  await pipeline(createReadStream(join(source, file.path)), entry);
}
pack.finalize();
await writing;
await rename(partial, archivePath);

const archiveBytes = await readFile(archivePath);
const manifest = {
  schemaVersion: 1,
  id: "small.en",
  version: "e0e3c0a",
  repository: upstream.repository,
  revision: upstream.revision,
  license: "MIT",
  licenseUrl: `https://huggingface.co/${upstream.repository}/blob/${upstream.revision}/README.md`,
  privacy: {
    networkUse: "The archive is downloaded only after explicit confirmation.",
    localUse: "Transcription runs locally; source media and transcript text are not uploaded.",
    telemetry: false
  },
  archive: {
    name: archiveName,
    size: archiveBytes.byteLength,
    sha256: createHash("sha256").update(archiveBytes).digest("hex"),
    url: `https://github.com/GeorgeQLe/short-editor/releases/download/model-small.en-e0e3c0a/${archiveName}`
  },
  contents: upstream.files.map((file) => ({ ...file, path: `small.en/${file.path}` }))
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(join(output, manifestName), manifestText, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(manifest.archive)}\n`);
