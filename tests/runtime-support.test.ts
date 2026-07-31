import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import tar from "tar-stream";
import {
  atomicInstallModel,
  buildDiagnosticPreview,
  downloadVerifiedFile,
  extractVerifiedModelArchive,
  ModelInstallManager,
  verifyFileChecksum,
  writeDiagnosticZip,
  type ModelReleaseManifest,
  type RuntimeReadiness
} from "../src/electron/runtime-support";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const readiness: RuntimeReadiness = {
  checkedAt: "2026-07-30T12:00:00.000Z",
  localWorkflowReady: false,
  checks: [{
    id: "model",
    label: "English transcription model",
    state: "needs_attention",
    detail: "Not installed",
    action: "install_model"
  }]
};

const modelBytes = Buffer.from("verified model");
const modelManifest: ModelReleaseManifest = {
  schemaVersion: 1,
  id: "small.en",
  version: "fixture",
  repository: "fixture/model",
  revision: "a".repeat(40),
  license: "MIT",
  licenseUrl: "https://example.invalid/license",
  privacy: { networkUse: "explicit", localUse: "local", telemetry: false },
  archive: {
    name: "model.tar.gz",
    size: 1,
    sha256: "0".repeat(64),
    url: "https://github.com/GeorgeQLe/short-editor/releases/download/fixture/model.tar.gz"
  },
  contents: [{
    path: "small.en/model.bin",
    size: modelBytes.length,
    sha256: createHash("sha256").update(modelBytes).digest("hex")
  }]
};

