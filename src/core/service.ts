import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  type ContentPackage,
  candidateGenerationInputSchema,
  type CandidateGenerationInput,
  type Composition,
  type ScheduleRuleUpdateInput,
  type ShortProject,
  type Template,
  type TranscriptSegment,
  type TranscriptRevision,
  type ProviderProvenance,
  type WatchedFolderConfigurationInput,
  type ManualCropControl,
  type CropReanalysisInput,
  type ManualCropAddInput,
  type ManualCropMoveInput,
  type ManualCropRemoveInput,
  type CaptionUpdateInput,
  type CaptionUpdateResult,
  type AudioUpdateInput,
  type AudioUpdateResult,
  compositionSchema,
  captionUpdateInputSchema,
  audioUpdateInputSchema,
  renderStartRequestSchema,
  scheduleMarkPublishedInputSchema,
  scheduleMoveInputSchema,
  scheduleRuleUpdateInputSchema,
  watchedFolderConfigurationInputSchema
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import { CANDIDATE_GENERATION_VERSION, generateCandidates } from "./candidates.js";
import type { Repository } from "./repository.js";
import type { MediaService } from "./media.js";
import type { JobQueue } from "./jobs.js";
import {
  draftSchedule,
  isLegalScheduleInstant,
  timezoneDatabaseVersion,
  type SchedulableShort
} from "./scheduler.js";
import { validateRender } from "./render.js";
import { sha256, type ArtifactStore } from "./artifact-store.js";
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
import {
  generateAutomaticCropTrack,
  visualCropArtifactSchema
} from "./crops.js";
import {
  CAPTION_ENGINE_VERSION,
  CaptionEngine,
  DEFAULT_CAPTION_STYLE,
  generateCaptionSidecars
} from "./captions.js";
import { deriveAudioWarnings } from "./audio.js";
import { RenderPreflightService } from "./render-preflight.js";

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
    readonly openAi?: OpenAiProvider,
    readonly captionEngine: CaptionEngine = new CaptionEngine(),
    readonly renderPreflights: RenderPreflightService = new RenderPreflightService(
      repository,
      captionEngine,
      {
        resolveOwnedPath: artifacts
          ? (relativePath) => artifacts.resolveOwnedPath(relativePath)
          : undefined
      }
    )
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
    let analysisArtifactId: string | null = null;
    let provider: ProviderProvenance | null = null;
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
      analysisArtifactId = artifact.id;
      provider = artifact.provenance;
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
    return this.repository.saveCandidateGeneration({
      episodeId: parsed.episodeId,
      transcriptRevision: transcript.revision,
      mode: parsed.mode,
      analysisArtifactId,
      provider,
      strategy: parsed.strategy,
      generationVersion: CANDIDATE_GENERATION_VERSION,
      requestedCount: parsed.count,
      proposals: result.candidates,
      diagnostic: result.diagnostic
    });
  }
  listCandidates(episodeId: string) { return this.repository.listCandidates(episodeId); }
  reviewCandidate(id: string, expectedRevision: number, status: "approved" | "rejected") {
    return this.repository.reviewCandidate(id, expectedRevision, status);
  }
  getCandidateContentPackage(id: string) {
    return this.repository.getCandidateContentPackage(id);
  }
  acceptCandidateContentPackage(
    id: string,
    expectedRevision: number,
    contentPackage: ContentPackage
  ) {
    return this.repository.acceptCandidateContentPackage(id, expectedRevision, contentPackage);
  }

  createShort(candidateId: string, templateId = "fullscreen-speaker-v1"): ShortProject {
    const candidate = this.repository.getCandidate(candidateId);
    if (candidate.reviewStatus !== "approved") {
      throw new AppError("INVALID_STATE", "Approve the candidate before creating a Short", 409);
    }
    if (candidate.state !== "active") {
      throw new AppError("INVALID_STATE", "Superseded Candidate cannot create a Short", 409);
    }
    const episode = this.repository.getEpisode(candidate.episodeId);
    if (episode.missing || episode.status === "source_missing") {
      throw new AppError("SOURCE_MISSING", "Episode source media is unavailable", 409, {
        episodeId: episode.id
      });
    }
    if (episode.durationMs === null) {
      throw new AppError("INVALID_STATE", "Episode duration is unknown", 409);
    }
    if (
      !Number.isInteger(candidate.startMs)
      || !Number.isInteger(candidate.endMs)
      || candidate.startMs < 0
      || candidate.endMs <= candidate.startMs
      || candidate.endMs > episode.durationMs
    ) {
      throw new AppError("VALIDATION_ERROR", "Candidate range is outside the Episode duration", 422, [{
        path: ["sourceRanges", 0],
        message: "Candidate range must be a positive integer millisecond range within the Episode duration"
      }]);
    }
    const transcript = this.repository.getAcceptedTranscriptRevision(candidate.episodeId);
    const candidateCopy = this.repository.getCandidateContentPackage(candidateId);
    const copy = candidateCopy.accepted ?? candidateCopy.proposed;
    const template = this.repository.getTemplate(templateId);
    this.validateCompositionAssets(template.composition);
    const now = new Date().toISOString();
    return this.repository.createShort({
      id: randomUUID(), episodeId: candidate.episodeId, candidateId, title: candidate.topic,
      sourceRanges: [{ startMs: candidate.startMs, endMs: candidate.endMs }],
      templateId,
      templateLineage: {
        templateId,
        templateVersion: template.version,
        parentTemplateId: template.parentTemplateId
      },
      composition: structuredClone(template.composition),
      captions: {
        enabled: true,
        cues: transcript.segments.filter((segment) =>
          segment.startMs >= candidate.startMs && segment.endMs <= candidate.endMs
        ).map((segment) => ({
          id: segment.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
          words: segment.words.map((word) => ({
            startMs: word.startMs, endMs: word.endMs, text: word.text
          }))
        })),
        style: structuredClone(DEFAULT_CAPTION_STYLE),
        warnings: [],
        sidecars: { srt: null, webvtt: null }
      },
      audio: {
        sourceGainDb: 0,
        sourceMuted: false,
        cutFadeMs: 0,
        bedAssetId: null,
        bedGainDb: null,
        warnings: []
      },
      copy,
      copyState: candidateCopy.accepted ? "accepted" : "proposed",
      copySource: candidateCopy.accepted ? "candidate_accepted" : "candidate_proposal",
      approved: false, revision: 1, createdAt: now, updatedAt: now
    });
  }
  getShort(id: string) { return this.repository.getShort(id); }
  updateComposition(id: string, expectedRevision: number, composition: Composition) {
    this.validateCompositionAssets(composition);
    return this.repository.updateShort(id, expectedRevision, { composition });
  }
  updateTimeline(
    id: string,
    expectedRevision: number,
    sourceRanges: ShortProject["sourceRanges"]
  ) {
    return this.repository.updateShortTimeline(id, expectedRevision, sourceRanges);
  }
  updateCopy(id: string, expectedRevision: number, copy: ShortProject["copy"]) {
    return this.repository.updateShort(id, expectedRevision, {
      copy, copyState: "accepted", copySource: "user_accepted"
    });
  }

  updateCaptions(id: string, input: CaptionUpdateInput): CaptionUpdateResult {
    const parsed = captionUpdateInputSchema.parse(input);
    const current = this.repository.getShort(id);
    if (current.revision !== parsed.expectedRevision) {
      throw new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
        expectedRevision: parsed.expectedRevision,
        actualRevision: current.revision
      });
    }
    if (!this.artifacts) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "Artifact store is required to save caption sidecars",
        503
      );
    }
    const analysis = this.captionEngine.analyze(
      parsed.cues,
      parsed.style,
      current.composition,
      current.sourceRanges,
      parsed.enabled
    );
    const sidecarBytes = generateCaptionSidecars(
      parsed.cues,
      current.sourceRanges,
      parsed.enabled
    );
    const nextRevision = parsed.expectedRevision + 1;
    const basePath = `artifacts/shorts/${id}/revisions/${nextRevision}`;
    const finalized = this.artifacts.finalizeBatch([
      {
        kind: "caption_srt",
        ownerType: "short",
        ownerId: id,
        ownerRevision: nextRevision,
        relativePath: `${basePath}/captions.srt`,
        producerVersion: CAPTION_ENGINE_VERSION,
        bytes: sidecarBytes.srt
      },
      {
        kind: "caption_webvtt",
        ownerType: "short",
        ownerId: id,
        ownerRevision: nextRevision,
        relativePath: `${basePath}/captions.vtt`,
        producerVersion: CAPTION_ENGINE_VERSION,
        bytes: sidecarBytes.webvtt
      }
    ], ([srt, webvtt]) => {
      if (!srt || !webvtt) {
        throw new AppError("INTERNAL_ERROR", "Caption sidecar batch is incomplete");
      }
      const sidecars = {
        srt: {
          artifactId: srt.id,
          format: "srt" as const,
          relativePath: srt.relativePath,
          contentHash: srt.contentHash,
          byteLength: srt.byteLength
        },
        webvtt: {
          artifactId: webvtt.id,
          format: "webvtt" as const,
          relativePath: webvtt.relativePath,
          contentHash: webvtt.contentHash,
          byteLength: webvtt.byteLength
        }
      };
      const short = this.repository.updateShortCaptions(id, parsed.expectedRevision, {
        enabled: parsed.enabled,
        cues: parsed.cues,
        style: parsed.style,
        warnings: analysis.warnings,
        sidecars
      });
      return { short, warnings: analysis.warnings, sidecars };
    });
    return finalized.value;
  }
  updateAudio(id: string, input: AudioUpdateInput): AudioUpdateResult {
    const parsed = audioUpdateInputSchema.parse(input);
    const current = this.repository.getShort(id);
    if (current.revision !== parsed.expectedRevision) {
      throw new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
        expectedRevision: parsed.expectedRevision,
        actualRevision: current.revision
      });
    }
    if (parsed.bedAssetId !== null) {
      let asset;
      try {
        asset = this.repository.getAsset(parsed.bedAssetId);
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_FOUND") {
          throw new AppError("VALIDATION_ERROR", "Audio bed asset does not exist", 422, [{
            path: ["bedAssetId"],
            message: "Select an existing audio asset"
          }]);
        }
        throw error;
      }
      if (asset.kind !== "audio") {
        throw new AppError("VALIDATION_ERROR", "Audio bed must reference an audio asset", 422, [{
          path: ["bedAssetId"],
          message: "Asset kind must be audio"
        }]);
      }
    }
    const settings = {
      sourceGainDb: parsed.sourceGainDb,
      sourceMuted: parsed.sourceMuted,
      cutFadeMs: parsed.cutFadeMs,
      bedAssetId: parsed.bedAssetId,
      bedGainDb: parsed.bedGainDb
    };
    const warnings = deriveAudioWarnings(settings);
    const short = this.repository.updateShortAudio(id, parsed.expectedRevision, {
      ...settings,
      warnings
    });
    return { short, warnings };
  }
  approveShort(id: string, expectedRevision: number) {
    return this.repository.approveShort(id, expectedRevision);
  }
  reanalyzeCrops(id: string, input: CropReanalysisInput) {
    const project = this.repository.getShort(id);
    if (project.revision !== input.expectedRevision) {
      throw new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
        expectedRevision: input.expectedRevision,
        actualRevision: project.revision
      });
    }
    if (!this.artifacts) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Artifact store is unavailable", 503);
    }
    const selected = input.layerIds ? new Set(input.layerIds) : null;
    const videoLayers = project.composition.layers.filter((layer) => layer.type === "video");
    if (selected) {
      const available = new Set(videoLayers.map((layer) => layer.id));
      const invalid = input.layerIds!.filter((layerId) => !available.has(layerId));
      if (invalid.length) {
        throw new AppError("VALIDATION_ERROR", "Crop re-analysis requires video layer IDs", 422, {
          layerIds: invalid
        });
      }
    }
    const candidates = [...this.repository.listArtifactRecords(project.episodeId)]
      .filter((artifact) =>
        artifact.kind === "analysis_visual_input" && artifact.state === "complete"
      )
      .reverse();
    if (!candidates.length) {
      throw new AppError("INVALID_STATE", "No complete visual-sampling artifact is available", 409);
    }
    let selectedArtifact: {
      record: (typeof candidates)[number];
      visual: ReturnType<typeof visualCropArtifactSchema.parse>;
    } | null = null;
    for (const record of candidates) {
      try {
        const bytes = readFileSync(this.artifacts.resolveOwnedPath(record.relativePath));
        const contentHash = sha256(bytes);
        if (contentHash !== record.contentHash) continue;
        selectedArtifact = {
          record,
          visual: visualCropArtifactSchema.parse(JSON.parse(bytes.toString("utf8")))
        };
        break;
      } catch {
        // Continue to the next-newest complete, valid visual input.
      }
    }
    if (!selectedArtifact) {
      throw new AppError("INVALID_STATE", "No valid visual-sampling artifact is available", 409);
    }
    const artifactRecord = selectedArtifact.record;
    const visual = selectedArtifact.visual;
    const episode = this.repository.getEpisode(project.episodeId);
    const outputDurationMs = project.sourceRanges.reduce(
      (total, range) => total + range.endMs - range.startMs,
      0
    );
    const generatedAt = new Date().toISOString();
    const composition = compositionSchema.parse({
      ...project.composition,
      layers: project.composition.layers.map((layer) => {
        if (layer.type !== "video" || (selected && !selected.has(layer.id))) return layer;
        const asset = layer.source === "asset" && layer.assetId
          ? this.repository.getAsset(layer.assetId)
          : null;
        return {
          ...layer,
          automaticCropTrack: generateAutomaticCropTrack({
            layer,
            sourceRanges: project.sourceRanges,
            outputDurationMs,
            sourceWidth: asset?.width ?? episode.width,
            sourceHeight: asset?.height ?? episode.height,
            artifactId: artifactRecord.id,
            artifactContentHash: artifactRecord.contentHash,
            artifact: visual,
            generatedAt
          })
        };
      })
    });
    return this.repository.updateShort(id, input.expectedRevision, { composition });
  }
  addManualCropControl(id: string, layerId: string, input: ManualCropAddInput) {
    return this.mutateManualCropTrack(id, layerId, input.expectedRevision, (track, durationMs) => {
      if (input.control.atMs > durationMs) {
        throw cropTimestampError(input.control.atMs, durationMs);
      }
      if (track.some((control) => control.id === input.control.id)) {
        throw new AppError("VALIDATION_ERROR", "Manual crop control ID already exists", 422);
      }
      if (track.some((control) => control.atMs === input.control.atMs)) {
        throw new AppError("VALIDATION_ERROR", "Manual crop timestamp already exists", 422);
      }
      return [...track, input.control].sort((a, b) => a.atMs - b.atMs);
    });
  }
  moveManualCropControl(id: string, layerId: string, input: ManualCropMoveInput) {
    return this.mutateManualCropTrack(id, layerId, input.expectedRevision, (track, durationMs) => {
      if (input.atMs > durationMs) throw cropTimestampError(input.atMs, durationMs);
      const index = track.findIndex((control) => control.id === input.controlId);
      if (index < 0) throw new AppError("NOT_FOUND", "Manual crop control not found", 404);
      if (track.some((control, other) => other !== index && control.atMs === input.atMs)) {
        throw new AppError("VALIDATION_ERROR", "Manual crop timestamp already exists", 422);
      }
      const existing = track[index]!;
      if (input.crop && existing.mode !== "crop") {
        throw new AppError("VALIDATION_ERROR", "Automatic-resume controls do not have rectangles", 422);
      }
      const updated: ManualCropControl = existing.mode === "crop"
        ? { ...existing, atMs: input.atMs, ...(input.crop ?? {}) }
        : { ...existing, atMs: input.atMs };
      return track.map((control, other) => other === index ? updated : control)
        .sort((a, b) => a.atMs - b.atMs);
    });
  }
  removeManualCropControl(id: string, layerId: string, input: ManualCropRemoveInput) {
    return this.mutateManualCropTrack(id, layerId, input.expectedRevision, (track) => {
      if (!track.some((control) => control.id === input.controlId)) {
        throw new AppError("NOT_FOUND", "Manual crop control not found", 404);
      }
      return track.filter((control) => control.id !== input.controlId);
    });
  }

  private mutateManualCropTrack(
    id: string,
    layerId: string,
    expectedRevision: number,
    mutate: (track: ManualCropControl[], durationMs: number) => ManualCropControl[]
  ) {
    const project = this.repository.getShort(id);
    if (project.revision !== expectedRevision) {
      throw new AppError("REVISION_CONFLICT", "Short was edited by another client", 409, {
        expectedRevision,
        actualRevision: project.revision
      });
    }
    const durationMs = project.sourceRanges.reduce(
      (total, range) => total + range.endMs - range.startMs,
      0
    );
    let found = false;
    const composition = compositionSchema.parse({
      ...project.composition,
      layers: project.composition.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        if (layer.type !== "video") {
          throw new AppError("VALIDATION_ERROR", "Crop controls are valid only for video layers", 422);
        }
        found = true;
        return {
          ...layer,
          manualCropTrack: mutate(structuredClone(layer.manualCropTrack), durationMs)
        };
      })
    });
    if (!found) throw new AppError("NOT_FOUND", "Composition layer not found", 404);
    return this.repository.updateShort(id, expectedRevision, { composition });
  }

  listTemplates() { return this.repository.listTemplates(); }
  cloneTemplate(sourceId: string, name: string, description?: string): Template {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new AppError("VALIDATION_ERROR", "Template name is required", 422);
    }
    const source = this.repository.getTemplate(sourceId);
    const now = new Date().toISOString();
    return this.repository.createTemplate({
      id: randomUUID(),
      name: normalizedName,
      description: description ?? source.description,
      version: 1,
      revision: 1,
      parentTemplateId: source.id,
      builtIn: false,
      composition: structuredClone(source.composition),
      createdAt: now,
      updatedAt: now
    });
  }
  updateTemplate(
    id: string,
    expectedRevision: number,
    patch: Pick<Partial<Template>, "name" | "description" | "composition">
  ): Template {
    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.composition === undefined
    ) {
      throw new AppError("VALIDATION_ERROR", "At least one template change is required", 422);
    }
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new AppError("VALIDATION_ERROR", "Template name is required", 422);
    }
    if (patch.composition !== undefined) {
      this.validateCompositionAssets(patch.composition);
    }
    return this.repository.updateTemplate(id, expectedRevision, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.composition === undefined
        ? {}
        : { composition: structuredClone(patch.composition) })
    });
  }
  listAssets() {
    return this.repository.listAssets();
  }
  async importAsset(path: string, provenance: string, reusable: boolean) {
    const normalizedProvenance = provenance.trim();
    if (!normalizedProvenance) {
      throw new AppError("VALIDATION_ERROR", "Asset provenance is required", 422);
    }
    const inspected = await this.media.inspectAsset(path);
    const now = new Date().toISOString();
    const asset = {
      id: randomUUID(),
      sourcePath: inspected.sourcePath,
      ownedArtifactPath: null,
      kind: inspected.kind,
      provenance: normalizedProvenance,
      reusable,
      tags: [],
      width: inspected.width,
      height: inspected.height,
      durationMs: inspected.durationMs,
      createdAt: now,
      updatedAt: now
    };
    return this.repository.saveAsset(asset);
  }
  private validateCompositionAssets(composition: Composition): void {
    for (const [index, layer] of composition.layers.entries()) {
      if (layer.assetId === null) continue;
      if (layer.source !== "asset") {
        throw new AppError("VALIDATION_ERROR", "Bound asset layers must use asset source", 422, [{
          path: ["composition", "layers", index, "assetId"],
          message: "assetId is only valid for asset-sourced layers"
        }]);
      }
      const asset = this.repository.getAsset(layer.assetId);
      if (
        (layer.type === "image" && asset.kind === "image") ||
        (layer.type === "video" && asset.kind === "video") ||
        (layer.type === "logo" && asset.kind === "logo")
      ) continue;
      throw new AppError("VALIDATION_ERROR", "Asset kind does not match composition layer type", 422, [{
        path: ["composition", "layers", index, "assetId"],
        message: `Expected ${layer.type} asset, received ${asset.kind}`
      }]);
    }
  }
  listRenders(shortId?: string) {
    return this.repository.listRenders(shortId);
  }
  preflightRender(shortId: string, expectedRevision: number) {
    return this.renderPreflights.preflight(shortId, expectedRevision);
  }
  getRenderPreflight(id: string) {
    return this.repository.getRenderPreflight(id).result;
  }
  listRenderPreflights(shortId?: string) {
    return this.repository.listRenderPreflights(shortId);
  }
  startRenderAttempt(input: unknown) {
    return this.repository.startRenderAttempt(renderStartRequestSchema.parse(input));
  }
  retryRenderAttempt(renderId: string) {
    return this.repository.retryRenderAttempt(renderId);
  }
  validateRender(path: string) { return validateRender(path); }
  getScheduleRules() {
    return this.repository.getScheduleRuleSet("default");
  }
  updateScheduleRules(rawInput: ScheduleRuleUpdateInput | unknown) {
    const parsed = scheduleRuleUpdateInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid schedule rules", 422, parsed.error.issues);
    }
    const input = parsed.data;
    const { expectedRevision, ...uncanonicalized } = input;
    const rules = {
      ...uncanonicalized,
      allowedWeekdays: [...uncanonicalized.allowedWeekdays].sort((left, right) => left - right),
      times: [...uncanonicalized.times].sort(),
      blackoutDates: [...uncanonicalized.blackoutDates].sort()
    };
    const now = new Date().toISOString();
    const tzVersion = timezoneDatabaseVersion();
    try {
      return this.repository.transaction(() => {
        const current = this.repository.findScheduleRuleSet("default");
        if (!current) {
          if (expectedRevision !== undefined) {
            throw new AppError(
              "REVISION_CONFLICT",
              "Schedule rule set must be reloaded before it is created",
              409,
              { expectedRevision, actualRevision: 0 }
            );
          }
          return this.repository.createScheduleRuleSet({
            id: "default",
            revision: 1,
            ...rules,
            timezoneDatabaseVersion: tzVersion,
            createdAt: now,
            updatedAt: now
          });
        }
        if (expectedRevision === undefined) {
          throw new AppError(
            "VALIDATION_ERROR",
            "expectedRevision is required when replacing schedule rules",
            422,
            [{ path: ["expectedRevision"], message: "Reload rules and provide their revision" }]
          );
        }
        return this.repository.updateScheduleRuleSet("default", expectedRevision, {
          ...rules,
          timezoneDatabaseVersion: tzVersion
        });
      });
    } catch (error) {
      if (
        !(error instanceof AppError) &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        String(error.code).startsWith("SQLITE_CONSTRAINT")
      ) {
        const actualRevision = this.repository.findScheduleRuleSet("default")?.revision ?? 0;
        throw new AppError(
          "REVISION_CONFLICT",
          "Schedule rule set was created by another client; reload it",
          409,
          { expectedRevision: null, actualRevision }
        );
      }
      throw error;
    }
  }
  draftSchedule(shorts: SchedulableShort[], expectedRulesRevision: number) {
    return this.repository.transaction(() => {
      const rules = this.repository.getScheduleRuleSet("default");
      if (rules.revision !== expectedRulesRevision) {
        throw new AppError(
          "REVISION_CONFLICT",
          "Schedule rule set was edited by another client",
          409,
          { expectedRevision: expectedRulesRevision, actualRevision: rules.revision }
        );
      }
      const shortIds = new Set<string>();
      const renderIds = new Set<string>();
      for (const item of shorts) {
        if (shortIds.has(item.shortId) || renderIds.has(item.renderId)) {
          throw new AppError("INVALID_STATE", "A Short or Render may appear only once in a draft", 409);
        }
        shortIds.add(item.shortId);
        renderIds.add(item.renderId);
        const eligible = this.repository.db.prepare(`
          SELECT 1 FROM renders r JOIN short_projects s ON s.id=r.short_id
          WHERE r.id=? AND r.short_id=? AND r.state='succeeded' AND r.project_revision=s.revision
            AND s.episode_id=? AND s.approved=1
            AND json_extract(r.validation_json, '$.valid')=1
            AND json_extract(r.determinism_json, '$.comparison') IN ('baseline','matched')
        `).get(item.renderId, item.shortId, item.episodeId);
        if (!eligible) throw new AppError(
          "INVALID_STATE", `Short ${item.shortId} needs an approved current validated render`, 409
        );
        if (this.repository.db.prepare(
          "SELECT 1 FROM schedule_entries WHERE short_id=?"
        ).get(item.shortId)) {
          throw new AppError("INVALID_STATE", `Short ${item.shortId} is already scheduled`, 409);
        }
      }
      const occupiedEntries = this.repository.listScheduleEntries().map((entry) => ({
        publishAt: entry.publishAt,
        episodeId: entry.episodeId
      }));
      const result = draftSchedule(
        shorts,
        rules,
        occupiedEntries.map((entry) => entry.publishAt),
        rules.revision,
        occupiedEntries
      );
      const now = new Date().toISOString();
      const insert = this.repository.db.prepare(`
        INSERT INTO schedule_entries(id,short_id,render_id,episode_id,publish_at,timezone,status,
          priority,rationale,locked,youtube_url,needs_rerender,revision,created_at,updated_at)
        VALUES(@id,@shortId,@renderId,@episodeId,@publishAt,@timezone,'draft',
          @priority,@rationale,0,NULL,0,1,@now,@now)
      `);
      result.entries.forEach((entry) => insert.run({ ...entry, now }));
      return result;
    });
  }
  getSchedule() {
    return this.repository.listScheduleEntries();
  }
  moveScheduleEntry(entryId: string, expectedRevision: number, publishAt: string) {
    ({ expectedRevision, publishAt } = scheduleMoveInputSchema.parse({
      expectedRevision,
      publishAt
    }));
    return this.repository.transaction(() => {
      const entry = this.repository.getScheduleEntry(entryId);
      if (entry.revision !== expectedRevision) {
        throw new AppError("REVISION_CONFLICT", "Schedule entry revision is stale", 409, {
          expectedRevision,
          actualRevision: entry.revision
        });
      }
      if (entry.locked || entry.status === "published") {
        throw new AppError("INVALID_STATE", "Published schedule entries are permanently locked", 409);
      }
      const rules = this.repository.getScheduleRuleSet("default");
      const normalized = new Date(publishAt).toISOString();
      if (!isLegalScheduleInstant(normalized, rules)) {
        throw new AppError(
          "INVALID_STATE",
          "The requested instant is not legal under the current schedule rules",
          409
        );
      }
      const entries = this.repository.listScheduleEntries().filter((other) => other.id !== entryId);
      if (entries.some((other) => other.publishAt === normalized)) {
        throw new AppError("SCHEDULE_COLLISION", "Another entry already occupies that instant", 409);
      }
      const spacingMs = rules.minimumSameEpisodeSpacingHours * 3_600_000;
      const targetTime = new Date(normalized).getTime();
      if (entries.some((other) =>
        other.episodeId === entry.episodeId &&
        Math.abs(new Date(other.publishAt).getTime() - targetTime) < spacingMs
      )) {
        throw new AppError(
          "SCHEDULE_COLLISION",
          "The requested instant violates minimum same-Episode spacing",
          409
        );
      }
      return this.repository.updateScheduleEntry(entryId, expectedRevision, {
        publishAt: normalized,
        timezone: rules.timezone,
        status: "planned",
        rationale: "Manually planned at a legal slot under the current schedule rules."
      });
    });
  }
  markPublished(entryId: string, expectedRevision: number, youtubeUrl?: string) {
    ({ expectedRevision, youtubeUrl } = scheduleMarkPublishedInputSchema.parse({
      expectedRevision,
      youtubeUrl
    }));
    return this.repository.transaction(() => {
      const entry = this.repository.getScheduleEntry(entryId);
      if (entry.revision !== expectedRevision) {
        throw new AppError("REVISION_CONFLICT", "Schedule entry revision is stale", 409, {
          expectedRevision,
          actualRevision: entry.revision
        });
      }
      if (entry.locked || entry.status === "published") {
        throw new AppError("INVALID_STATE", "Published schedule entries are permanently locked", 409);
      }
      if (entry.needsRerender) {
        throw new AppError(
          "INVALID_STATE",
          "A schedule entry that needs rerendering cannot be published",
          409
        );
      }
      return this.repository.updateScheduleEntry(entryId, expectedRevision, {
        status: "published",
        youtubeUrl: youtubeUrl ?? null
      });
    });
  }
}

function cropTimestampError(atMs: number, durationMs: number): AppError {
  return new AppError("VALIDATION_ERROR", "Crop timestamp exceeds the Short output duration", 422, {
    atMs,
    durationMs
  });
}

export const importPathsInput = z.strictObject({ paths: z.array(z.string()).min(1) });
export const watchedFolderConfigurationInput = watchedFolderConfigurationInputSchema;
export const relinkSourceInput = z.strictObject({
  candidatePath: z.string().min(1)
});
export const confirmRelinkInput = z.strictObject({
  confirmationToken: z.string().min(1)
});
export const candidateGenerateInput = candidateGenerationInputSchema;
