import readline from "node:readline";
import { existsSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "normal";
let heartbeat;
let sequence = 0;
const active = new Set();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function capabilities() {
  return ["transcription", "diarization", "visual_sampling", "provider_call"].map((operation) => ({
    operation,
    available: operation === "transcription",
    providers: operation === "transcription" ? ["fixture"] : [],
    features: []
  }));
}

function status() {
  return {
    state: "ready",
    activeJobIds: [...active],
    dependencies: [{ id: "fixture", state: "available", version: "1", detail: null }]
  };
}

function provenance() {
  return {
    provider: "fixture",
    providerClass: "local",
    modelId: "fixture",
    providerVersion: "1",
    optionsVersion: "v1",
    createdAt: new Date().toISOString()
  };
}

function startHeartbeat() {
  if (mode === "no-heartbeat") return;
  heartbeat = setInterval(() => send({
    protocolVersion: "v1",
    type: "heartbeat",
    sequence: sequence++,
    sentAt: new Date().toISOString()
  }), 20);
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "hello") {
    if (mode === "malformed") {
      process.stdout.write("{bad json}\n");
      return;
    }
    if (mode === "partial") {
      process.stdout.write('{"protocolVersion":"v1"');
      process.exit(8);
    }
    if (mode === "wrong-version") {
      send({ protocolVersion: "v2", type: "ready", requestId: command.requestId });
      return;
    }
    send({
      protocolVersion: "v1",
      type: "ready",
      requestId: command.requestId,
      workerVersion: "fixture-1",
      capabilities: capabilities(),
      status: status()
    });
    if (mode === "stderr") process.stderr.write("token=sk-sensitive /private/source.mp4\n");
    startHeartbeat();
  } else if (command.type === "capabilities.get") {
    send({
      protocolVersion: "v1",
      type: "capabilities",
      requestId: command.requestId,
      capabilities: capabilities()
    });
  } else if (command.type === "status.get") {
    send({ protocolVersion: "v1", type: "status", requestId: command.requestId, status: status() });
  } else if (command.type === "job.start") {
    active.add(command.jobId);
    if (mode === "crash") {
      process.exit(9);
    } else if (mode === "crash-once" && !existsSync(process.argv[3])) {
      writeFileSync(process.argv[3], "crashed");
      process.exit(9);
    } else if (mode === "oversize") {
      process.stdout.write(`${"x".repeat(4096)}\n`);
    } else if (mode !== "hang" && mode !== "cancel") {
      send({
        protocolVersion: "v1",
        type: "job.progress",
        jobId: command.jobId,
        progress: 0.5,
        stage: "working"
      });
      active.delete(command.jobId);
      send({
        protocolVersion: "v1",
        type: "job.result",
        jobId: command.jobId,
        result: {
          kind: "transcription",
          language: "en",
          segments: [{ startMs: 0, endMs: 1000, text: "hello", confidence: 0.9 }],
          words: null,
          diarization: "absent",
          provenance: provenance()
        }
      });
    }
  } else if (command.type === "job.cancel") {
    active.delete(command.jobId);
    if (mode !== "hang") {
      send({ protocolVersion: "v1", type: "job.cancelled", jobId: command.jobId });
    }
  } else if (command.type === "shutdown") {
    clearInterval(heartbeat);
    send({ protocolVersion: "v1", type: "shutdown.complete", requestId: command.requestId });
    process.exit(0);
  }
});
