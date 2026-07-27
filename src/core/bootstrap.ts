import { join } from "node:path";
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
  const dataDir = process.env.SHORT_EDITOR_DATA_DIR
    ?? join(homedir(), "AppData", "Local", "ShortEditor");
  return join(dataDir, "short-editor.db");
}
