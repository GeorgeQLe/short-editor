import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { sha256 } from "../src/core/artifact-store";
import { databaseMigrations, migrateDatabase, openDatabase } from "../src/core/database";
import { Repository } from "../src/core/repository";
import { isPopulated, prepareDataDirectory } from "../src/core/startup";
import { AppError } from "../src/shared/errors";

const roots: string[] = [];
const makePaths = () => {
  const root = mkdtempSync(join(tmpdir(), "short-editor-startup-"));
  roots.push(root);
  return { root, native: join(root, "native"), legacy: join(root, "legacy") };
};
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("startup data reconciliation", () => {
  it("does not treat empty layout directories or log files as populated", () => {
    const { native } = makePaths();
    mkdirSync(join(native, "artifacts"), { recursive: true });
    mkdirSync(join(native, "logs"), { recursive: true });
    writeFileSync(join(native, "logs", "startup.log"), "diagnostic");
    expect(isPopulated(native)).toBe(false);
  });

  it("initializes native storage when neither path is populated", () => {
    const { native, legacy } = makePaths();
    mkdirSync(join(legacy, "artifacts"), { recursive: true });
    const result = prepareDataDirectory(native, legacy);
    expect(result.state).toBe("initialized");
    expect(existsSync(join(native, "artifacts"))).toBe(true);
    expect(existsSync(join(native, "logs"))).toBe(true);
  });

  it("uses a populated native path without changing a legacy empty directory", () => {
    const { native, legacy } = makePaths();
    const db = openDatabase(join(native, "short-editor.db"));
    db.close();
    mkdirSync(legacy);
    const result = prepareDataDirectory(native, legacy);
    expect(result).toMatchObject({ state: "native", dataDirectory: native });
    expect(readdirSync(legacy)).toEqual([]);
  });

  it("refuses to open or write either location when both are populated", () => {
    const { native, legacy } = makePaths();
    mkdirSync(join(native, "artifacts"), { recursive: true });
    mkdirSync(join(legacy, "artifacts"), { recursive: true });
    writeFileSync(join(native, "artifacts", "native.bin"), "native");
    writeFileSync(join(legacy, "artifacts", "legacy.bin"), "legacy");

    expect(() => prepareDataDirectory(native, legacy)).toThrowError(AppError);
    expect(readFileSync(join(native, "artifacts", "native.bin"), "utf8")).toBe("native");
    expect(readFileSync(join(legacy, "artifacts", "legacy.bin"), "utf8")).toBe("legacy");
    expect(readdirSync(native)).toEqual(["artifacts"]);
    expect(readdirSync(legacy)).toEqual(["artifacts"]);
  });

  it("checkpoints, copies, verifies, promotes, and backs up legacy data", () => {
    const { native, legacy } = makePaths();
    const artifactId = randomUUID();
    const bytes = Buffer.from("accepted render bytes");
    const legacyRelativePath = `renders/${randomUUID()}/final.mp4`;
    const relativePath = `artifacts/${legacyRelativePath}`;
    mkdirSync(join(legacy, ...relativePath.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(legacy, relativePath), bytes);
    mkdirSync(join(legacy, "logs"));
    writeFileSync(join(legacy, "logs", "core.log"), "safe log");
    const db = new Database(join(legacy, "short-editor.db"));
    migrateDatabase(db, databaseMigrations.slice(0, 3));
    db.prepare(`
      INSERT INTO artifact_records(
        id,kind,owner_type,owner_id,owner_revision,relative_path,content_hash,
        byte_length,producer_version,state,created_at
      ) VALUES(?, 'render', 'render', ?, 1, ?, ?, ?, 'legacy-v1', 'complete', ?)
    `).run(
      artifactId,
      randomUUID(),
      legacyRelativePath,
      sha256(bytes),
      bytes.byteLength,
      new Date().toISOString()
    );
    db.close();

    const result = prepareDataDirectory(native, legacy);

    expect(result.state).toBe("migrated");
    expect(existsSync(legacy)).toBe(false);
    expect(result.backupDirectory && existsSync(result.backupDirectory)).toBe(true);
    expect(readFileSync(join(native, relativePath))).toEqual(bytes);
    expect(readFileSync(join(native, "logs", "core.log"), "utf8")).toBe("safe log");
    const migrated = openDatabase(join(native, "short-editor.db"));
    expect(new Repository(migrated).listArtifactRecords()[0]).toMatchObject({
      id: artifactId,
      relativePath
    });
    migrated.close();
  });

  it("quarantines failed staging and leaves corrupt legacy data authoritative", () => {
    const { root, native, legacy } = makePaths();
    const relativePath = `artifacts/renders/${randomUUID()}/final.mp4`;
    mkdirSync(join(legacy, ...relativePath.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(legacy, relativePath), "corrupt");
    const db = openDatabase(join(legacy, "short-editor.db"));
    new Repository(db).saveArtifactRecord({
      id: randomUUID(),
      kind: "render",
      ownerType: "render",
      ownerId: randomUUID(),
      ownerRevision: 1,
      relativePath,
      contentHash: sha256(Buffer.from("expected")),
      byteLength: 8,
      producerVersion: "legacy-v1",
      state: "complete",
      createdAt: new Date().toISOString()
    });
    db.close();

    expect(() => prepareDataDirectory(native, legacy)).toThrowError(AppError);
    expect(existsSync(join(legacy, "short-editor.db"))).toBe(true);
    expect(readFileSync(join(legacy, relativePath), "utf8")).toBe("corrupt");
    expect(readdirSync(root).some((entry) => entry.startsWith("native.quarantine-"))).toBe(true);
    expect(existsSync(native)).toBe(false);
  });
});
