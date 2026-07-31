import type {
  ApiErrorCode,
  ApiResult,
  AnalysisArtifact,
  Candidate,
  CandidateContentPackage,
  CandidateGenerationInput,
  CandidateGenerationResult,
  Asset,
  AudioUpdateResult,
  CaptionUpdateResult,
  Composition,
  ContentPackage,
  Episode,
  ImportRejectedResult,
  Job,
  OllamaEndpointStatus,
  Page,
  ProviderCapability,
  ProviderStatus,
  Render,
  RenderPreflightResult,
  RenderStartRequest,
  RenderStartResult,
  ScheduleDraftResult,
  ScheduleEntry,
  ScheduleRuleSet,
  ScheduleRules,
  SchedulableShort,
  ShortProject,
  Template,
  RelinkSourceResult,
  TranscriptRevision,
  TranscriptUpdateInput,
  WatchedFolder,
  WatchedFolderConfigurationInput
} from "../shared/domain";

const coreUrl = "http://127.0.0.1:43120/v1";

interface ErrorEnvelope {
  apiVersion: "v1";
  error: {
    code: ApiErrorCode;
    message: string;
    details: unknown;
    retryable: boolean;
  };
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: unknown,
    public readonly retryable: boolean,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${coreUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const body = await response.json() as ApiResult<T> | ErrorEnvelope;
  if (!response.ok) {
    const failure = (body as ErrorEnvelope).error;
    throw new ApiClientError(
      failure?.code ?? "INTERNAL_ERROR",
      failure?.message ?? `Request failed (${response.status})`,
      failure?.details ?? null,
      failure?.retryable ?? false,
      response.status
    );
  }
  return (body as ApiResult<T>).data;
}

async function requestAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const page: Page<T> = await request<Page<T>>(
      cursor === null ? path : `${path}${separator}cursor=${encodeURIComponent(cursor)}`
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

export interface ImportBatchResult {
  imported: Episode[];
  duplicates: Episode[];
  relinked: Episode[];
  rejected: ImportRejectedResult[];
}

export interface TranscriptionOptions {
  episodeId: string;
  provider: "local" | "openai";
  modelId: string;
  wordTimestamps: boolean;
  speechMode?: "transcription" | "diarization";
}

export const api = {
  episodes: (search = "") =>
    requestAll<Episode>(`/library/episodes?search=${encodeURIComponent(search)}`),
  watchedFolders: () => requestAll<WatchedFolder>("/library/watched-folders"),
  jobs: () => requestAll<Job>("/jobs"),
  importPaths: (paths: string[]) => request<ImportBatchResult>("/library/import", {
    method: "POST", body: JSON.stringify({ paths })
  }),
  configureWatchedFolder: (input: WatchedFolderConfigurationInput) =>
    request<WatchedFolder | Job>("/library/watched-folders/configure", {
      method: "POST", body: JSON.stringify(input)
    }),
  rescanWatchedFolder: (folderId: string) =>
    request<Job>(`/library/watched-folders/${encodeURIComponent(folderId)}/rescan`, {
      method: "POST", body: "{}"
    }),
  relinkSource: (episodeId: string, candidatePath: string) =>
    request<RelinkSourceResult>(`/library/episodes/${encodeURIComponent(episodeId)}/relink`, {
      method: "POST", body: JSON.stringify({ candidatePath })
    }),
  confirmRelink: (episodeId: string, confirmationToken: string) =>
    request<Episode>(`/library/episodes/${encodeURIComponent(episodeId)}/relink/confirm`, {
      method: "POST", body: JSON.stringify({ confirmationToken })
    }),
  providerCapabilities: () => request<ProviderCapability[]>("/providers/capabilities"),
  providerStatus: (episodeId: string) =>
    request<ProviderStatus[]>(`/providers/status?episodeId=${encodeURIComponent(episodeId)}`),
  ollamaStatus: (baseUrl: string) =>
    request<OllamaEndpointStatus>(
      `/analysis/ollama/status?baseUrl=${encodeURIComponent(baseUrl)}`
    ),
  transcript: (episodeId: string) =>
    request<TranscriptRevision>(`/analysis/${encodeURIComponent(episodeId)}/transcript`),
  analysisArtifacts: (episodeId: string) =>
    requestAll<AnalysisArtifact>(`/analysis/${encodeURIComponent(episodeId)}/artifacts`),
  updateTranscript: (episodeId: string, input: TranscriptUpdateInput) =>
    request<TranscriptRevision>(`/analysis/${encodeURIComponent(episodeId)}/transcript`, {
      method: "PUT", body: JSON.stringify(input)
    }),
  candidates: (episodeId: string) =>
    requestAll<Candidate>(`/candidates?episodeId=${encodeURIComponent(episodeId)}`),
  shorts: (episodeId?: string) => requestAll<ShortProject>(
    `/shorts${episodeId ? `?episodeId=${encodeURIComponent(episodeId)}` : ""}`
  ),
  short: (shortId: string) =>
    request<ShortProject>(`/shorts/${encodeURIComponent(shortId)}`),
  approveShort: (shortId: string, expectedRevision: number) =>
    request<ShortProject>(`/shorts/${encodeURIComponent(shortId)}/approve`, {
      method: "POST", body: JSON.stringify({ expectedRevision })
    }),
  createShort: (candidateId: string, templateId: string) =>
    request<ShortProject>("/shorts", {
      method: "POST", body: JSON.stringify({ candidateId, templateId })
    }),
  templates: () => requestAll<Template>("/templates"),
  cloneTemplate: (templateId: string, name: string, description?: string) =>
    request<Template>(`/templates/${encodeURIComponent(templateId)}/clone`, {
      method: "POST", body: JSON.stringify({ name, ...(description ? { description } : {}) })
    }),
  updateTemplate: (
    templateId: string,
    expectedRevision: number,
    patch: { name?: string; description?: string; composition?: Composition }
  ) => request<Template>(`/templates/${encodeURIComponent(templateId)}`, {
    method: "PUT", body: JSON.stringify({ expectedRevision, ...patch })
  }),
  assets: () => requestAll<Asset>("/assets"),
  renders: (shortId?: string) => requestAll<Render>(
    `/renders${shortId ? `?shortId=${encodeURIComponent(shortId)}` : ""}`
  ),
  preflightRender: (shortId: string, expectedRevision: number) =>
    request<RenderPreflightResult>("/renders/preflight", {
      method: "POST", body: JSON.stringify({ shortId, expectedRevision })
    }),
  startRender: (
    shortId: string,
    expectedRevision: number,
    preflightId: string,
    sidecarFormat: RenderStartRequest["sidecarFormat"]
  ) => request<RenderStartResult>("/renders/start", {
    method: "POST",
    body: JSON.stringify({ shortId, expectedRevision, preflightId, sidecarFormat })
  }),
  retryRender: (renderId: string) =>
    request<RenderStartResult>(`/renders/${encodeURIComponent(renderId)}/retry`, {
      method: "POST", body: "{}"
    }),
  scheduleRules: () => request<ScheduleRuleSet>("/schedule/rules"),
  updateScheduleRules: (rules: ScheduleRules, expectedRevision?: number) =>
    request<ScheduleRuleSet>("/schedule/rules", {
      method: "PUT",
      body: JSON.stringify({
        ...rules,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
      })
    }),
  scheduleEntries: () => requestAll<ScheduleEntry>("/schedule"),
  draftSchedule: (shorts: SchedulableShort[], expectedRulesRevision: number) =>
    request<ScheduleDraftResult>("/schedule/draft", {
      method: "POST", body: JSON.stringify({ shorts, expectedRulesRevision })
    }),
  moveScheduleEntry: (entryId: string, expectedRevision: number, publishAt: string) =>
    request<ScheduleEntry>(`/schedule/${encodeURIComponent(entryId)}/move`, {
      method: "POST", body: JSON.stringify({ expectedRevision, publishAt })
    }),
  markSchedulePublished: (
    entryId: string,
    expectedRevision: number,
    youtubeUrl?: string
  ) => request<ScheduleEntry>(`/schedule/${encodeURIComponent(entryId)}/published`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevision,
      ...(youtubeUrl === undefined ? {} : { youtubeUrl })
    })
  }),
  importAsset: (path: string, provenance: string, reusable: boolean) =>
    request<Asset>("/assets/import", {
      method: "POST", body: JSON.stringify({ path, provenance, reusable })
    }),
  updateTimeline: (
    shortId: string,
    expectedRevision: number,
    sourceRanges: ShortProject["sourceRanges"]
  ) => request<ShortProject>(`/shorts/${encodeURIComponent(shortId)}/timeline`, {
    method: "PUT", body: JSON.stringify({ expectedRevision, sourceRanges })
  }),
  updateComposition: (
    shortId: string,
    expectedRevision: number,
    composition: Composition
  ) => request<ShortProject>(`/shorts/${encodeURIComponent(shortId)}/composition`, {
    method: "PUT", body: JSON.stringify({ expectedRevision, composition })
  }),
  updateCaptions: (
    shortId: string,
    expectedRevision: number,
    captions: Pick<ShortProject["captions"], "enabled" | "cues" | "style">
  ) => request<CaptionUpdateResult>(`/shorts/${encodeURIComponent(shortId)}/captions`, {
    method: "PUT", body: JSON.stringify({ expectedRevision, ...captions })
  }),
  updateAudio: (
    shortId: string,
    expectedRevision: number,
    audio: Omit<ShortProject["audio"], "warnings">
  ) => request<AudioUpdateResult>(`/shorts/${encodeURIComponent(shortId)}/audio`, {
    method: "PUT", body: JSON.stringify({ expectedRevision, ...audio })
  }),
  reanalyzeCrops: (shortId: string, expectedRevision: number, layerIds?: string[]) =>
    request<ShortProject>(`/shorts/${encodeURIComponent(shortId)}/crops/reanalyze`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision, ...(layerIds ? { layerIds } : {}) })
    }),
  generateCandidates: (input: CandidateGenerationInput) =>
    request<CandidateGenerationResult>("/candidates/generate", {
      method: "POST", body: JSON.stringify(input)
    }),
  reviewCandidate: (
    candidateId: string,
    expectedRevision: number,
    status: Exclude<Candidate["reviewStatus"], "pending">
  ) => request<Candidate>(`/candidates/${encodeURIComponent(candidateId)}/review`, {
    method: "POST", body: JSON.stringify({ expectedRevision, status })
  }),
  candidateContentPackage: (candidateId: string) =>
    request<CandidateContentPackage>(
      `/candidates/${encodeURIComponent(candidateId)}/content-package`
    ),
  acceptCandidateContentPackage: (
    candidateId: string,
    expectedRevision: number,
    contentPackage: ContentPackage
  ) => request<CandidateContentPackage>(
    `/candidates/${encodeURIComponent(candidateId)}/content-package`,
    {
      method: "PUT",
      body: JSON.stringify({ expectedRevision, contentPackage })
    }
  ),
  startTranscription: (options: TranscriptionOptions) => request<Job>("/analysis/start", {
    method: "POST",
    body: JSON.stringify({
      episodeId: options.episodeId,
      provider: options.provider,
      modelId: options.modelId,
      wordTimestamps: options.wordTimestamps,
      ...(options.provider === "openai" ? { speechMode: options.speechMode } : {})
    })
  }),
  startOllamaAnalysis: (input: {
    episodeId: string;
    baseUrl: string;
    modelId: string;
    networkDisclosed?: boolean;
  }) => request<Job>("/analysis/ollama/start", {
    method: "POST", body: JSON.stringify(input)
  }),
  startOpenAiAnalysis: (episodeId: string, modelId: string) =>
    request<Job>("/analysis/openai/start", {
      method: "POST", body: JSON.stringify({ episodeId, modelId })
    }),
  cancelJob: (jobId: string) => request<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST", body: "{}"
  })
};
