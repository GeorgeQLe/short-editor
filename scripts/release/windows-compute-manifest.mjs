#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { digest } from "./runtime-manifest-lib.mjs";

const root = resolve(process.argv[2] ?? "");
const operation = process.argv[3] ?? "--verify";
if (!root || !["--write", "--verify"].includes(operation)) {
  throw new Error("Usage: windows-compute-manifest.mjs <compute-root> <--write|--verify>");
}
const manifestPath = join(root, "compute-manifest.json");
if (operation === "--write") {
  const contents = [];
  for (const path of (await walk(join(root, "worker"))).sort()) {
    const bytes = await readFile(path);
    contents.push({
      path: relative(root, path).replaceAll("\\", "/"),
      size: (await stat(path)).size,
      sha256: digest(bytes)
    });
  }
  const manifest = {
    schemaVersion: 1,
    architecture: "x64",
    worker: {
      python: "3.12.12",
      pyinstaller: "6.21.0",
      fasterWhisper: "1.2.1",
      ctranslate2: "4.8.1"
    },
    contents
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Wrote pinned x64 compute manifest with ${contents.length} files.\n`);
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const failures = [];
  if (manifest.schemaVersion !== 1 || manifest.architecture !== "x64" ||
      manifest.worker?.python !== "3.12.12" ||
      manifest.worker?.pyinstaller !== "6.21.0" ||
      manifest.worker?.fasterWhisper !== "1.2.1" ||
      manifest.worker?.ctranslate2 !== "4.8.1" ||
      !Array.isArray(manifest.contents) || manifest.contents.length === 0) {
    failures.push("compute manifest metadata is invalid");
  }
  const expected = new Set();
  for (const entry of manifest.contents ?? []) {
    if (typeof entry.path !== "string" || entry.path.split(/[\\/]/).includes("..") ||
        !entry.path.startsWith("worker/")) {
      failures.push(`unsafe compute path ${entry.path}`);
      continue;
    }
    expected.add(entry.path);
    try {
      const path = join(root, entry.path);
      const bytes = await readFile(path);
      if ((await stat(path)).size !== entry.size || digest(bytes) !== entry.sha256) {
        failures.push(`${entry.path}: compute bundle checksum or size mismatch`);
      }
    } catch {
      failures.push(`${entry.path}: compute bundle file is missing`);
    }
  }
  for (const path of await walk(join(root, "worker"))) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (!expected.has(name)) failures.push(`${name}: undeclared compute bundle file`);
  }
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write(`Verified pinned x64 compute bundle with ${expected.size} files.\n`);
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
