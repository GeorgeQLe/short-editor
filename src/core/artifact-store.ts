import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { AppError } from "../shared/errors.js";
import type { Repository, StoredArtifact } from "./repository.js";
import { validateOwnedRelativePath } from "./artifact-path.js";

export interface ArtifactWrite {
  kind: string;
  ownerType: "episode" | "short" | "render" | "asset";
  ownerId: string;
  ownerRevision?: number | null;
  relativePath: string;
  producerVersion: string;
  bytes: Uint8Array;
  validate?: (temporaryPath: string) => void;
}

export interface ArtifactReconciliation {
  quarantinedTemporaryFiles: string[];
  quarantinedArtifactFiles: string[];
  corruptArtifactIds: string[];
}

export interface ExternalArtifactReservation {
  readonly write: Omit<ArtifactWrite, "bytes" | "validate">;
  readonly finalPath: string;
  readonly temporaryPath: string;
}

export class ArtifactStore {
  readonly artifactsDirectory: string;
  readonly logsDirectory: string;
  readonly quarantineDirectory: string;
  private readonly pendingPaths = new Set<string>();

  constructor(
    readonly dataDirectory: string,
    private readonly repository: Repository
  ) {
    this.artifactsDirectory = join(dataDirectory, "artifacts");
    this.logsDirectory = join(dataDirectory, "logs");
    this.quarantineDirectory = join(dataDirectory, "quarantine");
    mkdirSync(this.artifactsDirectory, { recursive: true });
    mkdirSync(this.logsDirectory, { recursive: true });
  }

