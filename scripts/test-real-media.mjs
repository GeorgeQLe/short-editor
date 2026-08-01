#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

if (process.env.CI_REAL_MEDIA !== "1") {
  throw new Error("test:real-media requires CI_REAL_MEDIA=1.");
}

for (const name of ["SHORT_EDITOR_TEST_FFMPEG", "SHORT_EDITOR_TEST_FFPROBE"]) {
  const path = process.env[name];
  if (!path || !isAbsolute(path)) {
    throw new Error(`test:real-media requires an absolute ${name} path.`);
  }
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`${name} does not identify a file.`);
}

const vitest = resolve("node_modules/vitest/vitest.mjs");
const child = spawn(process.execPath, [
  vitest, "run", "--config", "vitest.config.ts", "tests/render.test.ts"
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Vitest terminated by ${signal}.\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
