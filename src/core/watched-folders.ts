import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type {
  Job,
  WatchedFolder,
  WatchedFolderConfigurationInput
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import type { JobQueue } from "./jobs.js";
import type { MediaService } from "./media.js";
import type { Repository } from "./repository.js";

export const DEFAULT_VIDEO_INCLUDE_PATTERNS = [
  "**/*.mp4", "**/*.mov", "**/*.mkv", "**/*.webm",
  "**/*.avi", "**/*.m4v", "**/*.mpeg", "**/*.mpg"
] as const;

export class WatchedFolderCoordinator {
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private reconcileTimer?: NodeJS.Timeout;
  private started = false;

  constructor(
    private readonly repository: Repository,
    private readonly media: MediaService,
    private readonly jobs: JobQueue,
    private readonly reconcileIntervalMs = 5 * 60_000,
    private readonly debounceMs = 500
  ) {}

  list(): WatchedFolder[] {
    return this.repository.listWatchedFolders();
  }

  async configure(input: WatchedFolderConfigurationInput): Promise<WatchedFolder | Job> {
    if (input.action === "rescan") return this.requestScan(input.folderId, "manual");
    const current = input.action === "update"
      ? this.repository.getWatchedFolder(input.folderId)
      : undefined;
    const nextEnabled = input.enabled ?? current?.enabled ?? true;
    const canonicalPath = input.path !== undefined || nextEnabled
      ? await canonicalDirectory(input.path ?? current!.canonicalPath)
      : current!.canonicalPath;
    const conflict = this.list().find((folder) =>
      folder.canonicalPath === canonicalPath && folder.id !== current?.id
    );
    if (conflict) {
      throw new AppError("VALIDATION_ERROR", "That directory is already watched", 422);
    }
    const patterns = validatePatterns(input.includePatterns ?? current?.includePatterns ??
      [...DEFAULT_VIDEO_INCLUDE_PATTERNS]);
    const now = new Date().toISOString();
    const folder = this.repository.saveWatchedFolder({
      id: current?.id ?? randomUUID(),
      canonicalPath,
      enabled: nextEnabled,
      recursive: input.recursive ?? current?.recursive ?? true,
      includePatterns: patterns,
      lastScanStatus: current?.lastScanStatus ?? "never_scanned",
      lastScannedAt: current?.lastScannedAt ?? null,
      lastScanError: current?.lastScanError ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    });
    if (this.started) {
      await this.replaceWatcher(folder);
      if (folder.enabled) this.requestScan(folder.id, "manual");
    }
    return folder;
  }

  requestScan(
    folderId: string,
    reason: "startup" | "event" | "periodic" | "manual" | "recovered"
  ): Job {
    const folder = this.repository.getWatchedFolder(folderId);
    if (!folder.enabled && reason !== "manual") {
      throw new AppError("INVALID_STATE", "Watched folder is disabled", 409);
    }
    return this.jobs.enqueueUnique({
      type: "watched_folder_scan",
      entityId: folder.id,
      payload: { apiVersion: "v1", type: "watched_folder_scan", folderId, reason }
    });
  }

  requestReconciliation(reason: "startup" | "periodic" | "recovered"): Job {
    return this.jobs.enqueueUnique({
      type: "source_reconcile",
      payload: { apiVersion: "v1", type: "source_reconcile", reason }
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const folder of this.list()) {
      if (!this.started) return;
      await this.replaceWatcher(folder);
      if (!this.started) {
        await this.watchers.get(folder.id)?.close();
        this.watchers.delete(folder.id);
        return;
      }
      if (folder.enabled) this.requestScan(folder.id, "startup");
    }
    if (!this.started) return;
    this.requestReconciliation("startup");
    this.reconcileTimer = setInterval(() => {
      for (const folder of this.list()) {
        if (folder.enabled) this.requestScan(folder.id, "periodic");
      }
      this.requestReconciliation("periodic");
    }, this.reconcileIntervalMs);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }

  async scan(job: Job, payload?: unknown): Promise<void> {
    const folder = this.repository.getWatchedFolder(job.entityId!);
    const manual = typeof payload === "object" && payload !== null &&
      "reason" in payload && payload.reason === "manual";
    if (!folder.enabled && !manual) return;
    this.repository.updateWatchedFolderScan(folder.id, "scanning");
    try {
      // Reconcile first so a rename's old path is marked missing before the new
      // path crosses the identity-safe import boundary.
      await this.reconcile(job, false);
      if (this.jobs.cancellationRequested(job.id)) {
        this.repository.updateWatchedFolderScan(folder.id, "failed", "Scan cancelled");
        return;
      }
      const paths = await discoverFiles(folder);
      for (let index = 0; index < paths.length; index++) {
        if (this.jobs.cancellationRequested(job.id)) {
          this.repository.updateWatchedFolderScan(folder.id, "failed", "Scan cancelled");
          return;
        }
        this.jobs.progress(
          job.id,
          paths.length ? index / paths.length : 0.9,
          `inspecting ${index + 1} of ${paths.length}`
        );
        await this.media.importPaths([paths[index]!]);
      }
      this.repository.updateWatchedFolderScan(folder.id, "succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Watched folder scan failed";
      this.repository.updateWatchedFolderScan(folder.id, "failed", message);
      throw error;
    }
  }

  async reconcile(job: Job, reportProgress = true): Promise<void> {
    const episodes = this.repository.listEpisodes();
    for (let index = 0; index < episodes.length; index++) {
      if (this.jobs.cancellationRequested(job.id)) return;
      const episode = this.repository.getEpisode(episodes[index]!.id);
      if (reportProgress) {
        this.jobs.progress(
          job.id,
          episodes.length ? index / episodes.length : 0.9,
          `checking ${index + 1} of ${episodes.length}`
        );
      }
      const available = await sourceAvailable(episode.sourcePath, episode.canonicalPath);
      if (!available && episode.status !== "source_missing") {
        this.repository.markEpisodeSourceMissing(episode.id);
      } else if (available && episode.status === "source_missing") {
        this.repository.restoreEpisodeAtCurrentPath(episode.id);
      }
    }
  }

  private async replaceWatcher(folder: WatchedFolder): Promise<void> {
    const old = this.watchers.get(folder.id);
    if (old) await old.close();
    this.watchers.delete(folder.id);
    if (!folder.enabled) return;
    const watcher = chokidar.watch(folder.canonicalPath, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: folder.recursive ? undefined : 0,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    });
    watcher.on("add", () => this.debounce(folder.id));
    watcher.on("change", () => this.debounce(folder.id));
    watcher.on("unlink", () => this.debounce(folder.id));
    watcher.on("error", () => this.debounce(folder.id));
    this.watchers.set(folder.id, watcher);
  }

  private debounce(folderId: string): void {
    const old = this.debounceTimers.get(folderId);
    if (old) clearTimeout(old);
    this.debounceTimers.set(folderId, setTimeout(() => {
      this.debounceTimers.delete(folderId);
      try {
        this.requestScan(folderId, "event");
      } catch {
        // A disabled or removed folder makes the queued hint obsolete.
      }
    }, this.debounceMs));
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  try {
    const canonical = await realpath(resolve(path));
    const state = await stat(canonical);
    await access(canonical, constants.R_OK);
    if (!state.isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch {
    throw new AppError("VALIDATION_ERROR", "Watched folder is not an accessible directory", 422);
  }
}

function validatePatterns(patterns: string[]): string[] {
  if (!patterns.length) throw new AppError("VALIDATION_ERROR", "At least one include pattern is required", 422);
  return patterns.map((pattern) => {
    const normalized = pattern.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new AppError("VALIDATION_ERROR", "Include patterns must be root-relative", 422);
    }
    return normalized;
  });
}

async function discoverFiles(folder: WatchedFolder): Promise<string[]> {
  await canonicalDirectory(folder.canonicalPath);
  const found: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const state = await lstat(path);
      if (state.isSymbolicLink()) {
        let canonical: string;
        let target;
        try {
          canonical = await realpath(path);
          target = await stat(canonical);
        } catch {
          continue;
        }
        if (target.isFile() && contained(folder.canonicalPath, canonical) &&
            matches(relativePath, folder.includePatterns)) {
          found.push(path);
        }
        continue;
      }
      if (state.isDirectory()) {
        if (folder.recursive) await visit(path, relativePath);
      } else if (state.isFile() && matches(relativePath, folder.includePatterns)) {
        found.push(path);
      }
    }
  };
  await visit(folder.canonicalPath, "");
  return found.sort((left, right) => left.localeCompare(right));
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function matches(path: string, patterns: string[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  return patterns.some((pattern) =>
    expandBraces(pattern).some((expanded) => globRegex(expanded).test(normalized))
  );
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  return match[1]!.split(",").flatMap((choice) =>
    expandBraces(`${pattern.slice(0, match.index)}${choice}${pattern.slice(match.index + match[0].length)}`)
  );
}

function globRegex(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      index++;
      if (pattern[index + 1] === "/") {
        index++;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[\\^$.[\]{}()+|]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
}

async function sourceAvailable(sourcePath: string, canonicalPath: string): Promise<boolean> {
  try {
    const [state, canonical] = await Promise.all([stat(sourcePath), realpath(sourcePath)]);
    await access(sourcePath, constants.R_OK);
    return state.isFile() && canonical === canonicalPath;
  } catch {
    return false;
  }
}
