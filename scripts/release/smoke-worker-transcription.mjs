#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [worker, sourcePath] = process.argv.slice(2);
if (!worker || !sourcePath) {
  throw new Error("Usage: smoke-worker-transcription.mjs <worker> <spoken-audio>");
}
const child = spawn(worker, [], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: child.stdout });
const timeout = setTimeout(() => child.kill(), 180_000);
let result = null;
child.stdin.write(`${JSON.stringify({
  protocolVersion: "v1", type: "hello", requestId: "transcription-hello", coreVersion: "0.1.0"
})}\n`);
for await (const line of lines) {
  const event = JSON.parse(line);
  if (event.type === "ready" && event.requestId === "transcription-hello") {
    child.stdin.write(`${JSON.stringify({
      protocolVersion: "v1",
      type: "job.start",
      requestId: "transcription-request",
      jobId: "00000000-0000-4000-8000-000000000001",
      job: {
        kind: "transcription",
        sourcePath,
        modelId: "small.en",
        language: "en",
        wordTimestamps: true
      }
    })}\n`);
  }
  if (event.type === "error") throw new Error(`${event.code}: ${event.message}`);
  if (event.type === "job.result") {
    result = event.result;
    child.stdin.write(`${JSON.stringify({
      protocolVersion: "v1", type: "shutdown", requestId: "transcription-shutdown"
    })}\n`);
  }
  if (event.type === "shutdown.complete") break;
}
clearTimeout(timeout);
if (child.exitCode === null) child.kill();
if (
  result?.kind !== "transcription" ||
  result.provenance?.providerVersion !== "1.2.1" ||
  !Array.isArray(result.segments) ||
  result.segments.length === 0 ||
  !result.segments.map((segment) => segment.text).join(" ").toLowerCase().includes("release")
) throw new Error("Real frozen-worker transcription fixture did not produce expected speech");
process.stdout.write("Frozen worker real transcription fixture passed.\n");
