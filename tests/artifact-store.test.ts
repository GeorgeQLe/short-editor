import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore, sha256 } from "../src/core/artifact-store";
import { openDatabase } from "../src/core/database";
import { Repository } from "../src/core/repository";
import { AppError } from "../src/shared/errors";

const directories: string[] = [];
const databases: ReturnType<typeof openDatabase>[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "short-editor-artifacts-"));
  directories.push(directory);
  const db = openDatabase(join(directory, "short-editor.db"));
  databases.push(db);
  const repository = new Repository(db);
  return { directory, repository, store: new ArtifactStore(directory, repository) };
}

afterEach(() => {
  databases.splice(0).forEach((db) => db.open && db.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("artifact store", () => {
  it("validates, syncs, hashes, and atomically finalizes an owned artifact", () => {
    const { directory, repository, store } = setup();
    const relativePath = `artifacts/episodes/${randomUUID()}/captions.vtt`;
    const finalPath = join(directory, relativePath);
    const bytes = Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n");
    let temporaryPath = "";

    const artifact = store.finalize({
      kind: "captions",
      ownerType: "episode",
      ownerId: randomUUID(),
      ownerRevision: 2,
      relativePath,
      producerVersion: "test-v1",
      bytes,
      validate: (path) => {
        temporaryPath = path;
        expect(path.endsWith(".tmp")).toBe(true);
        expect(existsSync(path)).toBe(true);
        expect(existsSync(finalPath)).toBe(false);
      }
    });

    expect(existsSync(temporaryPath)).toBe(false);
    expect(readFileSync(finalPath)).toEqual(bytes);
    expect(artifact).toMatchObject({
      relativePath,
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength,
      state: "complete"
    });
    expect(repository.listArtifactRecords()).toEqual([artifact]);
  });

  it("does not overwrite collisions or retain a failed validation temporary file", () => {
    const { directory, store } = setup();
    const relativePath = `artifacts/renders/${randomUUID()}/final.mp4`;
    const finalPath = join(directory, relativePath);
    store.finalize({
      kind: "render",
      ownerType: "render",
      ownerId: randomUUID(),
      relativePath,
      producerVersion: "test-v1",
      bytes: Buffer.from("first")
    });
    expect(() => store.finalize({
      kind: "render",
      ownerType: "render",
      ownerId: randomUUID(),
      relativePath,
      producerVersion: "test-v1",
      bytes: Buffer.from("second")
    })).toThrowError(AppError);
    expect(readFileSync(finalPath, "utf8")).toBe("first");

    const failedRelativePath = `artifacts/renders/${randomUUID()}/failed.mp4`;
    expect(() => store.finalize({
      kind: "render",
      ownerType: "render",
      ownerId: randomUUID(),
      relativePath: failedRelativePath,
      producerVersion: "test-v1",
      bytes: Buffer.from("partial"),
      validate: () => {
        throw new Error("injected validation failure");
      }
    })).toThrowError(AppError);
    expect(existsSync(join(directory, failedRelativePath))).toBe(false);
    expect(readdirSync(join(directory, "artifacts", "renders"), { recursive: true })
      .some((entry) => String(entry).endsWith(".tmp"))).toBe(false);
  });

  it("leaves no visible or temporary artifact after an injected disk-full failure", () => {
    const { directory, store } = setup();
    const relativePath = `artifacts/renders/${randomUUID()}/disk-full.mp4`;
    expect(() => store.finalize({
      kind: "render",
      ownerType: "render",
      ownerId: randomUUID(),
      relativePath,
      producerVersion: "test-v1",
      bytes: Buffer.from("partial"),
      validate: () => {
        throw Object.assign(new Error("injected filesystem failure"), { code: "ENOSPC" });
      }
    })).toThrowError(new AppError("INTERNAL_ERROR", "Artifact creation failed"));
    expect(existsSync(join(directory, relativePath))).toBe(false);
    expect(readdirSync(join(directory, "artifacts"), { recursive: true })
      .some((entry) => String(entry).endsWith(".tmp"))).toBe(false);
  });

  it.each([
    "../source.mp4",
    "artifacts/../source.mp4",
    "/absolute/output.mp4",
    "C:\\outside\\output.mp4",
    "episodes/id/output.mp4",
    "artifacts\\..\\outside.mp4"
  ])("rejects a path outside the owned artifact root: %s", (relativePath) => {
    const { store } = setup();
    expect(() => store.resolveOwnedPath(relativePath)).toThrowError(AppError);
  });

  it("rejects a symbolic-link escape below the artifact root", () => {
    const { directory, store } = setup();
    const outside = mkdtempSync(join(tmpdir(), "short-editor-outside-"));
    directories.push(outside);
    symlinkSync(outside, join(directory, "artifacts", "episodes"));
    expect(() => store.finalize({
      kind: "captions",
      ownerType: "episode",
      ownerId: randomUUID(),
      relativePath: "artifacts/episodes/escape.vtt",
      producerVersion: "test-v1",
      bytes: Buffer.from("must stay contained")
    })).toThrowError(AppError);
    expect(existsSync(join(outside, "escape.vtt"))).toBe(false);
  });

  it("quarantines temporary files and marks missing or hash-mismatched records corrupt", () => {
    const { directory, repository, store } = setup();
    const missingId = randomUUID();
    const corruptId = randomUUID();
    const temporaryId = randomUUID();
    const now = new Date().toISOString();
    const corruptPath = `artifacts/renders/${randomUUID()}/final.mp4`;
    const tempPath = join(directory, "artifacts", "episodes", randomUUID(), "work.bin.tmp");
    const orphanPath = join(directory, "artifacts", "episodes", randomUUID(), "orphan.bin");
    const goodBytes = Buffer.from("expected");
    const base = {
      kind: "render",
      ownerType: "render",
      ownerId: randomUUID(),
      ownerRevision: 1,
      contentHash: sha256(goodBytes),
      byteLength: goodBytes.byteLength,
      producerVersion: "test-v1",
      state: "complete" as const,
      createdAt: now
    };
    repository.saveArtifactRecord({
      ...base, id: missingId, relativePath: `artifacts/renders/${randomUUID()}/missing.mp4`
    });
    repository.saveArtifactRecord({ ...base, id: corruptId, relativePath: corruptPath });
    repository.saveArtifactRecord({
      ...base,
      id: temporaryId,
      relativePath: `artifacts/renders/${randomUUID()}/temporary.mp4`,
      state: "temporary"
    });
    mkdirSync(join(directory, corruptPath, ".."), { recursive: true });
    mkdirSync(join(tempPath, ".."), { recursive: true });
    mkdirSync(join(orphanPath, ".."), { recursive: true });
    writeFileSync(join(directory, corruptPath), "changed", { flag: "wx" });
    writeFileSync(tempPath, "partial", { flag: "wx" });
    writeFileSync(orphanPath, "renamed before metadata commit", { flag: "wx" });

    const result = store.reconcile();

    expect(result.corruptArtifactIds).toEqual([missingId, corruptId, temporaryId]);
    expect(result.quarantinedTemporaryFiles).toHaveLength(1);
    expect(result.quarantinedArtifactFiles).toHaveLength(2);
    expect(existsSync(tempPath)).toBe(false);
    expect(existsSync(orphanPath)).toBe(false);
    expect(existsSync(join(directory, corruptPath))).toBe(false);
    expect(existsSync(join(directory, result.quarantinedTemporaryFiles[0]!))).toBe(true);
    expect(repository.listArtifactRecords().map(({ id, state }) => ({ id, state }))).toEqual([
      { id: missingId, state: "corrupt" },
      { id: corruptId, state: "corrupt" },
      { id: temporaryId, state: "corrupt" }
    ]);
  });
});
