#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import opentype from "opentype.js";

const execute = promisify(execFile);
const root = resolve(new URL("../..", import.meta.url).pathname);
const resourcesRoot = join(root, "resources");
const modelManifestPath = join(resourcesRoot, "models",
  "faster-whisper-small.en-e0e3c0a.manifest.json");
const modelManifest = JSON.parse(await readFile(modelManifestPath, "utf8"));

const specs = [
  {
    id: "ffmpeg", version: "8.1.2+x264-r3222", path: "bin/ffmpeg",
    licenseEvidence: "licenses/FFmpeg-GPLv2.txt", executable: true,
    architecture: "arm64", executionMode: "native",
    source: {
      url: "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz",
      sha256: "464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
    }
  },
  {
    id: "ffprobe", version: "8.1.2", path: "bin/ffprobe",
    licenseEvidence: "licenses/FFmpeg-GPLv2.txt", executable: true,
    architecture: "arm64", executionMode: "native",
    source: {
      url: "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz",
      sha256: "464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
    }
  },
  {
    id: "python-worker",
    version: "0.3.0+python-3.12.12+faster-whisper-1.2.1+ctranslate2-4.8.1",
    path: "worker/short-editor-worker",
    licenseEvidence: "licenses/worker-notices.txt",
    executable: true, architecture: "arm64", executionMode: "native",
    source: {
      url: "resources/worker/requirements.lock",
      sha256: createHash("sha256").update(
        await readFile(join(resourcesRoot, "worker/requirements.lock"))
      ).digest("hex")
    }
  },
  {
    id: "inter-regular", version: fontVersion("fonts/Inter-Regular.otf"),
    path: "fonts/Inter-Regular.otf", licenseEvidence: "fonts/OFL.txt",
    architecture: "neutral", executionMode: "native",
    source: {
      url: "https://github.com/rsms/inter",
      sha256: createHash("sha256").update(
        await readFile(join(resourcesRoot, "fonts/Inter-Regular.otf"))
      ).digest("hex")
    }
  },
  {
    id: "inter-bold", version: fontVersion("fonts/Inter-Bold.otf"),
    path: "fonts/Inter-Bold.otf", licenseEvidence: "fonts/OFL.txt",
    architecture: "neutral", executionMode: "native",
    source: {
      url: "https://github.com/rsms/inter",
      sha256: createHash("sha256").update(
        await readFile(join(resourcesRoot, "fonts/Inter-Bold.otf"))
      ).digest("hex")
    }
  }
];

async function fontVersion(path) {
  const bytes = await readFile(join(resourcesRoot, path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const font = opentype.parse(buffer);
  return font.names.version?.en ?? font.names.fontFamily?.en ?? "Inter";
}

for (const spec of specs) {
  if (spec.version instanceof Promise) spec.version = await spec.version;
}

const resources = await Promise.all(specs.map(async (spec) => {
  const path = join(resourcesRoot, spec.path);
  const bytes = await readFile(path);
  const info = await stat(path);
  return {
    id: spec.id,
    version: spec.version,
    path: spec.path,
    licenseEvidence: spec.licenseEvidence,
    architecture: spec.architecture,
    executionMode: spec.executionMode,
    source: spec.source,
    size: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}));

const manifestBytes = await readFile(modelManifestPath);
const manifest = {
  schemaVersion: 3,
  generatedBy: "scripts/release/generate-runtime-manifest.mjs",
  releasePlatform: {
    os: "macos",
    minimumVersion: "14.0",
    applicationArchitecture: "arm64"
  },
  resources,
  models: [{
    id: modelManifest.id,
    bundled: false,
    transfer: "explicit-resumable-only",
    version: modelManifest.version,
    revision: modelManifest.revision,
    license: modelManifest.license,
    archiveUrl: modelManifest.archive.url,
    archiveSize: modelManifest.archive.size,
    archiveSha256: modelManifest.archive.sha256,
    manifestPath: "models/faster-whisper-small.en-e0e3c0a.manifest.json",
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex")
  }]
};

await writeFile(
  join(resourcesRoot, "runtime-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
await execute(join(root, "scripts/validate-runtime-resources.mjs"));
