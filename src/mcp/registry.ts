import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
  assetImportInputSchema,
  assetSchema,
  audioUpdateInputSchema,
  audioUpdateResultSchema,
  candidateGenerationResultSchema,
  candidateSchema,
  captionUpdateInputSchema,
  captionUpdateResultSchema,
  compositionSchema,
  contentPackageSchema,
  cropDetectionObservationSchema,
  cropReanalysisInputSchema,
  episodeSchema,
  importResultSchema,
  jobSchema,
  manualCropControlSchema,
  pageSchema,
  providerCapabilityListSchema,
  providerStatusListSchema,
  relinkSourceResultSchema,
  renderPreflightRequestSchema,
  renderPreflightResultSchema,
  renderProbeValidationSchema,
  renderSchema,
  renderStartRequestSchema,
  renderStartResultSchema,
  scheduleDraftInputSchema,
  scheduleDraftResultSchema,
  scheduleEntrySchema,
  scheduleMarkPublishedInputSchema,
  scheduleMoveInputSchema,
  scheduleRuleSetSchema,
  scheduleRuleUpdateInputSchema,
  shortProjectSchema,
  sourceRangesSchema,
  templateCloneInputSchema,
  templateSchema,
  templateUpdateInputSchema,
  transcriptRevisionSchema,
  transcriptUpdateSegmentsSchema,
  watchedFolderConfigurationInputSchema,
  watchedFolderConfigurationResultSchema,
  watchedFolderSchema
} from "../shared/domain.js";

export type McpHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface McpHttpRequest {
  method: McpHttpMethod;
  path: string;
  body?: unknown;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly successSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: false;
    readonly idempotentHint: boolean;
    readonly openWorldHint: true;
  };
  readonly http: {
    readonly operationId: string;
    readonly method: McpHttpMethod;
    readonly path: string;
  };
  readonly request: (input: Record<string, unknown>) => McpHttpRequest;
}

