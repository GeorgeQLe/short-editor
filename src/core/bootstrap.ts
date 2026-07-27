import { join, posix, win32 } from "node:path";
import { homedir } from "node:os";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";
import { MediaService } from "./media.js";
import { JobQueue, JobRunner } from "./jobs.js";
import { CoreService } from "./service.js";

export function createCore(databasePath = defaultDatabasePath()): CoreService {
  const repository = new Repository(openDatabase(databasePath));
  const jobs = new JobQueue(repository);
  jobs.recover();
  const media = new MediaService(repository);
  const runner = new JobRunner(jobs, {
    probe: async (job) => {
      jobs.progress(job.id, 0.2, "probing media");
      await media.probeEpisode(job.entityId!);
    },
    hash: async (job) => {
      jobs.progress(job.id, 0.1, "hashing source");
      await media.hashEpisode(job.entityId!);
    }
  });
  runner.start();
  return new CoreService(repository, media, jobs);
}

export function defaultDatabasePath(): string {
  return join(
    resolveDataDirectory(process.platform, process.env, homedir()),
    "short-editor.db"
  );
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