describe("desktop runtime support", () => {
  it("uses independent transcript and path consent while always removing credentials", async () => {
    const jobs = [{
      sourcePath: "/Users/creator/private/episode.mov",
      transcript: "private spoken words",
      apiKey: "sk-this-must-never-appear",
      errorMessage: "failed at /Users/creator/private/episode.mov"
    }];
    const defaultPreview = await buildDiagnosticPreview({
      appVersion: "1.0.0", readiness, jobs, platform: "darwin", arch: "arm64"
    });
    const defaultText = JSON.stringify(defaultPreview);
    expect(defaultText).not.toContain("private spoken words");
    expect(defaultText).not.toContain("/Users/creator");
    expect(defaultText).not.toContain("sk-this");

    const transcriptOnly = await buildDiagnosticPreview({
      appVersion: "1.0.0", readiness, jobs, platform: "darwin", arch: "arm64",
      includeTranscripts: true
    });
    const transcriptText = JSON.stringify(transcriptOnly);
    expect(transcriptText).toContain("private spoken words");
    expect(transcriptText).not.toContain("/Users/creator");
    expect(transcriptText).not.toContain("sk-this");
  });

  it("writes an atomic readable ZIP containing diagnostics.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-support-"));
    roots.push(root);
    const output = join(root, "diagnostics.zip");
    const preview = await buildDiagnosticPreview({
      appVersion: "1.0.0", readiness, jobs: []
    });
    await writeDiagnosticZip(output, preview);
    const bytes = readFileSync(output);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from("diagnostics.json"))).toBe(true);
    expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  });

  it("verifies staged resource checksums", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-checksum-"));
    roots.push(root);
    const file = join(root, "resource.bin");
    writeFileSync(file, "release bytes");
    expect(await verifyFileChecksum(
      file,
      "ff7a5e6429d2c8511521e4abf41cd54a3e525ef4a1f24f8d1c67ede9d17874dd"
    )).toBe(true);
    expect(await verifyFileChecksum(file, "0".repeat(64))).toBe(false);
  });

  it("resumes a partial transfer and preserves a usable destination until verification", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-download-"));
    roots.push(root);
    const destination = join(root, "model.bin");
    writeFileSync(destination, "prior verified model");
    writeFileSync(`${destination}.partial`, "release ");
    const ranges: string[] = [];
    await downloadVerifiedFile({
      url: "https://models.invalid/model.bin",
      destination,
      expectedSha256: "ff7a5e6429d2c8511521e4abf41cd54a3e525ef4a1f24f8d1c67ede9d17874dd",
      fetcher: async (_url, init) => {
        ranges.push(new Headers(init?.headers).get("range") ?? "");
        return new Response("bytes", { status: 206, headers: { "content-length": "5" } });
      }
    });
    expect(ranges).toEqual(["bytes=8-"]);
    expect(readFileSync(destination, "utf8")).toBe("release bytes");

    writeFileSync(`${destination}.partial`, "corrupt");
    await expect(downloadVerifiedFile({
      url: "https://models.invalid/model.bin",
      destination,
      expectedSha256: "0".repeat(64),
      fetcher: async () => new Response("replacement", { status: 200 })
    })).rejects.toThrow("checksum");
    expect(readFileSync(destination, "utf8")).toBe("release bytes");
    expect(existsSync(`${destination}.partial`)).toBe(false);
  });

  it("keeps partial bytes after cancellation so the next transfer can resume", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-cancel-"));
    roots.push(root);
    const destination = join(root, "model.bin");
    const controller = new AbortController();
    await expect(downloadVerifiedFile({
      url: "https://models.invalid/model.bin",
      destination,
      expectedSha256: "0".repeat(64),
      signal: controller.signal,
      fetcher: async () => new Response("partial transfer", { status: 200 }),
      onProgress: () => controller.abort()
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(readFileSync(`${destination}.partial`, "utf8")).toBe("partial transfer");
    expect(existsSync(destination)).toBe(false);
  });

  it("recovers resumable state after restart and rejects installs without enough disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-manager-"));
    roots.push(root);
    const models = join(root, "models");
    const modelManifestPath = join(root, "manifest.json");
    const oversizedManifest = {
      ...modelManifest,
      archive: {
        ...modelManifest.archive,
        size: Number.MAX_SAFE_INTEGER,
        sha256: "0".repeat(64)
      }
    };
    writeFileSync(modelManifestPath, `${JSON.stringify(oversizedManifest)}\n`);
    mkdirSync(join(models, "downloads"), { recursive: true });
    writeFileSync(
      join(models, "downloads", `${modelManifest.archive.name}.partial`),
      "resumable"
    );
    const manager = new ModelInstallManager({ models, modelManifest: modelManifestPath });
    expect(await manager.initialize()).toMatchObject({
      phase: "paused",
      receivedBytes: 9,
      canResume: true
    });
    await manager.start();
    await manager.cancel();
    expect(manager.snapshot()).toMatchObject({
      phase: "failed",
      canResume: true
    });
    expect(manager.snapshot().message).toContain("Insufficient disk space");
    expect(readFileSync(
      join(models, "downloads", `${modelManifest.archive.name}.partial`),
      "utf8"
    )).toBe("resumable");
  });

  it("extracts only complete checksum-pinned model members", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-model-extract-"));
    roots.push(root);
    const archive = join(root, "model.tar.gz");
    writeFileSync(archive, await modelArchive([
      { name: "small.en/model.bin", bytes: modelBytes }
    ]));
    const staging = join(root, "staging");
    await extractVerifiedModelArchive({ archivePath: archive, stagingDirectory: staging,
      manifest: modelManifest });
    expect(readFileSync(join(staging, "small.en", "model.bin"), "utf8")).toBe("verified model");

    writeFileSync(archive, await modelArchive([
      { name: "small.en/model.bin", bytes: Buffer.from("corrupt model") }
    ]));
    await expect(extractVerifiedModelArchive({
      archivePath: archive, stagingDirectory: staging, manifest: modelManifest
    })).rejects.toThrow(/size mismatch|checksum mismatch/);
    expect(existsSync(staging)).toBe(false);
  });

  it("rejects traversal members and preserves the previous verified model on activation failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "short-editor-model-safety-"));
    roots.push(root);
    const archive = join(root, "traversal.tar.gz");
    writeFileSync(archive, await modelArchive([
      { name: "../escape", bytes: modelBytes }
    ]));
    await expect(extractVerifiedModelArchive({
      archivePath: archive, stagingDirectory: join(root, "staging"), manifest: modelManifest
    })).rejects.toThrow(/unsafe|Unexpected/);
    expect(existsSync(join(root, "escape"))).toBe(false);

    const target = join(root, "models", "small.en");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "model.bin"), "prior verified model");
    await expect(atomicInstallModel({
      extractedModelDirectory: join(root, "missing-staging", "small.en"),
      targetModelDirectory: target
    })).rejects.toThrow();
    expect(readFileSync(join(target, "model.bin"), "utf8")).toBe("prior verified model");
  });
});

async function modelArchive(entries: Array<{ name: string; bytes: Buffer }>): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<void>((resolve, reject) => {
    pack.on("end", resolve);
    pack.on("error", reject);
  });
  for (const entry of entries) {
    pack.entry({
      name: entry.name,
      size: entry.bytes.length,
      mode: 0o644,
      mtime: new Date(0)
    }, entry.bytes);
  }
  pack.finalize();
  await completed;
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}
