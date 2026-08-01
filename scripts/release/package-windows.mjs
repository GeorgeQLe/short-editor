#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { parsePeArchitecture } from "./runtime-manifest-lib.mjs";

const execute = promisify(execFile);
const root = resolve(new URL("../..", import.meta.url).pathname);
const architecture = process.argv[2];
if (!["x64", "arm64"].includes(architecture)) {
  throw new Error("Usage: package-windows.mjs <x64|arm64>");
}
if (process.platform !== "win32") throw new Error("Windows installers must be built on Windows.");
const runtimeRoot = join(root, "build/runtime", `windows-${architecture}`);
const output = join(root, "dist", `windows-${architecture}`);
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (packageJson.devDependencies.electron !== "43.2.0" ||
    packageJson.dependencies["better-sqlite3"] !== "12.11.1") {
  throw new Error("Electron and better-sqlite3 must remain exactly pinned for Windows packaging.");
}

await run(process.execPath, [
  join(root, "scripts/validate-runtime-resources.mjs"),
  "--root", runtimeRoot, "--os", "windows", "--arch", architecture
]);
await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
const configPath = join(runtimeRoot, "electron-builder.windows.json");
await writeFile(configPath, `${JSON.stringify({
  appId: "com.lexcorp.shorteditor",
  productName: "SiftCut",
  directories: { output },
  files: ["dist/**", "package.json"],
  asarUnpack: ["**/*.node"],
  extraResources: [{ from: runtimeRoot, to: ".", filter: [
    "bin/**/*", "worker/**/*", "fonts/**/*", "models/**/*", "licenses/**/*",
    "release/**/*", "runtime-manifest.json"
  ] }],
  win: {
    target: "nsis",
    artifactName: `SiftCut-\${version}-windows-\${arch}.\${ext}`,
    signAndEditExecutable: false
  },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true }
}, null, 2)}\n`);
const builder = join(root, "node_modules/.bin/electron-builder.cmd");
await run(builder, ["--win", "nsis", `--${architecture}`, "--config", configPath, "--publish", "never"], {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false"
});

const unpacked = (await readdir(output, { withFileTypes: true }))
  .find((entry) => entry.isDirectory() && entry.name.includes("unpacked"));
if (!unpacked) throw new Error("electron-builder did not produce an unpacked application.");
const unpackedRoot = join(output, unpacked.name);
const bindings = (await walk(unpackedRoot)).filter((path) =>
  path.toLowerCase().endsWith("better_sqlite3.node")
);
if (bindings.length !== 1) throw new Error("Exactly one packaged better-sqlite3 binding is required.");
const bindingArch = parsePeArchitecture(await readFile(bindings[0]));
if (bindingArch !== architecture) {
  throw new Error(`better-sqlite3 binding is ${bindingArch}, expected ${architecture}`);
}
const executable = join(unpackedRoot, "SiftCut.exe");
const executableArchitecture = parsePeArchitecture(await readFile(executable));
if (executableArchitecture !== architecture) {
  throw new Error(`Packaged Electron executable is ${executableArchitecture}, expected ${
    architecture
  }`);
}
const appArchive = join(unpackedRoot, "resources/app.asar");
await run(executable, [join(appArchive, "dist/electron/sqlite-smoke.js")], {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1"
});
await smokePackagedCore(executable, appArchive, unpackedRoot);
const expectedArtifact = join(output,
  `SiftCut-${packageJson.version}-windows-${architecture}.exe`);
if (!(await stat(expectedArtifact)).isFile()) throw new Error(`Missing ${expectedArtifact}`);
await copyFile(
  join(runtimeRoot, "release/corresponding-source-offer.txt"),
  join(output, `SiftCut-${packageJson.version}-windows-${architecture}-source-offer.txt`)
);
process.stdout.write(`Built and verified unsigned Windows ${architecture} installer.\n`);

async function run(command, args, env = process.env) {
  const result = await execute(command, args, {
    cwd: root, env, timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
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

async function smokePackagedCore(executable, appArchive, unpackedRoot) {
  const data = await mkdtemp(join(tmpdir(), "siftcut-packaged-core-"));
  const systemPath = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const child = spawn(executable, [join(appArchive, "dist/core/cli.js")], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: systemPath,
      ELECTRON_RUN_AS_NODE: "1",
      SHORT_EDITOR_DATA_DIR: data,
      SHORT_EDITOR_PORT: "43120",
      SHORT_EDITOR_FFMPEG: join(unpackedRoot, "resources/bin/ffmpeg.exe"),
      SHORT_EDITOR_FFPROBE: join(unpackedRoot, "resources/bin/ffprobe.exe"),
      SHORT_EDITOR_WORKER_EXECUTABLE:
        join(unpackedRoot, "resources/worker/short-editor-worker.exe")
    }
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch("http://127.0.0.1:43120/v1/health");
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((resolve_) => setTimeout(resolve_, 100));
    }
    if (!healthy) throw new Error(`Packaged loopback core failed to start: ${diagnostics}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve_) => child.once("exit", resolve_));
    }
    await rm(data, { recursive: true, force: true });
  }
}