const uuid = z.string().uuid();
const expectedRevision = z.number().int().positive();
const emptyInput = z.strictObject({});
const pagingFields = {
  limit: z.number().int().min(1).max(1_000).optional(),
  cursor: z.string().min(1).optional()
};
const pageInput = z.strictObject(pagingFields);
const episodeListInput = z.strictObject({ search: z.string().optional(), ...pagingFields });
const candidateListInput = z.strictObject({ episodeId: uuid, ...pagingFields });
const shortListInput = z.strictObject({ episodeId: uuid.optional(), ...pagingFields });
const renderListInput = z.strictObject({ shortId: uuid.optional(), ...pagingFields });
const providerStatusInput = z.strictObject({
  episodeId: uuid.optional(),
  authorizationBatchId: uuid.optional()
});
const watchedFolderConfigurationToolInput = z.strictObject({
  action: z.enum(["create", "update", "rescan"]),
  folderId: uuid.optional(),
  path: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  recursive: z.boolean().optional(),
  includePatterns: z.array(z.string().min(1)).optional()
}).superRefine((input, context) => {
  const parsed = watchedFolderConfigurationInputSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message
      });
    }
  }
});
const candidateGenerationToolInput = z.strictObject({
  episodeId: uuid,
  count: z.number().int().min(5).max(10).default(8),
  strategy: z.enum(["replace_pending", "append_pending"]),
  mode: z.enum(["heuristic", "analysis"]).default("heuristic"),
  analysisArtifactId: uuid.optional()
}).superRefine((input, context) => {
  if (input.mode === "analysis" && input.analysisArtifactId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["analysisArtifactId"],
      message: "Analysis mode requires an analysisArtifactId"
    });
  }
  if (input.mode === "heuristic" && input.analysisArtifactId !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["analysisArtifactId"],
      message: "Heuristic mode does not accept an analysisArtifactId"
    });
  }
});
const analysisStartInput = z.strictObject({
  episodeId: uuid,
  provider: z.enum(["local", "openai"]).default("local"),
  modelId: z.string().min(1).optional(),
  wordTimestamps: z.boolean().optional(),
  speechMode: z.enum(["transcription", "diarization"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
  authorizationBatchId: uuid.optional()
});
const transcriptReadInput = z.strictObject({
  episodeId: uuid,
  revision: expectedRevision.optional()
});
const transcriptUpdateInput = z.strictObject({
  episodeId: uuid,
  expectedRevision,
  language: z.string().trim().min(2),
  segments: transcriptUpdateSegmentsSchema
});
const candidateReviewInput = z.strictObject({
  candidateId: uuid,
  expectedRevision,
  status: z.enum(["approved", "rejected"])
});
const shortCreateInput = z.strictObject({
  candidateId: uuid,
  templateId: z.string().min(1).optional()
});
const compositionUpdateInput = z.strictObject({
  shortId: uuid,
  expectedRevision,
  composition: compositionSchema
});
const timelineUpdateInput = z.strictObject({
  shortId: uuid,
  expectedRevision,
  sourceRanges: sourceRangesSchema
});
const captionsUpdateInput = z.strictObject({
  shortId: uuid,
  ...captionUpdateInputSchema.shape
});
const audioUpdateToolInput = z.strictObject({
  shortId: uuid,
  ...audioUpdateInputSchema.shape
});
const copyUpdateInput = z.strictObject({
  shortId: uuid,
  expectedRevision,
  copy: contentPackageSchema
});
const shortRevisionInput = z.strictObject({ shortId: uuid, expectedRevision });
const cropReanalysisToolInput = z.strictObject({
  shortId: uuid,
  ...cropReanalysisInputSchema.shape
});
const manualCropAddToolInput = z.strictObject({
  shortId: uuid,
  layerId: z.string().min(1),
  expectedRevision,
  control: manualCropControlSchema
});
const manualCropMoveToolInput = z.strictObject({
  shortId: uuid,
  layerId: z.string().min(1),
  expectedRevision,
  controlId: uuid,
  atMs: z.number().int().nonnegative(),
  crop: cropDetectionObservationSchema.omit({ confidence: true }).optional()
});
const manualCropRemoveToolInput = z.strictObject({
  shortId: uuid,
  layerId: z.string().min(1),
  expectedRevision,
  controlId: uuid
});
const templateCloneToolInput = z.strictObject({
  templateId: z.string().min(1),
  ...templateCloneInputSchema.shape
});
const templateUpdateToolInput = z.strictObject({
  templateId: z.string().min(1),
  expectedRevision: templateUpdateInputSchema.shape.expectedRevision,
  name: templateUpdateInputSchema.shape.name,
  description: templateUpdateInputSchema.shape.description,
  composition: templateUpdateInputSchema.shape.composition
}).refine((input) =>
  input.name !== undefined || input.description !== undefined || input.composition !== undefined, {
  message: "At least one template change is required"
});

function queryPath(path: string, values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.size ? `${path}?${query}` : path;
}

function envelope<T extends z.ZodType>(schema: T) {
  return apiSuccessEnvelopeSchema(schema);
}

function toolEnvelope<T extends z.ZodType>(dataSchema: T) {
  return z.strictObject({
    apiVersion: z.literal("v1"),
    data: dataSchema.optional(),
    error: apiErrorEnvelopeSchema.shape.error.optional()
  }).superRefine((value, context) => {
    if ((value.data === undefined) === (value.error === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Exactly one of data or error is required"
      });
    }
  });
}

function define(
  name: string,
  description: string,
  inputSchema: z.ZodType,
  dataSchema: z.ZodType,
  operationId: string,
  method: McpHttpMethod,
  path: string,
  request: (input: Record<string, unknown>) => McpHttpRequest
): McpToolDefinition {
  const successSchema = envelope(dataSchema);
  return Object.freeze({
    name,
    description,
    inputSchema,
    successSchema,
    outputSchema: toolEnvelope(dataSchema),
    annotations: Object.freeze({
      readOnlyHint: method === "GET",
      destructiveHint: false as const,
      idempotentHint: method === "GET" || method === "PUT",
      openWorldHint: true as const
    }),
    http: Object.freeze({ operationId, method, path }),
    request
  });
}

const get = (path: string): McpHttpRequest => ({ method: "GET", path });
const mutate = (method: McpHttpMethod, path: string, body?: unknown): McpHttpRequest =>
  body === undefined ? { method, path } : { method, path, body };
export const MCP_TOOL_INVENTORY: readonly McpToolDefinition[] = Object.freeze([
  define("library.list_episodes", "List inventoried episodes and production coverage.",
    episodeListInput, pageSchema(episodeSchema), "library.listEpisodes", "GET",
    "/v1/library/episodes", (input) => get(queryPath("/library/episodes", input))),
  define("library.get_episode", "Get one episode by stable ID.",
    z.strictObject({ episodeId: uuid }), episodeSchema, "library.getEpisode", "GET",
    "/v1/library/episodes/:id", ({ episodeId }) => get(`/library/episodes/${episodeId}`)),
  define("library.import_paths", "Validate and reference video media in place; originals are not modified.",
    z.strictObject({ paths: z.array(z.string()).min(1) }), importResultSchema,
    "library.importPaths", "POST", "/v1/library/import",
    ({ paths }) => mutate("POST", "/library/import", { paths })),
  define("library.list_watched_folders", "List configured watched folders and scan status.",
    pageInput, pageSchema(watchedFolderSchema), "library.listWatchedFolders", "GET",
    "/v1/library/watched-folders",
    (input) => get(queryPath("/library/watched-folders", input))),
  define("library.configure_watched_folder", "Create, update, enable, disable, or rescan a watched folder.",
    watchedFolderConfigurationToolInput, watchedFolderConfigurationResultSchema,
    "library.configureWatchedFolder", "POST", "/v1/library/watched-folders/configure",
    (input) => mutate("POST", "/library/watched-folders/configure", input)),
  define("library.relink_source",
    "Relink a missing Episode. Hash-verified matches complete immediately; confirmation-required results must be completed through the HTTP API.",
    z.strictObject({ episodeId: uuid, candidatePath: z.string().min(1) }),
    relinkSourceResultSchema, "library.relinkSource", "POST",
    "/v1/library/episodes/:id/relink",
    ({ episodeId, candidatePath }) => mutate("POST", `/library/episodes/${episodeId}/relink`,
      { candidatePath })),

  define("analysis.start", "Queue episode analysis. OpenAI requires explicit cloud authorization.",
    analysisStartInput, jobSchema, "analysis.start", "POST", "/v1/analysis/start",
    (input) => mutate("POST", "/analysis/start", input)),
  define("providers.list_capabilities",
    "List non-secret local provider capabilities without contacting OpenAI.",
    emptyInput, providerCapabilityListSchema, "providers.listCapabilities", "GET",
    "/v1/providers/capabilities", () => get("/providers/capabilities")),
  define("providers.get_status",
    "Get locally computed provider configuration and authorization readiness.",
    providerStatusInput, providerStatusListSchema, "providers.getStatus", "GET",
    "/v1/providers/status", (input) => get(queryPath("/providers/status", input))),
  define("analysis.get_transcript",
    "Get the currently accepted transcript or one exact immutable revision.",
    transcriptReadInput, transcriptRevisionSchema, "analysis.getTranscript", "GET",
    "/v1/analysis/:episodeId/transcript", ({ episodeId, revision }) =>
      get(queryPath(`/analysis/${episodeId}/transcript`, { revision }))),
  define("analysis.update_transcript",
    "Accept a complete transcript snapshot using optimistic revision control.",
    transcriptUpdateInput, transcriptRevisionSchema, "analysis.updateTranscript", "PUT",
    "/v1/analysis/:episodeId/transcript", ({ episodeId, ...input }) =>
      mutate("PUT", `/analysis/${episodeId}/transcript`, input)),
  define("jobs.list", "List durable jobs, progress, stages, and errors.",
    pageInput, pageSchema(jobSchema), "jobs.list", "GET", "/v1/jobs",
    (input) => get(queryPath("/jobs", input))),
  define("jobs.cancel", "Request cancellation of a queued or running job.",
    z.strictObject({ jobId: uuid }), jobSchema, "jobs.cancel", "POST",
    "/v1/jobs/:id/cancel", ({ jobId }) => mutate("POST", `/jobs/${jobId}/cancel`)),

  define("candidates.list", "List ranked highlight candidates for an episode.",
    candidateListInput, pageSchema(candidateSchema), "candidates.list", "GET",
    "/v1/candidates", (input) => get(queryPath("/candidates", input))),
  define("candidates.generate", "Generate 5–10 sentence-aligned, deduplicated candidates.",
    candidateGenerationToolInput, candidateGenerationResultSchema,
    "candidates.generate", "POST", "/v1/candidates/generate",
    (input) => mutate("POST", "/candidates/generate", input)),
  define("candidates.review", "Approve or reject a candidate.",
    candidateReviewInput, candidateSchema, "candidates.review", "POST",
    "/v1/candidates/:id/review", ({ candidateId, ...input }) =>
      mutate("POST", `/candidates/${candidateId}/review`, input)),

  define("shorts.create", "Create a non-destructive Short project from an approved candidate.",
    shortCreateInput, shortProjectSchema, "shorts.create", "POST", "/v1/shorts",
    (input) => mutate("POST", "/shorts", input)),
  define("shorts.list", "List reopenable Short projects, optionally for one Episode.",
    shortListInput, pageSchema(shortProjectSchema), "shorts.list", "GET",
    "/v1/shorts", (input) => get(queryPath("/shorts", input))),
  define("shorts.get", "Get a Short project and its current revision.",
    z.strictObject({ shortId: uuid }), shortProjectSchema, "shorts.get", "GET",
    "/v1/shorts/:id", ({ shortId }) => get(`/shorts/${shortId}`)),
  define("shorts.update_composition", "Update composition using optimistic revision control.",
    compositionUpdateInput, shortProjectSchema, "shorts.updateComposition", "PUT",
    "/v1/shorts/:id/composition", ({ shortId, ...input }) =>
      mutate("PUT", `/shorts/${shortId}/composition`, input)),
  define("shorts.update_timeline",
    "Update ordered Episode source ranges using optimistic revision control.",
    timelineUpdateInput, shortProjectSchema, "shorts.updateTimeline", "PUT",
    "/v1/shorts/:id/timeline", ({ shortId, ...input }) =>
      mutate("PUT", `/shorts/${shortId}/timeline`, input)),
  define("shorts.update_captions",
    "Update independent captions and generate revisioned SRT/WebVTT sidecars.",
    captionsUpdateInput, captionUpdateResultSchema, "shorts.updateCaptions", "PUT",
    "/v1/shorts/:id/captions", ({ shortId, ...input }) =>
      mutate("PUT", `/shorts/${shortId}/captions`, input)),
  define("shorts.update_audio",
    "Update synchronized Episode audio and an optional continuous audio bed.",
    audioUpdateToolInput, audioUpdateResultSchema, "shorts.updateAudio", "PUT",
    "/v1/shorts/:id/audio", ({ shortId, ...input }) =>
      mutate("PUT", `/shorts/${shortId}/audio`, input)),
  define("shorts.update_copy", "Update accepted copy without overwriting other fields.",
    copyUpdateInput, shortProjectSchema, "shorts.updateCopy", "PUT",
    "/v1/shorts/:id/copy", ({ shortId, ...input }) =>
      mutate("PUT", `/shorts/${shortId}/copy`, input)),
  define("shorts.approve",
    "Approve the current Short revision after timeline and copy validation.",
    shortRevisionInput, shortProjectSchema, "shorts.approve", "POST",
    "/v1/shorts/:id/approve", ({ shortId, ...input }) =>
      mutate("POST", `/shorts/${shortId}/approve`, input)),
  define("shorts.reanalyze_crops",
    "Regenerate independent automatic crop tracks from the newest complete visual samples.",
    cropReanalysisToolInput, shortProjectSchema, "shorts.reanalyzeCrops", "POST",
    "/v1/shorts/:id/crops/reanalyze", ({ shortId, ...input }) =>
      mutate("POST", `/shorts/${shortId}/crops/reanalyze`, input)),
  define("shorts.add_manual_crop",
    "Add a crop override or explicit return-to-automatic control to one video layer.",
    manualCropAddToolInput, shortProjectSchema, "shorts.addManualCropControl", "POST",
    "/v1/shorts/:id/layers/:layerId/crops/manual",
    ({ shortId, layerId, ...input }) => mutate("POST",
      `/shorts/${shortId}/layers/${encodeURIComponent(String(layerId))}/crops/manual`, input)),
  define("shorts.move_manual_crop",
    "Move or numerically update one UUID-addressed manual crop control.",
    manualCropMoveToolInput, shortProjectSchema, "shorts.moveManualCropControl", "PUT",
    "/v1/shorts/:id/layers/:layerId/crops/manual/:controlId",
    ({ shortId, layerId, controlId, ...input }) => mutate("PUT",
      `/shorts/${shortId}/layers/${encodeURIComponent(String(layerId))}/crops/manual/${controlId}`,
      input)),
  define("shorts.remove_manual_crop",
    "Remove one UUID-addressed manual crop or automatic-resume control.",
    manualCropRemoveToolInput, shortProjectSchema, "shorts.removeManualCropControl", "DELETE",
    "/v1/shorts/:id/layers/:layerId/crops/manual/:controlId",
    ({ shortId, layerId, controlId, ...input }) => mutate("DELETE",
      `/shorts/${shortId}/layers/${encodeURIComponent(String(layerId))}/crops/manual/${controlId}`,
      input)),

  define("renders.start", "Queue a snapshot-bound render from an explicit passing preflight.",
    renderStartRequestSchema, renderStartResultSchema, "renders.start", "POST",
    "/v1/renders/start", (input) => mutate("POST", "/renders/start", input)),
  define("renders.preflight",
    "Validate and persist one immutable Short revision render snapshot without creating output.",
    renderPreflightRequestSchema, renderPreflightResultSchema, "renders.preflight", "POST",
    "/v1/renders/preflight", (input) => mutate("POST", "/renders/preflight", input)),
  define("renders.retry",
    "Manually retry a failed or cancelled snapshot-bound Render without adopting newer edits.",
    z.strictObject({ renderId: uuid }), renderStartResultSchema, "renders.retry", "POST",
    "/v1/renders/:renderId/retry",
    ({ renderId }) => mutate("POST", `/renders/${renderId}/retry`)),
  define("renders.validate", "Probe and validate a final 1080×1920 H.264/AAC MP4.",
    z.strictObject({ path: z.string().min(1) }), renderProbeValidationSchema,
    "renders.validate", "POST", "/v1/renders/validate",
    (input) => mutate("POST", "/renders/validate", input)),
  define("renders.list", "List render records, optionally for one Short.",
    renderListInput, pageSchema(renderSchema), "renders.list", "GET", "/v1/renders",
    (input) => get(queryPath("/renders", input))),

  define("schedule.get", "Get launch calendar entries.",
    pageInput, pageSchema(scheduleEntrySchema), "schedule.list", "GET", "/v1/schedule",
    (input) => get(queryPath("/schedule", input))),
  define("schedule.get_rules", "Get the persisted default schedule rule snapshot.",
    emptyInput, scheduleRuleSetSchema, "schedule.getRules", "GET", "/v1/schedule/rules",
    () => get("/schedule/rules")),
  define("schedule.update_rules",
    "Create or exactly replace the persisted default schedule rule snapshot.",
    scheduleRuleUpdateInputSchema, scheduleRuleSetSchema, "schedule.updateRules", "PUT",
    "/v1/schedule/rules", (input) => mutate("PUT", "/schedule/rules", input)),
  define("schedule.draft", "Draft deterministic legal slots from approved validated renders.",
    scheduleDraftInputSchema, scheduleDraftResultSchema, "schedule.draft", "POST",
    "/v1/schedule/draft", (input) => mutate("POST", "/schedule/draft", input)),
  define("schedule.move", "Move an unlocked entry to a legal, collision-free slot.",
    z.strictObject({ entryId: uuid, ...scheduleMoveInputSchema.shape }),
    scheduleEntrySchema, "schedule.move", "POST", "/v1/schedule/:id/move",
    ({ entryId, ...input }) => mutate("POST", `/schedule/${entryId}/move`, input)),
  define("schedule.mark_published",
    "Manually record publication and permanently lock the entry.",
    z.strictObject({ entryId: uuid, ...scheduleMarkPublishedInputSchema.shape }),
    scheduleEntrySchema, "schedule.markPublished", "POST", "/v1/schedule/:id/published",
    ({ entryId, ...input }) => mutate("POST", `/schedule/${entryId}/published`, input)),

  define("templates.list", "List versioned composition templates.",
    pageInput, pageSchema(templateSchema), "templates.list", "GET", "/v1/templates",
    (input) => get(queryPath("/templates", input))),
  define("templates.clone", "Clone a built-in or user template with direct-parent lineage.",
    templateCloneToolInput, templateSchema, "templates.clone", "POST",
    "/v1/templates/:id/clone", ({ templateId, ...input }) =>
      mutate("POST", `/templates/${encodeURIComponent(String(templateId))}/clone`, input)),
  define("templates.update", "Update a user template using optimistic revision control.",
    templateUpdateToolInput, templateSchema, "templates.update", "PUT",
    "/v1/templates/:id", ({ templateId, ...input }) =>
      mutate("PUT", `/templates/${encodeURIComponent(String(templateId))}`, input)),
  define("assets.list", "List reusable and per-Short assets.",
    pageInput, pageSchema(assetSchema), "assets.list", "GET", "/v1/assets",
    (input) => get(queryPath("/assets", input))),
  define("assets.import", "Inspect and reference an image, video, or audio asset in place.",
    assetImportInputSchema, assetSchema, "assets.import", "POST", "/v1/assets/import",
    (input) => mutate("POST", "/assets/import", input))
]);

export const MCP_TOOL_NAMES = Object.freeze(MCP_TOOL_INVENTORY.map(({ name }) => name));

export function serializeMcpToolInventory(): string {
  const artifact = MCP_TOOL_INVENTORY
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      annotations: tool.annotations,
      http: tool.http,
      inputSchema: z.toJSONSchema(tool.inputSchema, {
        target: "draft-07",
        io: "input",
        unrepresentable: "any"
      }),
      outputSchema: z.toJSONSchema(tool.outputSchema, {
        target: "draft-07",
        io: "output",
        unrepresentable: "any"
      })
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export interface McpServerFactoryOptions {
  coreUrl?: string;
  fetch?: typeof globalThis.fetch;
}

type CoreResult =
  | { ok: true; envelope: Record<string, unknown> }
  | { ok: false; envelope: z.infer<typeof apiErrorEnvelopeSchema> };

function registeredError(
  code: "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR",
  message: string
): z.infer<typeof apiErrorEnvelopeSchema> {
  return {
    apiVersion: "v1",
    error: {
      code,
      message,
      details: null,
      retryable: code === "DEPENDENCY_UNAVAILABLE"
    }
  };
}

export async function executeMcpHttpTool(
  definition: McpToolDefinition,
  input: Record<string, unknown>,
  options: McpServerFactoryOptions = {}
): Promise<CoreResult> {
  const coreUrl = (options.coreUrl ?? process.env.SHORT_EDITOR_CORE_URL ??
    "http://127.0.0.1:43120/v1").replace(/\/$/, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const request = definition.request(input);
  let response: Response;
  try {
    response = await fetchImplementation(`${coreUrl}${request.path}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: request.body === undefined ? undefined : JSON.stringify(request.body)
    });
  } catch {
    return {
      ok: false,
      envelope: registeredError("DEPENDENCY_UNAVAILABLE", "Core API is unavailable")
    };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      envelope: registeredError("INTERNAL_ERROR", "Core API returned an invalid response")
    };
  }
  if (!response.ok) {
    const parsed = apiErrorEnvelopeSchema.safeParse(payload);
    return parsed.success
      ? { ok: false, envelope: parsed.data }
      : {
          ok: false,
          envelope: registeredError("INTERNAL_ERROR", "Core API returned an invalid error")
        };
  }
  const parsed = definition.successSchema.safeParse(payload);
  return parsed.success
    ? { ok: true, envelope: payload as Record<string, unknown> }
    : {
        ok: false,
        envelope: registeredError("INTERNAL_ERROR", "Core API returned an invalid response")
      };
}

function toolResult(value: Record<string, unknown>, isError = false) {
  return {
    ...(isError ? { isError: true as const } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

export function createMcpServer(options: McpServerFactoryOptions = {}): McpServer {
  const server = new McpServer({ name: "short-editor", version: "1.0.0" });
  for (const definition of MCP_TOOL_INVENTORY) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: definition.annotations
    }, async (input) => {
      const result = await executeMcpHttpTool(
        definition,
        input as Record<string, unknown>,
        options
      );
      return toolResult(result.envelope, !result.ok);
    });
  }
  return server;
}
