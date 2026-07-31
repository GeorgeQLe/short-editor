#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: smoke-worker.mjs <worker-executable>");
const child = spawn(executable, [], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"]
});
const lines = createInterface({ input: child.stdout });
const requestId = "release-smoke";
// PyInstaller one-file extraction can exceed 20 seconds on a cold or
// contended APFS cache. Keep this below the validator's outer 120-second gate.
const timeout = setTimeout(() => child.kill(), 60_000);
let ready = false;
child.stdin.write(JSON.stringify({
  protocolVersion: "v1",
  type: "hello",
  requestId,
  coreVersion: "0.1.0"
}) + "\n");
for await (const line of lines) {
  const event = JSON.parse(line);
  if (event.type === "ready" && event.requestId === requestId) {
    if (event.workerVersion !== "0.3.0") throw new Error("Unexpected worker version");
    const dependency = event.status.dependencies.find((item) => item.id === "faster-whisper");
    if (dependency?.version !== "1.2.1") throw new Error("faster-whisper is not pinned");
    ready = true;
    child.stdin.write(JSON.stringify({
      protocolVersion: "v1", type: "shutdown", requestId: "release-shutdown"
    }) + "\n");
  }
  if (event.type === "shutdown.complete") break;
}
clearTimeout(timeout);
if (child.exitCode === null) child.kill();
if (!ready) throw new Error("Frozen worker did not complete its protocol handshake");
