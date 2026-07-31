#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const appPath = resolve(process.argv[2]);
const dmgPath = resolve(process.argv[3]);
const root = resolve(new URL("../..", import.meta.url).pathname);

async function hash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function appTree(path) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await visit(path);
  files.sort();
  const digest = createHash("sha256");
  let size = 0;
  for (const file of files) {
    const info = await stat(file);
    size += info.size;
    digest.update(relative(path, file));
    digest.update("\0");
    digest.update(await hash(file));
    digest.update("\0");
  }
  return { size, sha256: digest.digest("hex"), hashFormat: "sorted-path-and-file-sha256-v1" };
}

async function evidence(command, args) {
  try {
    const result = await execute(command, args);
    return { passed: true, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return {
      passed: false,
      output: error instanceof Error ? error.message : String(error)
    };
  }
}

const appInfo = await appTree(appPath);
const dmgInfo = await stat(dmgPath);
const record = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  app: {
    name: basename(appPath),
    ...appInfo,
    codesign: await evidence("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]),
    gatekeeper: await evidence("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]),
    staple: await evidence("xcrun", ["stapler", "validate", appPath])
  },
  dmg: {
    name: basename(dmgPath),
    size: dmgInfo.size,
    sha256: await hash(dmgPath),
    gatekeeper: await evidence("spctl", ["--assess", "--type", "open", "--context",
      "context:primary-signature", "--verbose=4", dmgPath]),
    staple: await evidence("xcrun", ["stapler", "validate", dmgPath])
  }
};
await mkdir(join(root, "build/release-evidence"), { recursive: true });
await writeFile(join(root, "build/release-evidence/macos-artifacts.json"),
  `${JSON.stringify(record, null, 2)}\n`);
