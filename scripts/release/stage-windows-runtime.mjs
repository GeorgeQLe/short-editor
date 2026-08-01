#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { digest, parsePeArchitecture } from "./runtime-manifest-lib.mjs";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const architecture = process.argv[2];
if (!["x64", "arm64"].includes(architecture)) {
  throw new Error("Usage: stage-windows-runtime.mjs <x64|arm64>");
}
if (process.platform !== "win32") throw new Error("Windows runtime staging must run on Windows.");

const ffmpeg = {
  version: "8.1.2",
  url: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip",
  sha256: "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"
};
const stage = join(repositoryRoot, "build/runtime", `windows-${architecture}`);
const computeRoot = resolve(process.env.SHORT_EDITOR_WINDOWS_COMPUTE_ROOT ??
  join(repositoryRoot, "build/windows-compute-x64"));
const download = join(repositoryRoot, "build/release-inputs/downloads",
  "ffmpeg-8.1.2-essentials_build.zip");
const extraction = join(repositoryRoot, "build/release-inputs/windows-ffmpeg-8.1.2");

await execute(process.execPath, [
  join(repositoryRoot, "scripts/release/windows-compute-manifest.mjs"),
  computeRoot,
  "--verify"
]);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await downloadVerified(ffmpeg.url, ffmpeg.sha256, download);
await rm(extraction, { recursive: true, force: true });
await execute("powershell.exe", [
  "-NoProfile", "-NonInteractive", "-Command",
  "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
  download, extraction
]);
const extractedFiles = await walk(extraction);
const ffmpegPath = extractedFiles.find((path) => basename(path).toLowerCase() === "ffmpeg.exe");
const ffprobePath = extractedFiles.find((path) => basename(path).toLowerCase() === "ffprobe.exe");
const gplPath = extractedFiles.find((path) =>
  /^license(?:\.[a-z0-9]+)?$/i.test(basename(path))
);
if (!ffmpegPath || !ffprobePath || !gplPath) {
  throw new Error("The pinned Gyan archive does not contain FFmpeg, ffprobe, and GPL evidence.");
}

await mkdir(join(stage, "bin"), { recursive: true });
await mkdir(join(stage, "worker"), { recursive: true });
await mkdir(join(stage, "fonts"), { recursive: true });
await mkdir(join(stage, "models"), { recursive: true });
await mkdir(join(stage, "licenses"), { recursive: true });
await mkdir(join(stage, "release"), { recursive: true });
await copyFile(ffmpegPath, join(stage, "bin/ffmpeg.exe"));
await copyFile(ffprobePath, join(stage, "bin/ffprobe.exe"));
await cp(join(computeRoot, "worker"), join(stage, "worker"), { recursive: true });
await cp(join(repositoryRoot, "resources/fonts"), join(stage, "fonts"), { recursive: true });
await copyFile(
  join(repositoryRoot, "resources/models/faster-whisper-small.en-e0e3c0a.manifest.json"),
  join(stage, "models/faster-whisper-small.en-e0e3c0a.manifest.json")
);
await copyFile(gplPath, join(stage, "licenses/FFmpeg-GPLv3.txt"));
await copyFile(
  join(repositoryRoot, "resources/licenses/worker-notices.txt"),
  join(stage, "licenses/worker-notices.txt")
);
await copyFile(
  join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
  join(stage, "licenses/THIRD_PARTY_NOTICES.txt")
);
await copyFile(
  join(computeRoot, "compute-manifest.json"),
  join(stage, "release/x64-compute-manifest.json")
);

