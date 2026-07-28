import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { z } from "zod";
import {
  type Asset,
  candidateGenerationInputSchema,
  type CandidateGenerationInput,
  type Composition,
  type ScheduleRules,
  type ShortProject,
  type TranscriptSegment,
  type TranscriptRevision,
  type ProviderProvenance,
  type WatchedFolderConfigurationInput,
  watchedFolderConfigurationInputSchema
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import { starterTemplates, templateById } from "../shared/templates.js";
import { generateCandidates } from "./candidates.js";
import type { Repository } from "./repository.js";
import type { MediaService } from "./media.js";
import type { JobQueue } from "./jobs.js";
import { draftSchedule, type SchedulableShort } from "./scheduler.js";
import { validateRender } from "./render.js";
import type { ArtifactStore } from "./artifact-store.js";
import type { CloudAuthorization } from "./repository.js";
import { WatchedFolderCoordinator } from "./watched-folders.js";
import {
  classifyProviderEndpoint,
  episodeAnalysisOutputSchema,
  localAnalysisJobOptionsSchema,
  type OllamaAnalysisProvider,
  type LocalVisualSampler
} from "./local-analysis.js";
import {
  localTranscriptionOptionsSchema,
  type LocalTranscriptionProvider
} from "./local-transcription.js";
import {
  OPENAI_ADAPTER_VERSION,
  openAiAnalysisOptionsSchema,
  openAiSpeechOptionsSchema,
  type AnalysisArtifact,
  type OpenAiSpeechResult,
  type ProviderCapability,
  type ProviderStatus
} from "../shared/domain.js";
import type { OpenAiProvider } from "./openai-provider.js";
import { canonicalJson } from "./analysis-cache.js";

export class CoreService {
  constructor(
    readonly repository: Repository,
    readonly media: MediaService,
    readonly jobs: JobQueue,
    readonly artifacts?: ArtifactStore,
    readonly watchedFolders?: WatchedFolderCoordinator,
    private readonly stopWorker?: () => void | Promise<void>,
    readonly localTranscription?: LocalTranscriptionProvider,
    readonly ollamaAnalysis?: OllamaAnalysisProvider,
    readonly localVisualSampling?: LocalVisualSampler,
    private readonly activeCredentialHandles: Set<string> = new Set(),
    readonly openAi?: OpenAiProvider
  ) {}

  async stop(): Promise<void> {
    await this.watchedFolders?.stop();
    await this.stopWorker?.();
    if (this.repository.db.open) this.repository.db.close();
  }

  listEpisodes(search?: string) { return this.repository.listEpisodes(search); }
  getEpisode(id: string) { return this.repository.getEpisode(id); }
  async importPaths(paths: string[]) {
    const result = await this.media.importPaths(paths);
    for (const episode of result.imported) {
      if (!episode.contentHash) this.jobs.enqueue({ type: "hash", entityId: episode.id });
    }
    return result;
  }
  listJobs() { return this.jobs.list(); }
  cancelJob(id: string) { return this.jobs.cancel(id); }
  listWatchedFolders() {
    return this.watchedFolders?.list() ?? this.repository.listWatchedFolders();
  }
  configureWatchedFolder(input: WatchedFolderConfigurationInput) {
    if (!this.watchedFolders) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Watched-folder coordinator is unavailable", 503);
    }
    return this.watchedFolders.configure(input);
  }
  rescanWatchedFolder(folderId: string) {
    if (!this.watchedFolders) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Watched-folder coordinator is unavailable", 503);
    }
    return this.watchedFolders.requestScan(folderId, "manual");
  }
  relinkSource(episodeId: string, candidatePath: string) {
    return this.media.relinkSource(episodeId, candidatePath);
  }
  confirmRelink(episodeId: string, confirmationToken: string) {
    return this.media.confirmRelink(episodeId, confirmationToken);
  }
  startAnalysis(
    episodeId: string,
    provider: "local" | "openai",
    options: {
      modelId?: string;
      wordTimestamps?: boolean;
      speechMode?: "transcription" | "diarization";
      timeoutMs?: number;
      authorizationBatchId?: string;
    } = {}
  ) {
    const episode = this.repository.getEpisode(episodeId);
    if (episode.missing) {
      throw new AppError("SOURCE_MISSING", "Cannot transcribe an Episode with missing source media", 409);
    }
    const transcription = provider === "openai"
      ? openAiSpeechOptionsSchema.parse({
        mode: options.speechMode ?? "transcription",
        modelId: options.modelId ?? (
          options.speechMode === "diarization"
            ? "gpt-4o-transcribe-diarize"
            : "whisper-1"
        ),
        wordTimestamps: options.speechMode === "diarization"
          ? false
          : (options.wordTimestamps ?? true),
        timeoutMs: options.timeoutMs ?? 120_000
      })
      : localTranscriptionOptionsSchema.parse({
        modelId: options.modelId ?? process.env.SHORT_EDITOR_WHISPER_MODEL ?? "small.en",
        wordTimestamps: options.wordTimestamps ?? true
      });
    return this.jobs.enqueue({
      type: "analyze",
      entityId: episodeId,
      provider,
      ...(provider === "openai" ? { cloudOperationClass: "transcription" } : {}),
      ...(provider === "openai" && options.authorizationBatchId ? {
        cloudScope: { type: "batch" as const, id: options.authorizationBatchId }
      } : {}),
      payload: transcription
    });
  }

  startOpenAiAnalysis(
    episodeId: string,
    options: {
      modelId?: string;
      timeoutMs?: number;
      temperature?: number;
      intervalMs?: number;
      maximumSamples?: number;
      authorizationBatchId?: string;
    } = {}
  ) {
    const episode = this.repository.getEpisode(episodeId);
    if (episode.missing) {
      throw new AppError("SOURCE_MISSING", "Cannot analyze an Episode with missing source media", 409);
    }
    if (!episode.contentHash) {
      throw new AppError("INVALID_STATE", "Episode hashing must finish before analysis", 409);
    }
    this.repository.getAcceptedTranscriptRevision(episodeId);
    const modelId = options.modelId ?? process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL;
    if (!modelId) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "OpenAI analysis is unconfigured; select an exact model",
        503,
        undefined,
        false
      );
    }
    const payload = openAiAnalysisOptionsSchema.parse({
      modelId,
      timeoutMs: options.timeoutMs ?? 180_000,
      temperature: options.temperature ?? 0,
      visual: {
        intervalMs: options.intervalMs ?? 2_000,
        maximumSamples: options.maximumSamples ?? 300
      }
    });
    return this.jobs.enqueue({
      type: "analyze",
      entityId: episodeId,
      provider: "openai",
      cloudOperationClass: "analysis",
      ...(options.authorizationBatchId ? {
        cloudScope: { type: "batch" as const, id: options.authorizationBatchId }
      } : {}),
      payload
    });
  }

  synchronizeCredentialHandles(handles: string[]): void {
    this.activeCredentialHandles.clear();
    for (const handle of handles) this.activeCredentialHandles.add(handle);
  }

  grantCloudAuthorization(input: {
    scopeType: "project" | "batch";
    scopeId: string;
    provider: "openai" | "ollama";
    operationClasses: string[];
    credentialHandle: string | null;
    dataDescription: string;
    networkUseConfirmed: boolean;
    costsConfirmed: boolean;
  }): CloudAuthorization {
    if (!input.operationClasses.length || input.operationClasses.some(
      (operation) => operation !== "transcription" && operation !== "analysis"
    )) {
      throw new AppError("VALIDATION_ERROR", "Unsupported cloud operation class", 422);
    }
    if (!input.networkUseConfirmed || !input.costsConfirmed || !input.dataDescription.trim()) {
      throw new AppError(
        "CLOUD_CONFIRMATION_REQUIRED",
        "Cloud authorization requires data, network, and cost disclosure",
        409
      );
    }
    if (input.scopeType === "project") this.repository.getEpisode(input.scopeId);
    if (input.provider === "openai" && (
      !input.credentialHandle || !this.activeCredentialHandles.has(input.credentialHandle)
    )) {
      throw new AppError(
        "CLOUD_CONFIRMATION_REQUIRED",
        "Select an available protected OpenAI credential before authorizing",
        409
      );
    }
    const now = new Date().toISOString();
    return this.repository.grantCloudAuthorization({
      id: randomUUID(),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      provider: input.provider,
      operationClasses: [...new Set(input.operationClasses)],
      credentialHandle: input.credentialHandle,
      grantedAt: now,
      revokedAt: null
    });
  }

  listCloudAuthorizations(scopeId?: string) {
    return this.repository.listCloudAuthorizations(scopeId);
  }

  revokeCloudAuthorization(id: string): void {
    this.repository.revokeCloudAuthorization(id);
  }

  removeCredentialHandle(handle: string): void {
    this.repository.transaction(() => {
      this.repository.revokeCloudAuthorizationsForCredential(handle);
      this.activeCredentialHandles.delete(handle);
    });
  }

  transcriptionStatus() {
    if (!this.localTranscription) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Local transcription is unavailable", 503);
    }
    return this.localTranscription.status();
  }

  startOllamaAnalysis(
    episodeId: string,
    options: {
      baseUrl?: string;
      modelId?: string;
      timeoutMs?: number;
      networkDisclosed?: boolean;
      cloudAuthorized?: boolean;
      temperature?: number;
      intervalMs?: number;
      maximumSamples?: number;
      fixtureId?: string;
    } = {}
  ) {
    const episode = this.repository.getEpisode(episodeId);
    if (episode.missing) {
      throw new AppError("SOURCE_MISSING", "Cannot analyze an Episode with missing source media", 409);
    }
    if (!episode.contentHash) {
      throw new AppError("INVALID_STATE", "Episode hashing must finish before analysis", 409);
    }
    this.repository.getAcceptedTranscriptRevision(episodeId);
    const baseUrl = options.baseUrl ?? process.env.SHORT_EDITOR_OLLAMA_BASE_URL ??
      "http://127.0.0.1:11434";
    const endpointClass = classifyProviderEndpoint(baseUrl);
    if (endpointClass === "network" && !options.networkDisclosed) {
      throw new AppError(
        "CLOUD_CONFIRMATION_REQUIRED",
        "Private-LAN Ollama analysis requires disclosure of the endpoint and transmitted data",
        403
      );
    }
    const persistedCloudAuthorization = endpointClass === "cloud" &&
      this.repository.hasCloudAuthorization("project", episodeId, "ollama", "analysis");
    if (endpointClass === "cloud" && !persistedCloudAuthorization) {
      throw new AppError(
        "CLOUD_NOT_AUTHORIZED",
        "Public Ollama analysis requires persisted cloud authorization",
        403
      );
    }
    const payload = localAnalysisJobOptionsSchema.parse({
      mode: "ollama",
      ollama: {
        baseUrl,
        modelId: options.modelId ?? process.env.SHORT_EDITOR_OLLAMA_MODEL ?? "gemma3",
        timeoutMs: options.timeoutMs ?? 120_000,
        networkDisclosed: options.networkDisclosed ?? false,
        cloudAuthorized: persistedCloudAuthorization,
        temperature: options.temperature ?? 0
      },
      visual: {
        intervalMs: options.intervalMs ?? 2_000,
        maximumSamples: options.maximumSamples ?? 300,
        ...(options.fixtureId ? { fixtureId: options.fixtureId } : {})
      }
    });
    return this.jobs.enqueue({
      type: "analyze",
      entityId: episodeId,
      provider: "local",
      payload
    });
  }

  ollamaStatus(baseUrl = process.env.SHORT_EDITOR_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434") {
    if (!this.ollamaAnalysis || !this.localVisualSampling) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Local analysis providers are unavailable", 503);
    }
    return this.ollamaAnalysis.status(baseUrl);
  }

  listAnalysisArtifacts(episodeId: string) {
    this.repository.getEpisode(episodeId);
    return this.repository.listAnalysisArtifacts(episodeId);
  }

  listProviderCapabilities(): ProviderCapability[] {
    return [
      {
        provider: "local",
        providerClass: "local",
        operations: ["transcription", "analysis"],
        features: ["offline", "timed-segments", "visual-sampling"],
        defaultModels: { transcription: process.env.SHORT_EDITOR_WHISPER_MODEL ?? "small.en" }
      },
      {
        provider: "ollama",
        providerClass: "local",
        operations: ["analysis"],
        features: ["strict-schema", "explicit-endpoint-classification"],
        defaultModels: { analysis: process.env.SHORT_EDITOR_OLLAMA_MODEL ?? "gemma3" }
      },
      {
        provider: "openai",
        providerClass: "cloud",
        operations: ["transcription", "diarization", "analysis"],
        features: [
          "verbose-json",
          "optional-word-timestamps",
          "diarized-json",
          "strict-structured-output",
          OPENAI_ADAPTER_VERSION
        ],
        defaultModels: {
          transcription: "whisper-1",
          diarization: "gpt-4o-transcribe-diarize",
          ...(process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL
            ? { analysis: process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL }
            : {})
        }
      }
    ];
  }

  getProviderStatus(scope?: {
    episodeId?: string;
    authorizationBatchId?: string;
  }): ProviderStatus[] {
    if (scope?.episodeId) this.repository.getEpisode(scope.episodeId);
    const scopeType = scope?.authorizationBatchId ? "batch" : "project";
    const scopeId = scope?.authorizationBatchId ?? scope?.episodeId;
    const authorized = (operation: "transcription" | "analysis") => {
      const authorization = scopeId ? this.repository.findCloudAuthorization(
        scopeType,
        scopeId,
        "openai",
        operation
      ) : undefined;
      return Boolean(
        authorization?.credentialHandle &&
        this.activeCredentialHandles.has(authorization.credentialHandle)
      );
    };
    const credentialConfigured = this.activeCredentialHandles.size > 0;
    const analysisConfigured = Boolean(process.env.SHORT_EDITOR_OPENAI_ANALYSIS_MODEL);
    return [
      {
        provider: "local",
        configured: Boolean(this.localTranscription),
        credentialConfigured: false,
        transcriptionReady: Boolean(this.localTranscription),
        analysisReady: false,
        authorization: { transcription: true, analysis: true },
        detail: this.localTranscription ? null : "Local transcription is unavailable"
      },
      {
        provider: "ollama",
        configured: Boolean(this.ollamaAnalysis && this.localVisualSampling),
        credentialConfigured: false,
        transcriptionReady: false,
        analysisReady: Boolean(this.ollamaAnalysis && this.localVisualSampling),
        authorization: { transcription: false, analysis: true },
        detail: this.ollamaAnalysis && this.localVisualSampling
          ? null
          : "Ollama analysis is unavailable"
      },
      {
        provider: "openai",
        configured: credentialConfigured,
        credentialConfigured,
        transcriptionReady: credentialConfigured && authorized("transcription"),
        analysisReady: credentialConfigured && analysisConfigured && authorized("analysis"),
        authorization: {
          transcription: authorized("transcription"),
          analysis: authorized("analysis")
        },
        detail: credentialConfigured
          ? (analysisConfigured ? null : "Structured analysis needs an explicit request model")
          : "No protected OpenAI credential is configured"
      }
    ];
  }

  validateCloudAuthorization(input: {
    scopeType: "project" | "batch";
    scopeId: string;
    provider: "openai";
    operationClass: "transcription" | "analysis";
    credentialHandle: string;
  }): boolean {
    const authorization = this.repository.findCloudAuthorization(
      input.scopeType,
      input.scopeId,
      input.provider,
      input.operationClass
    );
    return authorization?.credentialHandle === input.credentialHandle &&
      this.activeCredentialHandles.has(input.credentialHandle);
  }

  storeOpenAiSpeech(
    episodeId: string,
    result: OpenAiSpeechResult,
    inputHash: string
  ) {
    return this.repository.transaction(() => {
      const revision = this.storeTranscript(
        episodeId,
        result.segments,
        result.language,
        result.provenance
      ) as TranscriptRevision;
      const artifact: AnalysisArtifact = {
        id: randomUUID(),
        entityId: episodeId,
        ownerType: "episode",
        kind: "transcript",
        state: "accepted",
        provenance: result.provenance,
        inputHash,
        rawOutput: {
          providerOutput: result.rawOutput,
          requestMetadata: result.requestMetadata
        },
        acceptedProjection: {
          transcriptRevisionId: revision.id,
          revision: revision.revision,
          language: revision.language,
          segments: revision.segments
        },
        createdAt: result.provenance.createdAt
      };
      this.repository.insertAnalysisArtifact(artifact);
      return revision;
    });
  }

  openAiSpeechInputHash(
    episodeId: string,
    options: {
      mode: string;
      modelId: string;
      wordTimestamps: boolean;
    }
  ): string {
    const episode = this.repository.getEpisode(episodeId);
    return `sha256:${createHash("sha256").update(canonicalJson({
      sourceHash: episode.contentHash ?? episode.fingerprint,
      provider: "openai",
      modelId: options.modelId,
      speechMode: options.mode,
      wordTimestamps: options.wordTimestamps,
      optionsVersion: "openai-speech-v1"
    })).digest("hex")}`;
  }

  getTranscript(episodeId: string, revision?: number) {
    return this.repository.getTranscriptRevision(episodeId, revision);
  }

  updateTranscript(
    episodeId: string,
    expectedRevision: number,
    language: string,
    segments: TranscriptSegment[]
  ) {
    return this.repository.updateAcceptedTranscript(
      episodeId,
      expectedRevision,
      language,
      segments
    );
  }

  storeGeneratedTranscript(
    episodeId: string,
    language: string,
    segments: TranscriptSegment[],
    provenance: ProviderProvenance
  ) {
    return this.storeTranscript(episodeId, segments, language, provenance);
  }

  private storeTranscript(
    episodeId: string,
    segments: TranscriptSegment[],
    language?: string,
    provenance?: ProviderProvenance
  ) {
    return this.repository.transaction(() => {
      let episode = this.repository.getEpisode(episodeId);
      if (episode.missing) {
        throw new AppError("SOURCE_MISSING", "Cannot transcribe an Episode with missing source media", 409, {
          episodeId
        });
      }
      if (episode.status === "ready") {
        episode = this.repository.updateEpisodeStatus(episodeId, "analyzing");
      } else {
        if (episode.status === "discovered" || episode.status === "error") {
          episode = this.repository.updateEpisodeStatus(episodeId, "indexing");
        }
        if (episode.status !== "analyzing") {
          episode = this.repository.updateEpisodeStatus(episodeId, "analyzing");
        }
      }
      const revision = language && provenance
        ? this.repository.replaceTranscriptWithProvenance(
          episodeId, segments, language, provenance
        )
        : this.repository.replaceTranscript(episodeId, segments);
      this.repository.updateEpisodeStatus(episodeId, "ready");
      return revision;
    });
  }

  generateCandidates(input: CandidateGenerationInput) {
    const parsed = candidateGenerationInputSchema.parse(input);
    this.repository.getEpisode(parsed.episodeId);
    const transcript = this.repository.getAcceptedTranscriptRevision(parsed.episodeId);
    let result;
    if (parsed.mode === "analysis") {
      const artifact = this.repository.getAnalysisArtifact(parsed.analysisArtifactId);
      if (
        artifact.entityId !== parsed.episodeId
        || artifact.ownerType !== "episode"
        || artifact.kind !== "episode_analysis"
        || (artifact.state !== "proposed" && artifact.state !== "accepted")
      ) {
        throw new AppError(
          "INVALID_STATE",
          "Analysis artifact is not an active episode analysis for this Episode",
          409
        );
      }
      const direct = episodeAnalysisOutputSchema.safeParse(artifact.rawOutput);
      const envelope = z.strictObject({
        typedOutput: episodeAnalysisOutputSchema,
        providerOutput: z.json(),
        requestMetadata: z.json()
      }).safeParse(artifact.rawOutput);
      const output = direct.success ? direct.data : envelope.success ? envelope.data.typedOutput : null;
      if (!output) {
        throw new AppError(
          "PROVIDER_OUTPUT_INVALID",
          "Analysis artifact output does not match a supported analysis envelope",
          422
        );
      }
      result = generateCandidates({
        episodeId: parsed.episodeId,
        transcriptRevision: transcript.revision,
        segments: transcript.segments,
        count: parsed.count,
        mode: "analysis",
        analysisArtifactId: artifact.id,
        provider: artifact.provenance,
        highlights: output.highlights
      });
    } else {
      result = generateCandidates({
        episodeId: parsed.episodeId,
        transcriptRevision: transcript.revision,
        segments: transcript.segments,
        count: parsed.count,
        mode: "heuristic"
      });
    }
    this.repository.replaceCandidates(parsed.episodeId, result.candidates);
    return result;
  }
  listCandidates(episodeId: string) { return this.repository.listCandidates(episodeId); }
  reviewCandidate(id: string, status: "approved" | "rejected") {
    return this.repository.reviewCandidate(id, status);
  }

  createShort(candidateId: string, templateId = "fullscreen-speaker-v1"): ShortProject {
    const candidate = this.repository.getCandidate(candidateId);
    if (candidate.reviewStatus !== "approved") {
      throw new AppError("INVALID_STATE", "Approve the candidate before creating a Short", 409);
    }
    const template = templateById(templateId);
    if (!template) throw new AppError("NOT_FOUND", "Template not found", 404);
    const now = new Date().toISOString();
    return this.repository.createShort({
      id: randomUUID(), episodeId: candidate.episodeId, candidateId, title: candidate.topic,
      sourceRanges: [{ startMs: candidate.startMs, endMs: candidate.endMs }],
      templateId,
      templateLineage: { templateId, templateVersion: template.version, parentTemplateId: null },
      composition: structuredClone(template.composition),
      captions: {
        enabled: true,
        segments: [],
        style: { fontFamily: "Arial", fontSize: 64, color: "#ffffff", highlightColor: "#ffdc5e" }
      },
      audio: {
        sourceGainDb: 0, muted: false, fadeInMs: 0, fadeOutMs: 0,
        bedAssetId: null, bedGainDb: null, normalizeLoudness: false
      },
      copy: {
        cleanedTranscript: candidate.transcript, rewrite: "", hookVariants: [candidate.hook],
        titles: [candidate.topic], description: "", hashtags: [], thumbnailText: ""
      },
      approved: false, revision: 1, createdAt: now, updatedAt: now
    });
  }
  getShort(id: string) { return this.repository.getShort(id); }
  updateComposition(id: string, expectedRevision: number, composition: Composition) {
    return this.repository.updateShort(id, expectedRevision, { composition });
  }
  updateCopy(id: string, expectedRevision: number, copy: ShortProject["copy"]) {
    return this.repository.updateShort(id, expectedRevision, { copy });
  }
  approveShort(id: string, expectedRevision: number) {
    return this.repository.updateShort(id, expectedRevision, { approved: true });
  }

  listTemplates() { return this.repository.listTemplates(); }
  listAssets() {
    return this.repository.listAssets();
  }
  importAsset(path: string, provenance: string, reusable: boolean) {
    const sourcePath = resolve(path);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new AppError("NOT_FOUND", "Asset file does not exist", 404);
    }
    const extension = extname(sourcePath).toLowerCase();
    const kind: Asset["kind"] | null = [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? "image"
      : [".mp4", ".mov", ".webm"].includes(extension) ? "video" : null;
    if (!kind) throw new AppError("VALIDATION_ERROR", "Unsupported asset type", 422);
    const now = new Date().toISOString();
    const asset = {
      id: randomUUID(), sourcePath, ownedArtifactPath: null, kind, provenance, reusable,
      tags: [], width: null, height: null, durationMs: null, createdAt: now, updatedAt: now
    };
    return this.repository.saveAsset(asset);
  }
  listRenders(shortId?: string) {
    return this.repository.listRenders(shortId);
  }
  startRender(shortId: string, expectedRevision: number) {
    const project = this.repository.getShort(shortId);
    if (project.revision !== expectedRevision) {
      throw new AppError("REVISION_CONFLICT", "Short revision is stale", 409);
    }
    if (!project.approved) throw new AppError("INVALID_STATE", "Approve the Short before rendering", 409);
    return this.jobs.enqueue({ type: "render", entityId: shortId, payload: { revision: expectedRevision } });
  }
  validateRender(path: string) { return validateRender(path); }
  draftSchedule(shorts: SchedulableShort[], rules: ScheduleRules) {
    for (const item of shorts) {
      const eligible = this.repository.db.prepare(`
        SELECT 1 FROM renders r JOIN short_projects s ON s.id=r.short_id
        WHERE r.id=? AND r.short_id=? AND r.state='succeeded' AND r.project_revision=s.revision
          AND s.approved=1
      `).get(item.renderId, item.shortId);
      if (!eligible) throw new AppError(
        "INVALID_STATE", `Short ${item.shortId} needs an approved current validated render`, 409
      );
    }
    const occupied = (this.repository.db.prepare("SELECT publish_at FROM schedule_entries").all() as { publish_at: string }[])
      .map((row) => row.publish_at);
    const draft = draftSchedule(shorts, rules, occupied);
    const now = new Date().toISOString();
    const insert = this.repository.db.prepare(`
      INSERT INTO schedule_entries(id,short_id,render_id,episode_id,publish_at,timezone,status,
        priority,rationale,locked,youtube_url,needs_rerender,revision,created_at,updated_at)
      VALUES(@id,@shortId,@renderId,@episodeId,@publishAt,@timezone,'draft',
        @priority,@rationale,0,NULL,0,1,@now,@now)
    `);
    this.repository.db.transaction(() => draft.forEach((entry) => insert.run({ ...entry, now })))();
    return draft;
  }
  getSchedule() {
    return this.repository.db.prepare("SELECT * FROM schedule_entries ORDER BY publish_at").all();
  }
  moveScheduleEntry(entryId: string, expectedRevision: number, publishAt: string) {
    const instant = new Date(publishAt);
    if (Number.isNaN(instant.getTime())) throw new AppError("VALIDATION_ERROR", "Invalid publish instant", 422);
    const row = this.repository.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(entryId) as
      { revision: number; locked: number } | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Schedule entry not found", 404);
    if (row.revision !== expectedRevision) throw new AppError("REVISION_CONFLICT", "Schedule entry revision is stale", 409);
    if (row.locked) throw new AppError("INVALID_STATE", "Schedule entry is locked", 409);
    try {
      this.repository.db.prepare(`
        UPDATE schedule_entries SET publish_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?
      `).run(instant.toISOString(), new Date().toISOString(), entryId, expectedRevision);
    } catch {
      throw new AppError("SCHEDULE_COLLISION", "Another entry already occupies that instant", 409);
    }
    return this.repository.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(entryId);
  }
  markPublished(entryId: string, expectedRevision: number, youtubeUrl?: string) {
    const update = this.repository.db.prepare(`
      UPDATE schedule_entries SET status='published',youtube_url=?,locked=1,
        revision=revision+1,updated_at=? WHERE id=? AND revision=? AND needs_rerender=0
    `).run(youtubeUrl ?? null, new Date().toISOString(), entryId, expectedRevision);
    if (!update.changes) throw new AppError("REVISION_CONFLICT", "Entry is stale or needs rerender", 409);
    return this.repository.db.prepare("SELECT * FROM schedule_entries WHERE id=?").get(entryId);
  }
}

export const importPathsInput = z.object({ paths: z.array(z.string()).min(1) });
export const watchedFolderConfigurationInput = watchedFolderConfigurationInputSchema;
export const relinkSourceInput = z.strictObject({
  candidatePath: z.string().min(1)
});
export const confirmRelinkInput = z.strictObject({
  confirmationToken: z.string().min(1)
});
export const candidateGenerateInput = candidateGenerationInputSchema;