  resolveOwnedPath(relativePath: string): string {
    const normalized = validateOwnedRelativePath(relativePath);
    const absolute = resolve(this.dataDirectory, normalized);
    const root = resolve(this.artifactsDirectory);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Owned artifacts must be stored below the artifacts directory",
        422
      );
    }
    assertNoSymbolicLinkComponents(root, absolute);
    return absolute;
  }

  finalize(write: ArtifactWrite): StoredArtifact {
    return this.finalizeBatch([write], (artifacts) => artifacts[0]!).value;
  }

  reserveExternal(
    write: Omit<ArtifactWrite, "bytes" | "validate">
  ): ExternalArtifactReservation {
    const finalPath = this.resolveOwnedPath(write.relativePath);
    if (existsSync(finalPath) || this.pendingPaths.has(finalPath)) {
      throw new AppError("INVALID_STATE", "An artifact already exists at that path", 409);
    }
    this.pendingPaths.add(finalPath);
    try {
      mkdirSync(dirname(finalPath), { recursive: true });
      const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
      const descriptor = openSync(temporaryPath, "wx");
      closeSync(descriptor);
      return { write, finalPath, temporaryPath };
    } catch (error) {
      this.pendingPaths.delete(finalPath);
      throw normalizeArtifactError(error, "Artifact staging failed");
    }
  }

  async finalizeExternal(
    reservation: ExternalArtifactReservation,
    validate: (temporaryPath: string) => void | Promise<void>,
    cancelled: () => boolean = () => false
  ): Promise<StoredArtifact> {
    const { write, finalPath, temporaryPath } = reservation;
    try {
      await validate(temporaryPath);
      const descriptor = openSync(temporaryPath, "r");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      throwIfArtifactCancelled(cancelled);
      const [contentHash, file] = await Promise.all([
        hashFile(temporaryPath, cancelled),
        stat(temporaryPath)
      ]);
      throwIfArtifactCancelled(cancelled);
      const artifact: StoredArtifact = {
        id: randomUUID(),
        kind: write.kind,
        ownerType: write.ownerType,
        ownerId: write.ownerId,
        ownerRevision: write.ownerRevision ?? null,
        relativePath: validateOwnedRelativePath(write.relativePath),
        contentHash,
        byteLength: file.size,
        producerVersion: write.producerVersion,
        state: "complete",
        createdAt: new Date().toISOString()
      };
      await renameExternalArtifact(temporaryPath, finalPath, cancelled);
      syncDirectory(dirname(finalPath));
      try {
        this.repository.saveArtifactRecord(artifact);
      } catch (error) {
        if (existsSync(finalPath)) unlinkSync(finalPath);
        syncDirectory(dirname(finalPath));
        throw error;
      }
      return artifact;
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      throw normalizeArtifactError(error, "Artifact finalization failed");
    } finally {
      this.pendingPaths.delete(finalPath);
    }
  }

  discardExternal(reservation: ExternalArtifactReservation): void {
    if (existsSync(reservation.temporaryPath)) unlinkSync(reservation.temporaryPath);
    this.pendingPaths.delete(reservation.finalPath);
  }

  discardFinalized(artifact: StoredArtifact): void {
    const path = this.resolveOwnedPath(artifact.relativePath);
    this.repository.transaction(() => {
      this.repository.deleteArtifactRecord(artifact.id);
      if (existsSync(path)) {
        unlinkSync(path);
        syncDirectory(dirname(path));
      }
    });
  }

  finalizeBatch<T>(
    writes: readonly ArtifactWrite[],
    commit: (artifacts: StoredArtifact[]) => T
  ): { artifacts: StoredArtifact[]; value: T } {
    if (!writes.length) {
      throw new AppError("VALIDATION_ERROR", "Artifact batch must not be empty", 422);
    }
    const staged = writes.map((write) => ({
      write,
      finalPath: this.resolveOwnedPath(write.relativePath),
      temporaryPath: "",
      renamed: false
    }));
    if (new Set(staged.map(({ finalPath }) => finalPath)).size !== staged.length) {
      throw new AppError("VALIDATION_ERROR", "Artifact batch paths must be unique", 422);
    }
    for (const item of staged) {
      if (existsSync(item.finalPath) || this.pendingPaths.has(item.finalPath)) {
        throw new AppError("INVALID_STATE", "An artifact already exists at that path", 409);
      }
    }
    for (const item of staged) {
      this.pendingPaths.add(item.finalPath);
      item.temporaryPath = `${item.finalPath}.${randomUUID()}.tmp`;
    }
    try {
      const now = new Date().toISOString();
      const artifacts = staged.map(({ write, finalPath, temporaryPath }) => {
        mkdirSync(dirname(finalPath), { recursive: true });
        writeExclusiveAndSync(temporaryPath, write.bytes);
        write.validate?.(temporaryPath);
        const bytes = readFileSync(temporaryPath);
        return {
          id: randomUUID(),
          kind: write.kind,
          ownerType: write.ownerType,
          ownerId: write.ownerId,
          ownerRevision: write.ownerRevision ?? null,
          relativePath: validateOwnedRelativePath(write.relativePath),
          contentHash: sha256(bytes),
          byteLength: bytes.byteLength,
          producerVersion: write.producerVersion,
          state: "complete" as const,
          createdAt: now
        };
      });
      for (const item of staged) {
        renameSync(item.temporaryPath, item.finalPath);
        item.renamed = true;
        syncDirectory(dirname(item.finalPath));
      }
      const value = this.repository.transaction(() => {
        artifacts.forEach((artifact) => this.repository.saveArtifactRecord(artifact));
        return commit(artifacts);
      });
      return { artifacts, value };
    } catch (error) {
      for (const item of staged) {
        if (existsSync(item.temporaryPath)) unlinkSync(item.temporaryPath);
        if (item.renamed && existsSync(item.finalPath)) {
          unlinkSync(item.finalPath);
          syncDirectory(dirname(item.finalPath));
        }
      }
      throw normalizeArtifactError(error, "Artifact creation failed");
    } finally {
      staged.forEach(({ finalPath }) => this.pendingPaths.delete(finalPath));
    }
  }

  reconcile(): ArtifactReconciliation {
    const quarantinedTemporaryFiles: string[] = [];
    for (const path of walkFiles(this.artifactsDirectory)) {
      if (!path.endsWith(".tmp")) continue;
      quarantinedTemporaryFiles.push(this.quarantine(path));
    }

    const corruptArtifactIds: string[] = [];
    const quarantinedArtifactFiles: string[] = [];
    const artifacts = this.repository.listArtifactRecords();
    for (const artifact of artifacts) {
      if (artifact.state === "temporary") {
        this.repository.markArtifactCorrupt(artifact.id);
        corruptArtifactIds.push(artifact.id);
        continue;
      }
      if (artifact.state !== "complete") continue;
      let valid = false;
      try {
        const path = this.resolveOwnedPath(artifact.relativePath);
        if (existsSync(path) && statSync(path).isFile()) {
          const bytes = readFileSync(path);
          valid = bytes.byteLength === artifact.byteLength && sha256(bytes) === artifact.contentHash;
        }
      } catch {
        valid = false;
      }
      if (!valid) {
        try {
          const path = this.resolveOwnedPath(artifact.relativePath);
          if (existsSync(path)) quarantinedArtifactFiles.push(this.quarantine(path));
        } catch {
          // Unsafe metadata is marked corrupt without resolving or touching its target.
        }
        this.repository.markArtifactCorrupt(artifact.id);
        corruptArtifactIds.push(artifact.id);
      }
    }

    const recordedPaths = new Set(artifacts.map((artifact) => artifact.relativePath));
    for (const path of walkFiles(this.artifactsDirectory)) {
      const relativePath = relative(this.dataDirectory, path).split(sep).join("/");
      if (!recordedPaths.has(relativePath)) {
        quarantinedArtifactFiles.push(this.quarantine(path));
      }
    }
    return { quarantinedTemporaryFiles, quarantinedArtifactFiles, corruptArtifactIds };
  }

  cleanupInterruptedRenderArtifacts(): string[] {
    const cleaned: string[] = [];
    const interrupted = this.repository.listRenders().filter((render) =>
      render.state === "failed" &&
      render.error?.code === "INTERNAL_ERROR" &&
      render.error.message === "Rendering was interrupted; manual retry is required"
    );
    for (const render of interrupted) {
      for (const artifact of this.repository.listArtifactRecords(render.id)) {
        const path = this.resolveOwnedPath(artifact.relativePath);
        this.repository.deleteArtifactRecord(artifact.id);
        if (existsSync(path)) {
          unlinkSync(path);
          syncDirectory(dirname(path));
        }
        cleaned.push(artifact.relativePath);
      }
    }
    return cleaned;
  }

  private quarantine(path: string): string {
    mkdirSync(this.quarantineDirectory, { recursive: true });
    const extension = path.endsWith(".tmp") ? ".tmp" : ".artifact";
    const destination = join(
      this.quarantineDirectory,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}${extension}`
    );
    renameSync(path, destination);
    return relative(this.dataDirectory, destination);
  }
}

export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function hashFile(
  path: string,
  cancelled: () => boolean = () => false
): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    let ended = false;
    let settled = false;
    const cancellation = setInterval(() => {
      if (cancelled()) stream.destroy(new AppError("JOB_CANCELLED", "Render was cancelled", 409));
    }, 100);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => {
      ended = true;
    });
    stream.on("close", () => {
      clearInterval(cancellation);
      if (settled) return;
      settled = true;
      if (ended) {
        resolvePromise();
      } else {
        reject(new AppError("INTERNAL_ERROR", "Artifact hashing closed before completion"));
      }
    });
    stream.on("error", (error) => {
      clearInterval(cancellation);
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
  return `sha256:${hash.digest("hex")}`;
}

function throwIfArtifactCancelled(cancelled: () => boolean): void {
  if (cancelled()) throw new AppError("JOB_CANCELLED", "Render was cancelled", 409);
}

async function renameExternalArtifact(
  temporaryPath: string,
  finalPath: string,
  cancelled: () => boolean
): Promise<void> {
  const maximumAttempts = process.platform === "win32" ? 12 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    throwIfArtifactCancelled(cancelled);
    try {
      renameSync(temporaryPath, finalPath);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      const sharingViolation = code === "EACCES" || code === "EBUSY" || code === "EPERM";
      if (!sharingViolation || attempt === maximumAttempts) throw error;
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, Math.min(25 * attempt, 200));
      });
    }
  }
}

function normalizeArtifactError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "ENOSPC" || code === "EDQUOT") {
    return new AppError(
      "INTERNAL_ERROR",
      "Storage is full; free disk space and retry this Render"
    );
  }
  const normalized = new AppError("INTERNAL_ERROR", fallback);
  Object.defineProperty(normalized, "cause", {
    configurable: true,
    value: error
  });
  return normalized;
}

function writeExclusiveAndSync(path: string, bytes: Uint8Array): void {
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) return [path];
    return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
  });
}

function assertNoSymbolicLinkComponents(root: string, path: string): void {
  let current = root;
  if (lstatSync(current).isSymbolicLink()) {
    throw new AppError("VALIDATION_ERROR", "The artifact root cannot be a symbolic link", 422);
  }
  const suffix = relative(root, path);
  for (const segment of suffix.split(sep)) {
    if (!segment) continue;
    current = join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new AppError("VALIDATION_ERROR", "Owned artifact paths cannot traverse symbolic links", 422);
    }
  }
}
