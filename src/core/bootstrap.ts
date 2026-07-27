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
import {
  PythonWorkerSupervisor,
  developmentPythonWorkerLaunch
} from "./python-worker-supervisor.js";
import {
  LocalTranscriptionProvider,
  localTranscriptionOptionsSchema
} from "./local-transcription.js";
import {
  analysisInputHash,
  createAnalysisArtifact,
  localAnalysisJobOptionsSchema,
  LocalVisualSampler,
  OllamaAnalysisProvider
} from "./local-analysis.js";
import { AppError } from "../shared/errors.js";

export function createCore(databasePath?: string): CoreService {
  const selectedDatabasePath = databasePath ?? startupDatabasePath();
  const dataDirectory = selectedDatabasePath === ":memory:"
    ? mkdtempSync(join(tmpdir(), "short-editor-memory-"))
    : dirname(selectedDatabasePath);
  ensureLayout(dataDirectory);
  const repository = new Repository(openDatabase(selectedDatabasePath));
  const activeCredentialHandles = new Set<string>();
  const jobs = new JobQueue(repository, (handle) => activeCredentialHandles.has(handle));
  const media = new MediaService(repository);
  const artifacts = new ArtifactStore(dataDirectory, repository);
  artifacts.reconcile();
  jobs.recover();
  const watchedFolders = new WatchedFolderCoordinator(repository, media, jobs);
  const worker = new PythonWorkerSupervisor({
    launch: developmentPythonWorkerLaunch(process.cwd()),
    coreVersion: "0.1.0"
  });
  const localTranscription = new LocalTranscriptionProvider(worker);
  const localVisualSampling = new LocalVisualSampler(worker);
  const ollamaAnalysis = new OllamaAnalysisProvider(worker);
  let service!: CoreService;
  const runner = new JobRunner(jobs, {
    probe: async (job) => {
      jobs.progress(job.id, 0.2, "probing media");
      await media.probeEpisode(job.entityId!);
    },
    analyze: async (job, payload) => {
      if (job.provider !== "local") {
        throw new AppError(
          "DEPENDENCY_UNAVAILABLE",
          "OpenAI transcription is not installed and local fallback is disabled",
          503
        );
      }
      const episode = repository.getEpisode(job.entityId!);
      const localAnalysis = localAnalysisJobOptionsSchema.safeParse(payload);
      if (localAnalysis.success) {
        const transcript = repository.getAcceptedTranscriptRevision(episode.id);
        if (!episode.contentHash) {
          throw new AppError("INVALID_STATE", "Episode hashing must finish before analysis", 409);
        }
        const inputHash = analysisInputHash({
          sourceHash: episode.contentHash,
          transcript,
          ollama: localAnalysis.data.ollama,
          visual: localAnalysis.data.visual
        });
        if (repository.findAnalysisArtifact(episode.id, "episode_analysis", inputHash)) {
          jobs.progress(job.id, 1, "reused matching local analysis");
          return;
        }
        const cancellation = setInterval(() => {
          if (jobs.cancellationRequested(job.id)) void worker.cancel(job.id);
        }, 100);
        try {
          const visual = await localVisualSampling.sample(
            job.id,
            episode.sourcePath,
            localAnalysis.data.visual,
            (progress, stage) => jobs.progress(job.id, progress * 0.45, stage)
          );
          if (jobs.cancellationRequested(job.id)) return;
          const artifactRoot = `artifacts/episodes/${episode.id}/analysis-inputs/${job.id}`;
          const transcriptRecord = artifacts.finalize({
            kind: "analysis_transcript_input",
            ownerType: "episode",
            ownerId: episode.id,
            ownerRevision: transcript.revision,
            relativePath: `${artifactRoot}/transcript.json`,
            producerVersion: "analysis-input-v1",
            bytes: Buffer.from(JSON.stringify({
              revision: transcript.revision,
              language: transcript.language,
              segments: transcript.segments
            }))
          });
          const visualRecord = artifacts.finalize({
            kind: "analysis_visual_input",
            ownerType: "episode",
            ownerId: episode.id,
            ownerRevision: transcript.revision,
            relativePath: `${artifactRoot}/visual.json`,
            producerVersion: "visual-sampling-v1",
            bytes: Buffer.from(JSON.stringify({
              capabilities: visual.capabilities,
              samples: visual.samples,
              provenance: visual.provenance
            }))
          });
          const analyzed = await ollamaAnalysis.analyze(
            job.id,
            [
              artifacts.resolveOwnedPath(transcriptRecord.relativePath),
              artifacts.resolveOwnedPath(visualRecord.relativePath)
            ],
            localAnalysis.data.ollama,
            (progress, stage) => jobs.progress(job.id, 0.45 + progress * 0.5, stage)
          );
          if (jobs.cancellationRequested(job.id)) return;
          repository.insertAnalysisArtifact(createAnalysisArtifact(
            episode.id,
            inputHash,
            analyzed.output,
            analyzed.provenance
          ));
          jobs.progress(job.id, 0.98, "stored typed local analysis");
        } catch (error) {
          if (
            error instanceof AppError &&
            error.code === "JOB_CANCELLED" &&
            jobs.cancellationRequested(job.id)
          ) return;
          throw error;
        } finally {
          clearInterval(cancellation);
        }
        return;
      }
      const options = localTranscriptionOptionsSchema.parse(payload);
      const cancellation = setInterval(() => {
        if (jobs.cancellationRequested(job.id)) void worker.cancel(job.id);
      }, 100);
      try {
        const result = await localTranscription.transcribe(
          job.id,
          episode.sourcePath,
          options,
          (progress, stage) => jobs.progress(job.id, progress, stage)
        );
        if (jobs.cancellationRequested(job.id)) return;
        service.storeGeneratedTranscript(
          episode.id,
          result.language,
          result.segments,
          result.provenance
        );
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "JOB_CANCELLED" &&
          jobs.cancellationRequested(job.id)
        ) return;
        throw error;
      } finally {
        clearInterval(cancellation);
      }
    },
    hash: async (job) => {
      jobs.progress(job.id, 0.1, "hashing source");
      await media.hashEpisode(job.entityId!);
    },
    watched_folder_scan: async (job, payload) => watchedFolders.scan(job, payload),
    source_reconcile: async (job) => watchedFolders.reconcile(job)
  });
  service = new CoreService(
    repository,
    media,
    jobs,
    artifacts,
    watchedFolders,
    async () => {
      await runner.stop();
      await worker.stop();
    },
    localTranscription,
    ollamaAnalysis,
    localVisualSampling,
    activeCredentialHandles
  );
  runner.start();
  void watchedFolders.start();
  return service;
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
