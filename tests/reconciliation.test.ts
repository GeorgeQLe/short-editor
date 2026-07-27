import { chmodSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { MediaService } from "../src/core/media";
import { Repository } from "../src/core/repository";
import { WatchedFolderCoordinator } from "../src/core/watched-folders";
import { AppError } from "../src/shared/errors";
import { createApi } from "../src/core/api";
import { CoreService } from "../src/core/service";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.open && db.close()));

describe("watched-folder reconciliation", () => {
  it("discovers matching media with recursive root-relative globs and deduplicates scans", async () => {
    const fixture = createFixture();
    const nested = join(fixture.directory, "nested");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(nested);
    writeFileSync(join(fixture.directory, "top.MP4"), "top");
    writeFileSync(join(nested, "inside.mov"), "inside");
    writeFileSync(join(nested, "ignored.txt"), "ignored");

    const configured = await fixture.coordinator.configure({
      action: "create",
      path: fixture.directory,
      recursive: true,
      includePatterns: ["**/*.{mp4,mov}"]
    });
    if (!("canonicalPath" in configured)) throw new Error("expected watched folder");
    const first = fixture.coordinator.requestScan(configured.id, "manual");
    const duplicate = fixture.coordinator.requestScan(configured.id, "event");
    expect(duplicate.id).toBe(first.id);

    const claimed = fixture.jobs.claimNext();
    expect(claimed?.job.id).toBe(first.id);
    await fixture.coordinator.scan(claimed!.job, claimed!.payload);
    fixture.jobs.complete(first.id);

    expect(fixture.repository.listEpisodes().map((episode) => episode.sourcePath).sort())
      .toEqual([
        join(configured.canonicalPath, "top.MP4"),
        join(configured.canonicalPath, "nested", "inside.mov")
      ].sort());
    expect(fixture.repository.getWatchedFolder(configured.id).lastScanStatus).toBe("succeeded");
  });

  it("captures a safe restore state and restores an Episode when the same source returns", async () => {
    const fixture = createFixture();
    const original = fixture.media("offline.mp4");
    const imported = await fixture.mediaService.importPaths([original]);
    const episode = imported.imported[0]!;
    fixture.repository.updateEpisodeStatus(episode.id, "analyzing");
    const moved = join(fixture.directory, "temporarily-offline.mp4");
    renameSync(original, moved);

    await fixture.coordinator.reconcile(runningJob(fixture.jobs, "source_reconcile"));
    expect(fixture.repository.getEpisode(episode.id)).toMatchObject({
      status: "source_missing",
      missing: true,
      relinkRestoreStatus: "indexing"
    });

    renameSync(moved, original);
    await fixture.coordinator.reconcile(runningJob(fixture.jobs, "source_reconcile"));
    expect(fixture.repository.getEpisode(episode.id)).toMatchObject({
      status: "indexing",
      missing: false,
      relinkRestoreStatus: null
    });
  });

  it("automatically repairs a watched rename only after full-hash verification", async () => {
    const fixture = createFixture();
    const original = fixture.media("before.mp4", Buffer.from("rename-safe bytes"));
    const episode = (await fixture.mediaService.importPaths([original])).imported[0]!;
    await fixture.mediaService.hashEpisode(episode.id);
    const configured = await fixture.coordinator.configure({
      action: "create",
      path: fixture.directory
    });
    if (!("canonicalPath" in configured)) throw new Error("expected watched folder");
    const moved = join(configured.canonicalPath, "after.mov");
    renameSync(original, moved);

    const scan = fixture.coordinator.requestScan(configured.id, "event");
    const claimed = fixture.jobs.claimNext()!;
    await fixture.coordinator.scan(claimed.job, claimed.payload);
    fixture.jobs.complete(scan.id);

    expect(fixture.repository.listEpisodes()).toHaveLength(1);
    expect(fixture.repository.getEpisode(episode.id)).toMatchObject({
      sourcePath: moved,
      missing: false,
      status: "indexing"
    });
  });
});