const lockPath = join(repositoryRoot, "resources/worker/requirements.windows-x64.lock");
const lockHash = digest(await readFile(lockPath));
const computeManifestHash = digest(await readFile(join(computeRoot, "compute-manifest.json")));
const computeSource = {
  url: "windows-compute-x64/compute-manifest.json",
  sha256: computeManifestHash
};
const resources = [];
await addResource({
  id: "ffmpeg", version: ffmpeg.version, path: "bin/ffmpeg.exe",
  architecture: "x64", licenseEvidence: "licenses/FFmpeg-GPLv3.txt",
  source: { url: ffmpeg.url, sha256: ffmpeg.sha256 }
});
await addResource({
  id: "ffprobe", version: ffmpeg.version, path: "bin/ffprobe.exe",
  architecture: "x64", licenseEvidence: "licenses/FFmpeg-GPLv3.txt",
  source: { url: ffmpeg.url, sha256: ffmpeg.sha256 }
});
await addResource({
  id: "python-worker",
  version: "0.3.0+python-3.12.10+pyinstaller-6.21.0+faster-whisper-1.2.1+ctranslate2-4.8.1",
  path: "worker/short-editor-worker.exe", architecture: "x64",
  licenseEvidence: "licenses/worker-notices.txt",
  source: computeSource
});
for (const path of await walk(join(stage, "worker"))) {
  if (basename(path).toLowerCase() === "short-editor-worker.exe") continue;
  const relativeWorkerPath = relative(join(stage, "worker"), path).replaceAll("\\", "/");
  const isPortableExecutable = /\.(?:exe|dll|pyd)$/i.test(path);
  await addResource({
    id: `worker-runtime:${relativeWorkerPath}`,
    version: "windows-x64-worker-bundle-v1",
    path: relative(stage, path).replaceAll("\\", "/"),
    architecture: isPortableExecutable
      ? parsePeArchitecture(await readFile(path))
      : "neutral",
    licenseEvidence: "licenses/worker-notices.txt",
    source: computeSource
  });
}
for (const [id, name] of [
  ["inter-regular", "Inter-Regular.otf"],
  ["inter-bold", "Inter-Bold.otf"]
]) {
  const bytes = await readFile(join(stage, "fonts", name));
  await addResource({
    id, version: "Inter", path: `fonts/${name}`, architecture: "neutral",
    licenseEvidence: "fonts/OFL.txt",
    source: { url: "https://github.com/rsms/inter", sha256: digest(bytes) }
  });
}

