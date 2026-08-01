#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { digest, validateRuntimeTree } from "./release/runtime-manifest-lib.mjs";

const execute = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
const value = (name, fallback) => {
  const index = arguments_.indexOf(name);
  return index === -1 ? fallback : arguments_[index + 1];
};
const root = resolve(value("--root", join(repositoryRoot, "resources")));
const expectedOs = value("--os", undefined);
const expectedArchitecture = value("--arch", undefined);
const manifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8"));
const windows = expectedOs === "windows" || manifest.releasePlatform?.os === "windows";
const failures = await validateRuntimeTree(root, manifest, {
  os: expectedOs,
  architecture: expectedArchitecture,
  requiredFiles: windows ? [
    "licenses/FFmpeg-GPLv3.txt",
    "licenses/THIRD_PARTY_NOTICES.txt",
    "release/SBOM.spdx.json",
    "release/build-provenance.json",
    "release/x64-compute-manifest.json",
    "release/corresponding-source-offer.txt"
  ] : []
});
const manifestText = JSON.stringify(manifest);
if (/release-candidate-pinned|release-manifest-required|signed-model-manifest-required/.test(
  manifestText
)) failures.push("runtime manifest still contains release placeholders");
if (windows) await validateWindowsEvidence();

if (process.platform === "win32" && windows) {
  await commandGate("FFmpeg capability smoke", process.execPath, [
    join(repositoryRoot, "scripts/release/smoke-ffmpeg.mjs"),
    join(root, "bin/ffmpeg.exe"),
    join(root, "bin/ffprobe.exe"),
    join(root, "fonts/Inter-Regular.otf")
  ]);
  await commandGate("frozen worker protocol smoke", process.execPath, [
    join(repositoryRoot, "scripts/release/smoke-worker.mjs"),
    join(root, "worker/short-editor-worker.exe")
  ]);
}
if (process.platform === "darwin" && manifest.releasePlatform?.os === "macos") {
  for (const resource of manifest.resources ?? []) {
    if (resource.architecture === "neutral") continue;
    try {
      await validateMachO(resource.id, join(root, resource.path), await readFile(
        join(root, resource.path)
      ));
    } catch (error) {
      failures.push(`${resource.id}: ${
        error instanceof Error ? error.message : "Mach-O validation failed"
      }`);
    }
  }
  await commandGate("FFmpeg capability smoke", process.execPath, [
    join(repositoryRoot, "scripts/release/smoke-ffmpeg.mjs"),
    join(root, "bin/ffmpeg"),
    join(root, "bin/ffprobe"),
    join(root, "fonts/Inter-Regular.otf")
  ]);
  await commandGate("frozen worker protocol smoke", process.execPath, [
    join(repositoryRoot, "scripts/release/smoke-worker.mjs"),
    join(root, "worker/short-editor-worker")
  ]);
  const sqliteBinding = join(repositoryRoot,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  try {
    await validateMachO("better-sqlite3", sqliteBinding, await readFile(sqliteBinding));
  } catch (error) {
    failures.push(`better-sqlite3: ${
      error instanceof Error ? error.message : "arm64 binding is missing"
    }`);
  }
}

if (failures.length) {
  process.stderr.write(`Runtime resource validation failed:\n${
    failures.map((failure) => `- ${failure}`).join("\n")
  }\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Runtime resources match pinned versions, licenses, sizes, architectures, and checksums.\n"
  );
}

async function commandGate(label, command, args) {
  try {
    const environment = process.platform === "win32" ? {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32")
    } : {
      ...process.env,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin"
    };
    await execute(command, args, {
      cwd: repositoryRoot,
      env: environment,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    failures.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateMachO(id, path, bytes) {
  const type = await execute("file", [path]);
  if (!/Mach-O 64-bit.*arm64/.test(type.stdout)) {
    failures.push(`${id}: binary is not arm64 Mach-O`);
  }
  const dependencies = await execute("otool", ["-L", path]);
  for (const line of dependencies.stdout.split("\n").slice(1)) {
    const dependency = line.trim().split(" ")[0];
    if (dependency &&
        !dependency.startsWith("/usr/lib/") &&
        !dependency.startsWith("/System/Library/") &&
        !dependency.startsWith("@rpath/") &&
        !dependency.startsWith("@loader_path/") &&
        !dependency.startsWith("@executable_path/")) {
      failures.push(`${id}: non-system Mach-O dependency ${dependency}`);
    }
  }
  for (const pattern of [
    Buffer.from("/opt/homebrew"),
    Buffer.from("/usr/local/Cellar"),
    Buffer.from(repositoryRoot),
    Buffer.from("short-editor-release-probe"),
    Buffer.from("gho_")
  ]) if (bytes.includes(pattern)) {
    failures.push(`${id}: contains a forbidden developer or credential path`);
  }
}

async function validateWindowsEvidence() {
  try {
    const license = await readFile(join(root, "licenses/FFmpeg-GPLv3.txt"), "utf8");
    if (!/GNU GENERAL PUBLIC LICENSE/i.test(license) || !/Version 3/i.test(license)) {
      failures.push("FFmpeg GPLv3 license evidence is invalid");
    }
  } catch {
    failures.push("FFmpeg GPLv3 license evidence could not be read");
  }
  try {
    const sbom = JSON.parse(await readFile(join(root, "release/SBOM.spdx.json"), "utf8"));
    const versions = new Map((sbom.packages ?? []).map((item) => [item.name, item.versionInfo]));
    if (sbom.spdxVersion !== "SPDX-2.3" ||
        versions.get("Electron") !== "43.2.0" ||
        versions.get("better-sqlite3") !== "12.11.1" ||
        versions.get("FFmpeg-Gyan-essentials") !== "8.1.2" ||
        versions.get("Python") !== "3.12.10") {
      failures.push("Windows SPDX SBOM is incomplete or contains unpinned versions");
    }
  } catch {
    failures.push("Windows SPDX SBOM could not be parsed");
  }
  try {
    const provenance = JSON.parse(await readFile(
      join(root, "release/build-provenance.json"), "utf8"
    ));
    if (provenance.target?.os !== "windows" ||
        provenance.target?.architecture !== manifest.releasePlatform?.applicationArchitecture ||
        provenance.inputs?.ffmpegArchive?.sha256 !==
          "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec" ||
        provenance.inputs?.x64ComputeManifest?.sha256 !== digest(await readFile(
          join(root, "release/x64-compute-manifest.json")
        ))) {
      failures.push("Windows build provenance is incomplete or targets another architecture");
    }
  } catch {
    failures.push("Windows build provenance could not be parsed");
  }
}
