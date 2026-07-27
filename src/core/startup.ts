import Database from "better-sqlite3";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AppError } from "../shared/errors.js";
import { openDatabase } from "./database.js";
import { sha256 } from "./artifact-store.js";

export type StartupDataResult =
  | { state: "initialized" | "native"; dataDirectory: string; backupDirectory: null }
  | { state: "migrated"; dataDirectory: string; backupDirectory: string };

export function prepareDataDirectory(
  nativeDirectory: string,
  legacyDirectory: string
): StartupDataResult {
  const native = resolve(nativeDirectory);
  const legacy = resolve(legacyDirectory);
  if (native === legacy) {
    ensureLayout(native);
    return {
      state: isPopulated(native) ? "native" : "initialized",
      dataDirectory: native,
      backupDirectory: null
    };
  }

  const nativePopulated = isPopulated(native);
  const legacyPopulated = isPopulated(legacy);
  if (nativePopulated && legacyPopulated) {
    throw new AppError(
      "INVALID_STATE",
      "Both the native and legacy data locations contain Short Editor data. Neither was opened; move one aside and restart.",
      409,
      { nativeDirectory: native, legacyDirectory: legacy }
    );
  }
  if (nativePopulated) {
    ensureLayout(native);
    return { state: "native", dataDirectory: native, backupDirectory: null };
  }
  if (!legacyPopulated) {
    ensureLayout(native);
    return { state: "initialized", dataDirectory: native, backupDirectory: null };
  }
  return migrateLegacyDirectory(legacy, native);
}

export function isPopulated(directory: string): boolean {
  if (!existsSync(directory)) return false;
  if (existsSync(join(directory, "short-editor.db"))) return true;
  return containsFile(join(directory, "artifacts"));
}

export function ensureLayout(directory: string): void {
  mkdirSync(join(directory, "artifacts"), { recursive: true });
  mkdirSync(join(directory, "logs"), { recursive: true });
}

function migrateLegacyDirectory(legacy: string, native: string): StartupDataResult {
  const stamp = timestamp();
  const staging = `${native}.staging-${stamp}`;
  const quarantine = `${native}.quarantine-${stamp}`;
  const backup = `${legacy}.migration-backup-${stamp}`;
  let priorNativeBackup: string | null = null;
  mkdirSync(dirname(native), { recursive: true });
  if (existsSync(staging)) {
    throw new AppError("INVALID_STATE", "A startup migration staging path already exists", 409);
  }
  try {
    mkdirSync(staging);
    checkpointLegacyDatabase(legacy);
    copyTreeIfPresent(join(legacy, "artifacts"), join(staging, "artifacts"));
    copyTreeIfPresent(join(legacy, "logs"), join(staging, "logs"));
    const legacyDatabase = join(legacy, "short-editor.db");
    if (existsSync(legacyDatabase)) cpSync(legacyDatabase, join(staging, "short-editor.db"));
    ensureLayout(staging);
    verifyStaging(staging);

    if (existsSync(native)) {
      if (containsAnyEntry(native)) {
        priorNativeBackup = uniquePath(`${native}.pre-migration-backup-${stamp}`);
        renameSync(native, priorNativeBackup);
      } else {
        rmEmptyTree(native);
      }
    }
    renameSync(staging, native);
    try {
      renameSync(legacy, backup);
    } catch (error) {
      renameSync(native, staging);
      if (priorNativeBackup) renameSync(priorNativeBackup, native);
      throw error;
    }
    return { state: "migrated", dataDirectory: native, backupDirectory: backup };
  } catch (error) {
    if (priorNativeBackup && existsSync(priorNativeBackup) && !existsSync(native)) {
      renameSync(priorNativeBackup, native);
    }
    if (existsSync(staging)) renameSync(staging, uniquePath(quarantine));
    if (error instanceof AppError) throw error;
    throw new AppError(
      "ARTIFACT_CORRUPT",
      "Legacy data migration could not be verified; legacy data remains authoritative",
      422
    );
  }
}

function checkpointLegacyDatabase(directory: string): void {
  const path = join(directory, "short-editor.db");
  if (!existsSync(path)) return;
  const db = new Database(path);
  try {
    const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new AppError("ARTIFACT_CORRUPT", "The legacy database failed its integrity check", 422);
    }
    const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)") as {
      busy: number;
      log: number;
      checkpointed: number;
    }[];
    if (checkpoint[0]?.busy) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "The legacy database is busy; close other Short Editor processes and retry",
        503
      );
    }
  } finally {
    db.close();
  }
}

function verifyStaging(directory: string): void {
  const path = join(directory, "short-editor.db");
  if (!existsSync(path)) return;
  const db = openDatabase(path);
  try {
    const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new AppError("ARTIFACT_CORRUPT", "The migrated database failed its integrity check", 422);
    }
    const hasArtifacts = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifact_records'"
    ).get();
    if (!hasArtifacts) return;
    const records = db.prepare(`
      SELECT relative_path,content_hash,byte_length FROM artifact_records WHERE state='complete'
    `).all() as { relative_path: string; content_hash: string; byte_length: number }[];
    for (const record of records) {
      const portable = record.relative_path.replaceAll("\\", "/");
      if (
        !portable.startsWith("artifacts/") ||
        portable.split("/").some((part) => part === ".." || part === "." || !part)
      ) {
        throw new AppError("ARTIFACT_CORRUPT", "Migrated artifact metadata contains an unsafe path", 422);
      }
      const artifactPath = join(directory, ...portable.split("/"));
      if (!existsSync(artifactPath)) {
        throw new AppError("ARTIFACT_CORRUPT", "A migrated artifact is missing", 422);
      }
      const bytes = readFileSync(artifactPath);
      if (bytes.byteLength !== record.byte_length || sha256(bytes) !== record.content_hash) {
        throw new AppError("ARTIFACT_CORRUPT", "A migrated artifact failed hash verification", 422);
      }
    }
  } finally {
    db.close();
  }
}

function copyTreeIfPresent(source: string, destination: string): void {
  if (!existsSync(source)) return;
  rejectSymbolicLinks(source);
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
}

function rejectSymbolicLinks(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new AppError("ARTIFACT_CORRUPT", "Legacy application data contains a symbolic link", 422);
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) rejectSymbolicLinks(join(path, entry));
}

function containsFile(path: string): boolean {
  if (!existsSync(path)) return false;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return true;
    if (entry.isFile()) return true;
    if (entry.isDirectory() && containsFile(join(path, entry.name))) return true;
  }
  return false;
}

function rmEmptyTree(path: string): void {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) rmEmptyTree(child);
    else throw new AppError("INVALID_STATE", "Native data location changed during migration", 409);
  }
  rmSync(path, { recursive: false });
}

function containsAnyEntry(path: string): boolean {
  if (!existsSync(path)) return false;
  return readdirSync(path).length > 0;
}

function uniquePath(path: string): string {
  let candidate = path;
  let counter = 1;
  while (existsSync(candidate)) candidate = `${path}-${counter++}`;
  return candidate;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
