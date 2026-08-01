import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, sep } from "node:path";

export const WINDOWS_REQUIRED_RESOURCES = [
  "ffmpeg",
  "ffprobe",
  "python-worker",
  "inter-regular",
  "inter-bold"
];

export function parsePeArchitecture(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("not a PE executable");
  }
  const offset = bytes.readUInt32LE(0x3c);
  if (offset + 6 > bytes.length || bytes.readUInt32LE(offset) !== 0x00004550) {
    throw new Error("invalid PE signature");
  }
  const machine = bytes.readUInt16LE(offset + 4);
  if (machine === 0x8664) return "x64";
  if (machine === 0xaa64) return "arm64";
  throw new Error(`unsupported PE machine type 0x${machine.toString(16)}`);
}

export function validateManifestV3(manifest, expected = {}) {
  const failures = [];
  if (!manifest || typeof manifest !== "object") return ["runtime manifest is not an object"];
  if (manifest.schemaVersion !== 3) failures.push("runtime manifest schema must be version 3");
  const platform = manifest.releasePlatform;
  if (!platform || !["macos", "windows"].includes(platform.os)) {
    failures.push("runtime manifest target OS is invalid");
  }
  if (!["x64", "arm64"].includes(platform?.applicationArchitecture)) {
    failures.push("runtime manifest application architecture is invalid");
  }
  if (expected.os && platform?.os !== expected.os) {
    failures.push(`runtime manifest targets ${platform?.os}, expected ${expected.os}`);
  }
  if (expected.architecture &&
      platform?.applicationArchitecture !== expected.architecture) {
    failures.push(
      `runtime manifest targets ${platform?.applicationArchitecture}, ` +
      `expected ${expected.architecture}`
    );
  }
  if (!Array.isArray(manifest.resources)) failures.push("runtime resources must be an array");
  if (!Array.isArray(manifest.models)) failures.push("runtime models must be an array");
  const ids = new Set();
  for (const resource of manifest.resources ?? []) {
    if (!resource || typeof resource.id !== "string" || ids.has(resource.id)) {
      failures.push(`${resource?.id ?? "unknown"}: resource id is missing or duplicated`);
      continue;
    }
    ids.add(resource.id);
    if (!["x64", "arm64", "neutral"].includes(resource.architecture)) {
      failures.push(`${resource.id}: resource architecture is invalid`);
    }
    if (!["native", "emulated"].includes(resource.executionMode)) {
      failures.push(`${resource.id}: execution mode is invalid`);
    }
    if (resource.executionMode === "native" && resource.architecture !== "neutral" &&
        resource.architecture !== platform?.applicationArchitecture) {
      failures.push(`${resource.id}: native resource does not match application architecture`);
    }
    if (resource.executionMode === "emulated" &&
        !(platform?.os === "windows" && platform?.applicationArchitecture === "arm64" &&
          resource.architecture === "x64")) {
      failures.push(`${resource.id}: emulation declaration is unsupported`);
    }
    if (!safeRelativePath(resource.path)) failures.push(`${resource.id}: resource path is unsafe`);
    if (!safeRelativePath(resource.licenseEvidence)) {
      failures.push(`${resource.id}: license evidence path is unsafe`);
    }
    if (!Number.isSafeInteger(resource.size) || resource.size <= 0) {
      failures.push(`${resource.id}: resource size is not pinned`);
    }
    if (!sha256(resource.sha256)) failures.push(`${resource.id}: resource SHA-256 is not pinned`);
    if (typeof resource.version !== "string" || resource.version.length < 2) {
      failures.push(`${resource.id}: resource version is not pinned`);
    }
    if (!resource.source || typeof resource.source.url !== "string" ||
        !sha256(resource.source.sha256)) {
      failures.push(`${resource.id}: source provenance is incomplete`);
    }
  }
  if (platform?.os === "windows") {
    for (const id of WINDOWS_REQUIRED_RESOURCES) {
      if (!ids.has(id)) failures.push(`${id}: required Windows resource is missing`);
    }
  }
  return failures;
}

export async function validateRuntimeTree(root, manifest, options = {}) {
  const failures = validateManifestV3(manifest, options);
  const resolvedRoot = normalize(root);
  for (const resource of manifest.resources ?? []) {
    if (!safeRelativePath(resource.path) || !safeRelativePath(resource.licenseEvidence)) continue;
    const path = join(resolvedRoot, resource.path);
    try {
      const info = await stat(path);
      if (!info.isFile()) {
        failures.push(`${resource.id}: expected a file at ${resource.path}`);
        continue;
      }
      const bytes = await readFile(path);
      if (options.os === "macos" && resource.architecture !== "neutral" &&
          (info.mode & 0o111) === 0) {
        failures.push(`${resource.id}: executable bit is missing`);
      }
      if (info.size !== resource.size) failures.push(`${resource.id}: size mismatch`);
      if (digest(bytes) !== resource.sha256) failures.push(`${resource.id}: checksum mismatch`);
      if (resource.path.toLowerCase().endsWith(".exe")) {
        try {
          const actual = parsePeArchitecture(bytes);
          if (actual !== resource.architecture) {
            failures.push(`${resource.id}: PE architecture is ${actual}, expected ${
              resource.architecture
            }`);
          }
        } catch (error) {
          failures.push(`${resource.id}: ${error.message}`);
        }
      }
    } catch {
      failures.push(`${resource.id}: resource is missing at ${resource.path}`);
    }
    try {
      const evidence = await stat(join(resolvedRoot, resource.licenseEvidence));
      if (!evidence.isFile() || evidence.size === 0) throw new Error();
    } catch {
      failures.push(`${resource.id}: license evidence is missing`);
    }
  }
  for (const model of manifest.models ?? []) {
    if (!safeRelativePath(model.manifestPath) ||
        !sha256(model.archiveSha256) || !sha256(model.manifestSha256) ||
        !Number.isSafeInteger(model.archiveSize) ||
        !model.archiveUrl?.startsWith("https://github.com/GeorgeQLe/short-editor/releases/download/") ||
        model.bundled !== false ||
        model.transfer !== "explicit-resumable-only") {
      failures.push(`${model.id ?? "model"}: immutable model metadata is incomplete`);
      continue;
    }
    try {
      const bytes = await readFile(join(resolvedRoot, model.manifestPath));
      if (digest(bytes) !== model.manifestSha256) {
        failures.push(`${model.id}: model manifest checksum mismatch`);
      }
      const release = JSON.parse(bytes);
      if (release.revision !== model.revision ||
          release.archive.sha256 !== model.archiveSha256 ||
          release.archive.size !== model.archiveSize ||
          !Array.isArray(release.contents) || release.contents.length < 5 ||
          release.contents.some((entry) =>
            !sha256(entry.sha256) || !Number.isSafeInteger(entry.size) ||
            !entry.path.startsWith(`${model.id}/`)
          )) failures.push(`${model.id}: model manifest contents are invalid`);
    } catch {
      failures.push(`${model.id}: versioned model manifest is missing`);
    }
  }
  for (const required of options.requiredFiles ?? []) {
    try {
      const info = await stat(join(resolvedRoot, required));
      if (!info.isFile() || info.size === 0) throw new Error();
    } catch {
      failures.push(`${required}: required release evidence is missing`);
    }
  }
  return failures;
}

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && !isAbsolute(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) && !value.split(/[\\/]/).includes("..") &&
    !normalize(value).split(sep).includes("..");
}