describe("safe source relinking", () => {
  it("atomically relinks a full-hash match and rejects different bytes", async () => {
    const fixture = createFixture();
    const original = fixture.media("original.mp4", Buffer.from("verified source bytes"));
    const episode = (await fixture.mediaService.importPaths([original])).imported[0]!;
    await fixture.mediaService.hashEpisode(episode.id);
    const moved = join(fixture.directory, "moved.mkv");
    renameSync(original, moved);
    fixture.repository.markEpisodeSourceMissing(episode.id);

    const wrong = fixture.media("wrong.mp4", Buffer.from("different source bytes"));
    await expect(fixture.mediaService.relinkSource(episode.id, wrong)).rejects.toMatchObject({
      code: "SOURCE_IDENTITY_MISMATCH"
    } satisfies Partial<AppError>);
    expect(fixture.repository.getEpisode(episode.id).sourcePath).toBe(original);

    const result = await fixture.mediaService.relinkSource(episode.id, moved);
    expect(result.status).toBe("relinked");
    expect(fixture.repository.getEpisode(episode.id)).toMatchObject({
      sourcePath: moved,
      status: "indexing",
      missing: false,
      relinkRestoreStatus: null
    });
  });

  it("requires and consumes a one-time confirmation for a no-hash source", async () => {
    const fixture = createFixture();
    const original = fixture.media("original.mp4", Buffer.from("unhashed source bytes"));
    const episode = (await fixture.mediaService.importPaths([original])).imported[0]!;
    const moved = join(fixture.directory, "candidate.mov");
    renameSync(original, moved);
    fixture.repository.markEpisodeSourceMissing(episode.id);

    const prepared = await fixture.mediaService.relinkSource(episode.id, moved);
    expect(prepared.status).toBe("confirmation_required");
    if (prepared.status !== "confirmation_required") throw new Error("expected confirmation");
    const confirmed = await fixture.mediaService.confirmRelink(
      episode.id, prepared.confirmationToken
    );
    expect(confirmed.episode.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(confirmed.episode.status).toBe("indexing");
    await expect(fixture.mediaService.confirmRelink(
      episode.id, prepared.confirmationToken
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("watched-folder HTTP contract", () => {
  it("returns a durable Job for a typed manual rescan", async () => {
    const fixture = createFixture();
    const service = new CoreService(
      fixture.repository,
      fixture.mediaService,
      fixture.jobs,
      undefined,
      fixture.coordinator
    );
    const server = createApi(service).listen(0, "127.0.0.1");
    await new Promise<void>((resolvePromise) => server.once("listening", resolvePromise));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("expected TCP address");
      const base = `http://127.0.0.1:${address.port}/v1`;
      const created = await fetch(`${base}/library/watched-folders/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", path: fixture.directory })
      }).then((response) => response.json()) as {
        data: { id: string };
      };
      const rescanned = await fetch(`${base}/library/watched-folders/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rescan", folderId: created.data.id })
      }).then((response) => response.json()) as {
        data: { id: string; type: string; state: string };
      };
      expect(rescanned.data).toMatchObject({
        type: "watched_folder_scan",
        state: "queued"
      });
      expect(fixture.jobs.list().some((job) => job.id === rescanned.data.id)).toBe(true);
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => error ? reject(error) : resolvePromise())
      );
    }
  });
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-reconcile-"));
  const repository = new Repository(openDatabase(":memory:"));
  databases.push(repository.db);
  const jobs = new JobQueue(repository);
  const mediaService = new MediaService(repository, createFakeProbe(directory));
  return {
    directory,
    repository,
    jobs,
    mediaService,
    coordinator: new WatchedFolderCoordinator(repository, mediaService, jobs),
    media(name: string, bytes: Buffer = Buffer.from(`video fixture: ${name}`)) {
      const path = join(directory, name);
      writeFileSync(path, bytes);
      return path;
    }
  };
}

function createFakeProbe(directory: string): string {
  const path = join(directory, "fake-ffprobe.mjs");
  writeFileSync(path, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  format: { duration: "12.5" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
    { codec_type: "audio", codec_name: "aac" }
  ]
}));
`);
  chmodSync(path, 0o755);
  return path;
}

function runningJob(jobs: JobQueue, type: "source_reconcile") {
  jobs.enqueue({ type, payload: { apiVersion: "v1", type, reason: "periodic" } });
  return jobs.claimNext()!.job;
}
