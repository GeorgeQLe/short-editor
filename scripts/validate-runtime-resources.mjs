#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "resources", "runtime-manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifestText = manifestBytes.toString("utf8");
const manifest = JSON.parse(manifestText);
const failures = [];
const forbidden = [
  Buffer.from("/opt/homebrew"),
  Buffer.from("/usr/local/Cellar"),
  Buffer.from(root),
  Buffer.from("short-editor-release-probe"),
  Buffer.from("gho_")
];

if (manifest.schemaVersion !== 2) failures.push("runtime manifest schema must be version 2");
if (/release-candidate-pinned|release-manifest-required|signed-model-manifest-required/.test(
  manifestText
)) failures.push("runtime manifest still contains release placeholders");
if (manifest.releasePlatform?.architecture !== "arm64") {
  failures.push("runtime manifest must target arm64");
}

for (const resource of manifest.resources ?? []) {
  const path = join(root, "resources", resource.path);
  if (!/^[a-f0-9]{64}$/.test(resource.sha256 ?? "")) {
    failures.push(`${resource.id}: release SHA-256 is not pinned`);
    continue;
  }
  if (!Number.isSafeInteger(resource.size) || resource.size <= 0) {
    failures.push(`${resource.id}: release size is not pinned`);
  }
  if (typeof resource.version !== "string" || resource.version.length < 2) {
    failures.push(`${resource.id}: release version is not pinned`);
  }
  try {
    await access(join(root, "resources", resource.licenseEvidence), constants.R_OK);
  } catch {
    failures.push(`${resource.id}: license evidence is missing`);
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      failures.push(`${resource.id}: expected a file at ${resource.path}`);
      continue;
    }
    const bytes = await readFile(path);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== resource.sha256) failures.push(`${resource.id}: checksum mismatch`);
    if (info.size !== resource.size) failures.push(`${resource.id}: size mismatch`);
    if (resource.path.startsWith("bin/") || resource.id === "python-worker") {
      if ((info.mode & 0o111) === 0) failures.push(`${resource.id}: executable bit is missing`);
      await validateMachO(resource.id, path, bytes);
    }
  } catch (error) {
    failures.push(`${resource.id}: ${error instanceof Error ? error.message : "resource missing"}`);
  }
}

for (const model of manifest.models ?? []) {
  if (
    !/^[a-f0-9]{64}$/.test(model.archiveSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(model.manifestSha256 ?? "") ||
    !Number.isSafeInteger(model.archiveSize) ||
    !model.archiveUrl?.startsWith(
      "https://github.com/GeorgeQLe/short-editor/releases/download/model-small.en-e0e3c0a/"
    )
  ) {
    failures.push(`${model.id}: immutable model release metadata is incomplete`);
    continue;
  }
  try {
    const modelPath = join(root, "resources", model.manifestPath);
    const bytes = await readFile(modelPath);
    if (createHash("sha256").update(bytes).digest("hex") !== model.manifestSha256) {
      failures.push(`${model.id}: model manifest checksum mismatch`);
    }
    const release = JSON.parse(bytes.toString("utf8"));
    if (
      release.revision !== model.revision ||
      release.archive.sha256 !== model.archiveSha256 ||
      release.archive.size !== model.archiveSize ||
      release.contents.length < 5 ||
      release.contents.some((member) =>
        !/^[a-f0-9]{64}$/.test(member.sha256) ||
        !Number.isSafeInteger(member.size) ||
        !member.path.startsWith(`${model.id}/`)
      )
    ) failures.push(`${model.id}: model manifest contents are invalid`);
  } catch {
    failures.push(`${model.id}: versioned model manifest is missing`);
  }
}

if (process.platform === "darwin") {
  await commandGate("FFmpeg capability smoke", join(root, "scripts/release/smoke-ffmpeg.sh"), [
    join(root, "resources/bin/ffmpeg"),
    join(root, "resources/bin/ffprobe")
  ]);
  await commandGate("frozen worker protocol smoke", process.execPath, [
    join(root, "scripts/release/smoke-worker.mjs"),
    join(root, "resources/worker/short-editor-worker")
  ]);
  const sqliteBinding = join(root, "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  try {
    const bytes = await readFile(sqliteBinding);
    await validateMachO("better-sqlite3", sqliteBinding, bytes);
  } catch (error) {
    failures.push(`better-sqlite3: ${
      error instanceof Error ? error.message : "arm64 binding is missing"
    }`);
  }
}

if (failures.length) {
  process.stderr.write(`Runtime resource validation failed:\n${
    failures.map((item) => `- ${item}`).join("\n")
  }\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Runtime resources match pinned versions, licenses, sizes, architectures, and checksums.\n"
  );
}

async function validateMachO(id, path, bytes) {
  const type = await execute("file", [path]);
  if (!/Mach-O 64-bit.*arm64/.test(type.stdout)) failures.push(`${id}: binary is not arm64 Mach-O`);
  const dependencies = await execute("otool", ["-L", path]);
  for (const line of dependencies.stdout.split("\n").slice(1)) {
    const dependency = line.trim().split(" ")[0];
    if (
      dependency &&
      !dependency.startsWith("/usr/lib/") &&
      !dependency.startsWith("/System/Library/") &&
      !dependency.startsWith("@rpath/") &&
      !dependency.startsWith("@loader_path/") &&
      !dependency.startsWith("@executable_path/")
    ) failures.push(`${id}: non-system Mach-O dependency ${dependency}`);
  }
  for (const pattern of forbidden) {
    if (bytes.includes(pattern)) failures.push(`${id}: contains forbidden developer or credential path`);
  }
}

async function commandGate(label, command, args) {
  try {
    await execute(command, args, {
      cwd: root,
      env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024
    });
  } catch (error) {
    failures.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
