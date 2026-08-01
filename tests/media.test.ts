import { createHash } from "node:crypto";
import {
  chmodSync, linkSync, mkdtempSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { MediaService, quickFingerprint } from "../src/core/media";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("media inventory", () => {
  it("imports probe-readable containers, persists metadata, and rejects invalid media independently", async () => {
    const fixture = createFixture();
    const mp4 = fixture.media("standard.mp4");
    const mkv = fixture.media("alternate.mkv");
    const silent = fixture.media("silent-video.mov");
    const malformed = fixture.media("malformed.bin");
    const audioOnly = fixture.media("audio-only.m4a");
    const zero = fixture.media("zero.mp4", Buffer.alloc(0));
    const missing = join(fixture.directory, "missing.mp4");
    const before = [mp4, mkv, silent, malformed, audioOnly, zero].map(snapshot);

    const result = await fixture.service.importPaths([
      mp4, mkv, malformed, zero, silent, audioOnly, missing
    ]);

    expect(result.imported.map((episode) => basename(episode.sourcePath))).toEqual([
      "standard.mp4", "alternate.mkv", "silent-video.mov"
    ]);
    expect(result.imported[0]).toMatchObject({
      durationMs: 12_500, width: 1920, height: 1080,
      videoCodec: "h264", audioCodec: "aac", status: "indexing"
    });
    expect(result.imported[2]?.audioCodec).toBeNull();
    expect(result.rejected).toEqual([
      { path: malformed, code: "VALIDATION_ERROR", reason: "Media could not be read by FFprobe" },
      { path: zero, code: "VALIDATION_ERROR", reason: "File is empty" },
      { path: audioOnly, code: "VALIDATION_ERROR", reason: "No video stream found" },
      { path: missing, code: "VALIDATION_ERROR", reason: "File does not exist or cannot be accessed" }
    ]);
    expect([mp4, mkv, silent, malformed, audioOnly, zero].map(snapshot)).toEqual(before);
  });

  it("deduplicates the same canonical path, symlinks, hard links, and byte-identical copies", async () => {
    const fixture = createFixture();
    const original = fixture.media("original.mp4", Buffer.from("identical video bytes"));
    const symlink = join(fixture.directory, "alias.mov");
    const hardLink = join(fixture.directory, "hard-link.mkv");
    const copy = fixture.media("copy.webm", Buffer.from("identical video bytes"));
    symlinkSync(original, symlink);
    linkSync(original, hardLink);
    const before = [original, symlink, hardLink, copy].map(snapshot);

    const first = await fixture.service.importPaths([original]);
    const rest = await fixture.service.importPaths([original, symlink, hardLink, copy]);

    expect(first.imported).toHaveLength(1);
    expect(rest.duplicates).toHaveLength(4);
    expect(new Set(rest.duplicates.map((episode) => episode.id))).toEqual(
      new Set([first.imported[0]!.id])
    );
    expect(fixture.repository.listEpisodes()).toHaveLength(1);
    expect(fixture.repository.getEpisode(first.imported[0]!.id).contentHash).toBe(
      sha256(readFileSync(original))
    );
    expect([original, symlink, hardLink, copy].map(snapshot)).toEqual(before);
  });

  it("uses full hashes when size and sampled regions collide", async () => {
    const fixture = createFixture();
    const firstBytes = Buffer.alloc(256 * 1024, 7);
    const secondBytes = Buffer.from(firstBytes);
    secondBytes[70_000] = 8;
    const firstPath = fixture.media("first.mp4", firstBytes);
    const secondPath = fixture.media("second.mp4", secondBytes);
    const timestamp = new Date("2025-01-02T03:04:05.000Z");
    utimesSync(firstPath, timestamp, timestamp);
    utimesSync(secondPath, timestamp, timestamp);

    expect(await quickFingerprint(firstPath, firstBytes.length)).toBe(
      await quickFingerprint(secondPath, secondBytes.length)
    );
    const result = await fixture.service.importPaths([firstPath, secondPath]);

    expect(result.imported).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
    expect(result.imported.every((episode) => episode.contentHash !== null)).toBe(true);
    expect(new Set(result.imported.map((episode) => episode.contentHash)).size).toBe(2);
  });

  it("serializes concurrent imports by canonical path and content identity", async () => {
    const samePathFixture = createFixture();
    const source = samePathFixture.media("concurrent.mp4");
    const samePath = await Promise.all([
      samePathFixture.service.importPaths([source]),
      samePathFixture.service.importPaths([source]),
      samePathFixture.service.importPaths([source])
    ]);
    expect(samePath.flatMap((result) => result.imported)).toHaveLength(1);
    expect(samePath.flatMap((result) => result.duplicates)).toHaveLength(2);
    expect(samePathFixture.repository.listEpisodes()).toHaveLength(1);

    const sameContentFixture = createFixture();
    const bytes = Buffer.from("same-content-concurrent-video");
    const paths = ["a.mp4", "b.mkv", "c.mov"].map((name) => sameContentFixture.media(name, bytes));
    const sameContent = await Promise.all(paths.map((path) => sameContentFixture.service.importPaths([path])));
    expect(sameContent.flatMap((result) => result.imported)).toHaveLength(1);
    expect(sameContent.flatMap((result) => result.duplicates)).toHaveLength(2);
    expect(sameContentFixture.repository.listEpisodes()).toHaveLength(1);
  });

  it("returns safe dependency errors and rejects files that change during inspection", async () => {
    const missingProbeFixture = createFixture("definitely-missing-ffprobe");
    const unicode = missingProbeFixture.media("节目 🎬.mp4");
    const unavailable = await missingProbeFixture.service.importPaths([unicode]);
    expect(unavailable.rejected).toEqual([{
      path: unicode, code: "DEPENDENCY_UNAVAILABLE", reason: "FFprobe is unavailable"
    }]);

    const fixture = createFixture();
    const changing = fixture.media("changing.mp4", Buffer.from("before"));
    const pending = fixture.service.importPaths([changing]);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    writeFileSync(changing, "changed while probing");
    const result = await pending;
    expect(result.rejected).toEqual([{
      path: changing, code: "VALIDATION_ERROR", reason: "Source changed while it was being inspected"
    }]);
    expect(fixture.repository.listEpisodes()).toHaveLength(0);
  });

  it("accepts read-only sources and queues hashing only when identity did not require it", async () => {
    const fixture = createFixture();
    const unique = fixture.media("read-only.mp4");
    chmodSync(unique, 0o444);
    const jobs = new JobQueue(fixture.repository);
    const core = new CoreService(fixture.repository, fixture.service, jobs);
    const first = await core.importPaths([unique]);

    expect(first.imported).toHaveLength(1);
    expect(first.imported[0]?.contentHash).toBeNull();
    expect(jobs.list().map((job) => job.type)).toEqual(["hash"]);

    const copy = fixture.media("read-only-copy.mkv", readFileSync(unique));
    const second = await core.importPaths([copy]);
    expect(second.duplicates).toHaveLength(1);
    expect(jobs.list()).toHaveLength(1);
  });
});

describe("asset inspection", () => {
  it("imports supported still, video, and audio codecs with complete metadata in place", async () => {
    const fixture = createFixture();
    const core = new CoreService(
      fixture.repository,
      fixture.service,
      new JobQueue(fixture.repository)
    );
    const sources = [
      fixture.media("asset-png.dat"),
      fixture.media("asset-jpeg.dat"),
      fixture.media("asset-webp.dat"),
      fixture.media("asset-h264.dat"),
      fixture.media("asset-aac.dat"),
      fixture.media("asset-mp3.dat"),
      fixture.media("asset-pcm.dat")
    ];
    const before = sources.map(snapshot);
    const assets = [];
    for (const source of sources) {
      assets.push(await core.importAsset(source, "  licensed by publisher  ", false));
    }

    expect(assets.map((asset) => asset.kind)).toEqual([
      "image", "image", "image", "video", "audio", "audio", "audio"
    ]);
    expect(assets.slice(0, 3).every((asset) =>
      asset.width === 1200 && asset.height === 800 && asset.durationMs === null
    )).toBe(true);
    expect(assets[3]).toMatchObject({
      width: 1920, height: 1080, durationMs: 12_500, reusable: false,
      provenance: "licensed by publisher"
    });
    expect(assets.slice(4).every((asset) =>
      asset.width === null && asset.height === null && asset.durationMs === 12_500
    )).toBe(true);
    expect(fixture.repository.listAssets()).toEqual(assets);
    expect(sources.map(snapshot)).toEqual(before);
  });

  it("returns typed failures for invalid, unstable, unsupported, and dependency-blocked assets", async () => {
    const fixture = createFixture();
    const core = new CoreService(
      fixture.repository,
      fixture.service,
      new JobQueue(fixture.repository)
    );
    await expect(core.importAsset(
      fixture.media("asset-streamless.dat"), "licensed", true
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(core.importAsset(
      fixture.media("asset-vp9.dat"), "licensed", true
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(core.importAsset(
      fixture.media("asset-flac.dat"), "licensed", true
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(core.importAsset(
      fixture.media("malformed.bin"), "licensed", true
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(core.importAsset(
      fixture.media("empty-asset.dat", Buffer.alloc(0)), "licensed", true
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(core.importAsset(
      join(fixture.directory, "missing-asset.dat"), "licensed", true
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(core.importAsset(
      fixture.media("asset-png.dat"), "   ", true
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const changing = fixture.media("changing-asset.dat", Buffer.from("before"));
    const pending = core.importAsset(changing, "licensed", true);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    writeFileSync(changing, "changed while probing");
    await expect(pending).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const unavailableFixture = createFixture("definitely-missing-ffprobe");
    const unavailableCore = new CoreService(
      unavailableFixture.repository,
      unavailableFixture.service,
      new JobQueue(unavailableFixture.repository)
    );
    await expect(unavailableCore.importAsset(
      unavailableFixture.media("asset.png"), "licensed", true
    )).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});

function createFixture(ffprobePath?: string) {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-test-"));
  const probe = ffprobePath ?? createFakeProbe(directory);
  const repository = new Repository(openDatabase(":memory:"));
  databases.push(repository.db);
  return {
    directory,
    repository,
    service: new MediaService(repository, probe),
    media(name: string, bytes: Buffer = Buffer.from(`video fixture: ${name}`)) {
      const path = join(directory, name);
      writeFileSync(path, bytes);
      return path;
    }
  };
}

function createFakeProbe(directory: string) {
  const path = join(directory, "fake-ffprobe.mjs");
  writeFileSync(path, `#!/usr/bin/env node
import { basename } from "node:path";
const file = process.argv.at(-1);
const name = basename(file);
if (name === "changing.mp4") await new Promise((resolve) => setTimeout(resolve, 100));
if (name === "changing-asset.dat") await new Promise((resolve) => setTimeout(resolve, 100));
if (name === "malformed.bin") {
  process.stderr.write("private diagnostic mentioning /do/not/expose/secret.mov");
  process.exit(1);
}
const assetCodec = {
  "asset-png.dat": "png",
  "asset-jpeg.dat": "mjpeg",
  "asset-webp.dat": "webp",
  "asset-vp9.dat": "vp9"
}[name];
const audioCodec = {
  "asset-aac.dat": "aac",
  "asset-mp3.dat": "mp3",
  "asset-pcm.dat": "pcm_s16le",
  "asset-flac.dat": "flac"
}[name];
const streams = name === "asset-streamless.dat"
  ? []
  : assetCodec
    ? [{ codec_type: "video", codec_name: assetCodec, width: 1200, height: 800 }]
    : audioCodec || name === "audio-only.m4a"
      ? [{ codec_type: "audio", codec_name: audioCodec ?? "aac", duration: "12.5" }]
      : [{
      codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: "12.5"
    }, ...(name === "silent-video.mov" ? [] : [{ codec_type: "audio", codec_name: "aac" }])];
process.stdout.write(JSON.stringify({ format: { duration: "12.5" }, streams }));
`);
  chmodSync(path, 0o755);
  return { command: process.execPath, args: [path] };
}

function snapshot(path: string) {
  const stats = statSync(path);
  const bytes = readFileSync(path);
  return {
    bytes: bytes.toString("hex"), hash: sha256(bytes), size: stats.size,
    mtimeMs: stats.mtimeMs, mode: stats.mode
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
