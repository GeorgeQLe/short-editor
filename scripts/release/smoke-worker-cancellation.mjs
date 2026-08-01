#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: smoke-worker-cancellation.mjs <worker-executable>");
const child = spawn(executable, [], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: child.stdout });
const timeout = setTimeout(() => child.kill(), 60_000);
const jobId = "00000000-0000-4000-8000-000000000099";
let cancelled = false;
child.stdin.write(`${JSON.stringify({
  protocolVersion: "v1", type: "hello", requestId: "cancel-hello", coreVersion: "0.1.0"
})}\n`);
for await (const line of lines) {
  const event = JSON.parse(line);
  if (event.type === "ready" && event.requestId === "cancel-hello") {
    child.stdin.write(`${JSON.stringify({
      protocolVersion: "v1", type: "job.cancel", requestId: "cancel-request", jobId
    })}\n`);
  }
  if (event.type === "job.cancelled" && event.jobId === jobId) {
    cancelled = true;
    child.stdin.write(`${JSON.stringify({
      protocolVersion: "v1", type: "shutdown", requestId: "cancel-shutdown"
    })}\n`);
  }
  if (event.type === "shutdown.complete") break;
}
clearTimeout(timeout);
if (child.exitCode === null) child.kill();
if (!cancelled) throw new Error("Frozen worker did not acknowledge cancellation");
process.stdout.write("Frozen worker cancellation passed.\n");