const modelPath = join(stage, "models/faster-whisper-small.en-e0e3c0a.manifest.json");
const modelBytes = await readFile(modelPath);
const model = JSON.parse(modelBytes);
await writeReleaseEvidence();
for (const evidence of [
  {
    id: "ffmpeg-gplv3", version: "GPL-3.0",
    path: "licenses/FFmpeg-GPLv3.txt", licenseEvidence: "licenses/FFmpeg-GPLv3.txt",
    url: ffmpeg.url, sourceSha256: ffmpeg.sha256
  },
  {
    id: "worker-notices", version: "windows-worker-notices-v1",
    path: "licenses/worker-notices.txt", licenseEvidence: "licenses/worker-notices.txt",
    url: "resources/licenses/worker-notices.txt"
  },
  {
    id: "third-party-notices", version: "SiftCut-0.1.0",
    path: "licenses/THIRD_PARTY_NOTICES.txt",
    licenseEvidence: "licenses/THIRD_PARTY_NOTICES.txt", url: "THIRD_PARTY_NOTICES.md"
  },
  {
    id: "inter-license", version: "OFL-1.1",
    path: "fonts/OFL.txt", licenseEvidence: "fonts/OFL.txt", url: "https://github.com/rsms/inter"
  },
  {
    id: "small.en-manifest", version: model.version,
    path: "models/faster-whisper-small.en-e0e3c0a.manifest.json",
    licenseEvidence: "licenses/THIRD_PARTY_NOTICES.txt", url: model.archive.url
  },
  {
    id: "windows-sbom", version: "SPDX-2.3",
    path: "release/SBOM.spdx.json", licenseEvidence: "licenses/THIRD_PARTY_NOTICES.txt",
    url: "scripts/release/stage-windows-runtime.mjs"
  },
  {
    id: "windows-build-provenance", version: "provenance-v1",
    path: "release/build-provenance.json",
    licenseEvidence: "licenses/THIRD_PARTY_NOTICES.txt",
    url: "scripts/release/stage-windows-runtime.mjs"
  },
  {
    id: "x64-compute-manifest", version: "compute-manifest-v1",
    path: "release/x64-compute-manifest.json",
    licenseEvidence: "licenses/worker-notices.txt",
    url: "windows-compute-x64/compute-manifest.json"
  },
  {
    id: "corresponding-source-offer", version: "GPL-offer-v1",
    path: "release/corresponding-source-offer.txt",
    licenseEvidence: "licenses/FFmpeg-GPLv3.txt", url: ffmpeg.url,
    sourceSha256: ffmpeg.sha256
  }
]) {
  const bytes = await readFile(join(stage, evidence.path));
  await addResource({
    id: evidence.id,
    version: evidence.version,
    path: evidence.path,
    architecture: "neutral",
    licenseEvidence: evidence.licenseEvidence,
    source: {
      url: evidence.url,
      sha256: evidence.sourceSha256 ?? digest(bytes)
    }
  });
}
const manifest = {
  schemaVersion: 3,
  generatedBy: "scripts/release/stage-windows-runtime.mjs",
  releasePlatform: {
    os: "windows",
    minimumVersion: "11",
    applicationArchitecture: architecture
  },
  resources,
  models: [{
    id: model.id,
    bundled: false,
    transfer: "explicit-resumable-only",
    version: model.version,
    revision: model.revision,
    license: model.license,
    archiveUrl: model.archive.url,
    archiveSize: model.archive.size,
    archiveSha256: model.archive.sha256,
    manifestPath: "models/faster-whisper-small.en-e0e3c0a.manifest.json",
    manifestSha256: digest(modelBytes)
  }]
};
await writeFile(join(stage, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await execute(process.execPath, [
  join(repositoryRoot, "scripts/validate-runtime-resources.mjs"),
  "--root", stage, "--os", "windows", "--arch", architecture
], { cwd: repositoryRoot, stdio: "inherit" });
process.stdout.write(`Staged complete Windows ${architecture} runtime at ${stage}\n`);

async function addResource(input) {
  const bytes = await readFile(join(stage, input.path));
  const info = await stat(join(stage, input.path));
  resources.push({
    ...input,
    executionMode: architecture === "arm64" && input.architecture === "x64"
      ? "emulated"
      : "native",
    size: info.size,
    sha256: digest(bytes)
  });
}

async function writeReleaseEvidence() {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const sbom = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `SiftCut-Windows-${architecture}`,
    documentNamespace: `https://github.com/GeorgeQLe/short-editor/sbom/${
      process.env.GITHUB_SHA ?? "development"
    }/${architecture}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: scripts/release/stage-windows-runtime.mjs"]
    },
    packages: [
      { name: "SiftCut", versionInfo: packageJson.version, SPDXID: "SPDXRef-SiftCut" },
      { name: "FFmpeg-Gyan-essentials", versionInfo: ffmpeg.version, SPDXID: "SPDXRef-FFmpeg",
        downloadLocation: ffmpeg.url, checksums: [{ algorithm: "SHA256", checksumValue: ffmpeg.sha256 }] },
      { name: "Python", versionInfo: "3.12.10", SPDXID: "SPDXRef-Python" },
      { name: "PyInstaller", versionInfo: "6.21.0", SPDXID: "SPDXRef-PyInstaller" },
      { name: "faster-whisper", versionInfo: "1.2.1", SPDXID: "SPDXRef-faster-whisper" },
      { name: "CTranslate2", versionInfo: "4.8.1", SPDXID: "SPDXRef-CTranslate2" },
      { name: "Electron", versionInfo: "43.2.0", SPDXID: "SPDXRef-Electron" },
      { name: "better-sqlite3", versionInfo: "12.11.1", SPDXID: "SPDXRef-better-sqlite3" }
    ]
  };
  await writeFile(join(stage, "release/SBOM.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
  const provenance = {
    schemaVersion: 1,
    target: { os: "windows", architecture },
    sourceRevision: process.env.GITHUB_SHA ?? "development-worktree",
    builder: process.env.GITHUB_ACTIONS === "true" ? "GitHub Actions" : "local Windows builder",
    inputs: {
      ffmpegArchive: { url: ffmpeg.url, sha256: ffmpeg.sha256 },
      workerLock: { path: "resources/worker/requirements.windows-x64.lock", sha256: lockHash },
      x64ComputeManifest: {
        path: "windows-compute-x64/compute-manifest.json",
        sha256: computeManifestHash
      },
      electron: "43.2.0",
      betterSqlite3: "12.11.1"
    }
  };
  await writeFile(
    join(stage, "release/build-provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`
  );
  await writeFile(join(stage, "release/corresponding-source-offer.txt"),
    "SiftCut distributes the GPLv3 Gyan FFmpeg essentials build. This written offer is " +
    "published adjacent to each Windows installer: request the exact corresponding source " +
    "through the repository support channels. The offer remains valid for at least three " +
    "years after distribution. Pinned build provenance is provided with the installer.\n");
}

async function downloadVerified(url, expected, destination) {
  try {
    if (digest(await readFile(destination)) === expected) return;
  } catch {}
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error(`Checksum mismatch for ${url}`);
  const partial = `${destination}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, destination);
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
