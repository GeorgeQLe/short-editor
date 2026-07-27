import { dirname, join, posix, win32 } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";
import { MediaService } from "./media.js";
import { JobQueue, JobRunner } from "./jobs.js";
import { CoreService } from "./service.js";
import { ArtifactStore } from "./artifact-store.js";
import { ensureLayout, prepareDataDirectory } from "./startup.js";
import { WatchedFolderCoordinator } from "./watched-folders.js";

export function createCore(databasePath?: string): CoreService {
  const selectedDatabasePath = databasePath ?? startupDatabasePath();
  const dataDirectory = selectedDatabasePath === ":memory:"
    ? mkdtempSync(join(tmpdir(), "short-editor-memory-"))
    : dirname(selectedDatabasePath);
  ensureLayout(dataDirectory);
  const repository = new Repository(openDatabase(selectedDatabasePath));
  const jobs = new JobQueue(repository);
  const media = new MediaService(repository);
  const artifacts = new ArtifactStore(dataDirectory, repository);
  artifacts.reconcile();
  jobs.recover();
  const watchedFolders = new WatchedFolderCoordinator(repository, media, jobs);
  const runner = new JobRunner(jobs, {
    probe: async (job) => {
      jobs.progress(job.id, 0.2, "probing media");
      await media.probeEpisode(job.entityId!);
    },
    hash: async (job) => {
      jobs.progress(job.id, 0.1, "hashing source");
      await media.hashEpisode(job.entityId!);
    },
    watched_folder_scan: async (job, payload) => watchedFolders.scan(job, payload),
    source_reconcile: async (job) => watchedFolders.reconcile(job)
  });
  runner.start();
  void watchedFolders.start();
  return new CoreService(repository, media, jobs, artifacts, watchedFolders, () => runner.stop());
}

export function defaultDatabasePath(): string {
  return join(
    resolveDataDirectory(process.platform, process.env, homedir()),
    "short-editor.db"
  );
}

function startupDatabasePath(): string {
  const native = resolveDataDirectory(process.platform, process.env, homedir());
  const legacy = resolveLegacyDataDirectory(process.env, homedir());
  return join(prepareDataDirectory(native, legacy).dataDirectory, "short-editor.db");
}

type DataDirectoryEnvironment = {
  SHORT_EDITOR_DATA_DIR?: string;
  LOCALAPPDATA?: string;
  XDG_DATA_HOME?: string;
};

export function resolveDataDirectory(
  platform: NodeJS.Platform,
  environment: DataDirectoryEnvironment,
  homeDirectory: string
): string {
  if (environment.SHORT_EDITOR_DATA_DIR) {
    return environment.SHORT_EDITOR_DATA_DIR;
  }

  if (platform === "win32") {
    return environment.LOCALAPPDATA
      ? win32.join(environment.LOCALAPPDATA, "ShortEditor")
      : win32.join(homeDirectory, "AppData", "Local", "ShortEditor");
  }

  if (platform === "darwin") {
    return posix.join(homeDirectory, "Library", "Application Support", "ShortEditor");
  }

  return environment.XDG_DATA_HOME
    ? posix.join(environment.XDG_DATA_HOME, "ShortEditor")
    : posix.join(homeDirectory, ".local", "share", "ShortEditor");
}

export function resolveLegacyDataDirectory(
  environment: DataDirectoryEnvironment,
  homeDirectory: string
): string {
  if (environment.SHORT_EDITOR_DATA_DIR) return environment.SHORT_EDITOR_DATA_DIR;
  return join(homeDirectory, "AppData", "Local", "ShortEditor");
}
