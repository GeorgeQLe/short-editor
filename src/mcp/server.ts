import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  assetImportInputSchema,
  audioUpdateInputSchema,
  captionUpdateInputSchema,
  compositionSchema,
  contentPackageSchema,
  cropDetectionObservationSchema,
  renderPreflightRequestSchema,
  renderPreflightResultSchema,
  renderStartRequestSchema,
  renderStartResultSchema,
  scheduleDraftInputSchema,
  scheduleDraftResultSchema,
  scheduleRuleSetSchema,
  scheduleRuleUpdateInputSchema,
  sourceRangesSchema,
  templateCloneInputSchema,
  templateUpdateInputSchema,
  transcriptUpdateSegmentsSchema
} from "../shared/domain.js";

const coreUrl = process.env.SHORT_EDITOR_CORE_URL ?? "http://127.0.0.1:43120/v1";
const server = new McpServer({ name: "short-editor", version: "1.0.0" });
const uuid = z.string().uuid();
const expectedRevision = z.number().int().positive();

type Method = "GET" | "POST" | "PUT" | "DELETE";
async function core(path: string, method: Method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(`${coreUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json() as {
    data?: unknown;
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok) {
    const details = payload.error?.details == null
      ? ""
      : ` ${JSON.stringify(payload.error.details)}`;
    throw new Error(
      `${payload.error?.code ?? "CORE_ERROR"}: ${payload.error?.message ?? "Core request failed"}${details}`
    );
  }
  return payload.data;
}

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});
const register = (
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodType>,
  run: (input: Record<string, unknown>) => Promise<unknown>
) => server.registerTool(name, { description, inputSchema }, async (input) => {
  try { return result(await run(input)); }
  catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
    };
  }
});
const registerStructured = <T>(
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodType>,
  outputSchema: z.ZodType<T>,
  run: (input: Record<string, unknown>) => Promise<unknown>
) => server.registerTool(
  name,
  { description, inputSchema, outputSchema },
  async (input) => {
    try {
      const value = outputSchema.parse(await run(input));
      return { ...result(value), structuredContent: value as Record<string, unknown> };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }
);

register("library.list_episodes", "List inventoried episodes and production coverage.", {
  search: z.string().optional()
}, ({ search }) => core(`/library/episodes?search=${encodeURIComponent(String(search ?? ""))}`));
register("library.get_episode", "Get one episode by stable ID.", { episodeId: uuid },
  ({ episodeId }) => core(`/library/episodes/${episodeId}`));
register("library.import_paths", "Validate and reference video media in place; originals are not modified.", {
  paths: z.array(z.string()).min(1)
}, ({ paths }) => core("/library/import", "POST", { paths }));
register("library.list_watched_folders", "List configured watched folders and scan status.", {},
  () => core("/library/watched-folders"));
register("library.configure_watched_folder", "Create, update, enable, disable, or rescan a watched folder.", {
  action: z.enum(["create", "update", "rescan"]),
  folderId: uuid.optional(),
  path: z.string().optional(),
  enabled: z.boolean().optional(),
  recursive: z.boolean().optional(),
  includePatterns: z.array(z.string().min(1)).optional()
}, (input) => core("/library/watched-folders/configure", "POST", input));
register(
  "library.relink_source",
  "Relink a missing Episode. Hash-verified matches complete immediately; confirmation-required results must be completed through the HTTP API.",
  { episodeId: uuid, candidatePath: z.string().min(1) },
  ({ episodeId, candidatePath }) => core(
    `/library/episodes/${episodeId}/relink`, "POST", { candidatePath }
  )
);

register("analysis.start", "Queue episode analysis. OpenAI requires explicit cloud authorization.", {
  episodeId: uuid, provider: z.enum(["local", "openai"]).default("local"),
  modelId: z.string().min(1).optional(),
  wordTimestamps: z.boolean().optional(),
  speechMode: z.enum(["transcription", "diarization"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
  authorizationBatchId: uuid.optional()
}, (input) => core("/analysis/start", "POST", input));
register("analysis.openai_start", "Queue authorized OpenAI strict structured episode analysis.", {
  episodeId: uuid,
  modelId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  intervalMs: z.number().int().positive().optional(),
  maximumSamples: z.number().int().positive().optional(),
  authorizationBatchId: uuid.optional()
}, (input) => core("/analysis/openai/start", "POST", input));
register(
  "providers.list_capabilities",
  "List non-secret local provider capabilities without contacting OpenAI.",
  {},
  () => core("/providers/capabilities")
);
register(
  "providers.get_status",
  "Get locally computed provider configuration and authorization readiness.",
  {
    episodeId: uuid.optional(),
    authorizationBatchId: uuid.optional()
  },
  ({ episodeId, authorizationBatchId }) => {
    const query = new URLSearchParams();
    if (episodeId) query.set("episodeId", String(episodeId));
    if (authorizationBatchId) query.set("authorizationBatchId", String(authorizationBatchId));
    return core(`/providers/status${query.size ? `?${query}` : ""}`);
  }
);
register(
  "analysis.local_transcription_status",
  "Report installed faster-whisper models and local transcription capabilities.",
  {},
  () => core("/analysis/local-transcription/status")
);
register(
  "analysis.get_transcript",
  "Get the currently accepted transcript or one exact immutable revision.",
  { episodeId: uuid, revision: expectedRevision.optional() },
  ({ episodeId, revision }) => core(
    `/analysis/${episodeId}/transcript${revision === undefined ? "" : `?revision=${revision}`}`
  )
);
register(
  "analysis.update_transcript",
  "Accept a complete transcript snapshot using optimistic revision control.",
  {
    episodeId: uuid,
    expectedRevision,
    language: z.string().trim().min(2),
    segments: transcriptUpdateSegmentsSchema
  },
  ({ episodeId, ...input }) => core(`/analysis/${episodeId}/transcript`, "PUT", input)
);
register("jobs.list", "List durable jobs, progress, stages, and errors.", {},
  () => core("/jobs"));
register("jobs.cancel", "Request cancellation of a queued or running job.", { jobId: uuid },
  ({ jobId }) => core(`/jobs/${jobId}/cancel`, "POST"));

register("candidates.list", "List ranked highlight candidates for an episode.", { episodeId: uuid },
  ({ episodeId }) => core(`/candidates?episodeId=${episodeId}`));
register("candidates.generate", "Generate 5–10 sentence-aligned, deduplicated candidates.", {
  episodeId: uuid,
  count: z.number().int().min(5).max(10).optional(),
  strategy: z.enum(["replace_pending", "append_pending"]),
  mode: z.enum(["heuristic", "analysis"]).default("heuristic"),
  analysisArtifactId: uuid.optional()
}, (input) => core("/candidates/generate", "POST", input));
register("candidates.review", "Approve or reject a candidate.", {
  candidateId: uuid, expectedRevision, status: z.enum(["approved", "rejected"])
}, ({ candidateId, ...input }) => core(`/candidates/${candidateId}/review`, "POST", input));
register("candidates.get_content_package", "Read immutable proposed and accepted Candidate copy.", {
  candidateId: uuid
}, ({ candidateId }) => core(`/candidates/${candidateId}/content-package`));
register("candidates.accept_content_package", "Atomically accept or edit a complete Candidate copy package.", {
  candidateId: uuid, expectedRevision, contentPackage: contentPackageSchema
}, ({ candidateId, ...input }) =>
  core(`/candidates/${candidateId}/content-package`, "PUT", input));

register("shorts.create", "Create a non-destructive Short project from an approved candidate.", {
  candidateId: uuid, templateId: z.string().optional()
}, (input) => core("/shorts", "POST", input));
register("shorts.get", "Get a Short project and its current revision.", { shortId: uuid },
  ({ shortId }) => core(`/shorts/${shortId}`));
register("shorts.update_composition", "Update composition using optimistic revision control.", {
  shortId: uuid, expectedRevision, composition: z.record(z.string(), z.unknown())
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/composition`, "PUT", input));
register("shorts.update_timeline", "Update ordered Episode source ranges using optimistic revision control.", {
  shortId: uuid, expectedRevision, sourceRanges: sourceRangesSchema
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/timeline`, "PUT", input));
register("shorts.update_captions", "Update independent captions and generate revisioned SRT/WebVTT sidecars.", {
  shortId: uuid,
  expectedRevision,
  enabled: captionUpdateInputSchema.shape.enabled,
  cues: captionUpdateInputSchema.shape.cues,
  style: captionUpdateInputSchema.shape.style
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/captions`, "PUT", input));
register("shorts.update_audio", "Update synchronized Episode audio and an optional continuous audio bed.", {
  shortId: uuid,
  expectedRevision: audioUpdateInputSchema.shape.expectedRevision,
  sourceGainDb: audioUpdateInputSchema.shape.sourceGainDb,
  sourceMuted: audioUpdateInputSchema.shape.sourceMuted,
  cutFadeMs: audioUpdateInputSchema.shape.cutFadeMs,
  bedAssetId: audioUpdateInputSchema.shape.bedAssetId,
  bedGainDb: audioUpdateInputSchema.shape.bedGainDb
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/audio`, "PUT", input));
register("shorts.update_copy", "Update accepted copy without overwriting other fields.", {
  shortId: uuid, expectedRevision, copy: contentPackageSchema
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/copy`, "PUT", input));
register("shorts.approve", "Approve the current Short revision after timeline and copy validation.", {
  shortId: uuid, expectedRevision
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/approve`, "POST", input));
register("shorts.reanalyze_crops", "Regenerate independent automatic crop tracks from the newest complete visual samples.", {
  shortId: uuid,
  expectedRevision,
  layerIds: z.array(z.string().min(1)).min(1).optional()
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/crops/reanalyze`, "POST", input));
register("shorts.add_manual_crop", "Add a crop override or explicit return-to-automatic control to one video layer.", {
  shortId: uuid,
  layerId: z.string().min(1),
  expectedRevision,
  control: z.discriminatedUnion("mode", [
    z.strictObject({
      id: uuid,
      mode: z.literal("crop"),
      atMs: z.number().int().nonnegative(),
      ...cropDetectionObservationSchema.omit({ confidence: true }).shape
    }),
    z.strictObject({
      id: uuid,
      mode: z.literal("automatic"),
      atMs: z.number().int().nonnegative()
    })
  ])
}, ({ shortId, layerId, ...input }) =>
  core(`/shorts/${shortId}/layers/${encodeURIComponent(String(layerId))}/crops/manual`, "POST", input));
register("shorts.move_manual_crop", "Move or numerically update one UUID-addressed manual crop control.", {
  shortId: uuid,
  layerId: z.string().min(1),
  expectedRevision,
  controlId: uuid,
  atMs: z.number().int().nonnegative(),
  crop: cropDetectionObservationSchema.omit({ confidence: true }).optional()
}, ({ shortId, layerId, controlId, ...input }) =>
  core(
    `/shorts/${shortId}/layers/${encodeURIComponent(String(layerId))}/crops/manual/${controlId}`,
    "PUT",
    input
  ));
register("shorts.remove_manual_crop", "Remove one UUID-addressed manual crop or automatic-resume control.", {
  shortId: uuid,
  layerId: z.string().min(1),
  expectedRevision,
  controlId: uuid
}, ({ shortId, layerId, controlId, ...input }) =>
  core(
    `/shorts/${shortId}/layers/${encodeURIComponent(String(layerId))}/crops/manual/${controlId}`,
    "DELETE",
    input
  ));

server.registerTool("renders.start", {
  description: "Queue a snapshot-bound render from an explicit passing preflight.",
  inputSchema: {
    shortId: renderStartRequestSchema.shape.shortId,
    expectedRevision: renderStartRequestSchema.shape.expectedRevision,
    preflightId: renderStartRequestSchema.shape.preflightId,
    sidecarFormat: renderStartRequestSchema.shape.sidecarFormat
  },
  outputSchema: renderStartResultSchema
}, async (input) => {
  try {
    const value = renderStartResultSchema.parse(await core("/renders/start", "POST", input));
    return { ...result(value), structuredContent: value };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error)
      }]
    };
  }
});
server.registerTool("renders.preflight", {
  description: "Validate and persist one immutable Short revision render snapshot without creating output.",
  inputSchema: {
    shortId: renderPreflightRequestSchema.shape.shortId,
    expectedRevision: renderPreflightRequestSchema.shape.expectedRevision
  },
  outputSchema: renderPreflightResultSchema
}, async (input) => {
  try {
    const value = renderPreflightResultSchema.parse(
      await core("/renders/preflight", "POST", input)
    );
    return { ...result(value), structuredContent: value };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error)
      }]
    };
  }
});
server.registerTool("renders.retry", {
  description: "Manually retry a failed or cancelled snapshot-bound Render without adopting newer edits.",
  inputSchema: { renderId: uuid },
  outputSchema: renderStartResultSchema
}, async ({ renderId }) => {
  try {
    const value = renderStartResultSchema.parse(
      await core(`/renders/${renderId}/retry`, "POST")
    );
    return { ...result(value), structuredContent: value };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error)
      }]
    };
  }
});
register("renders.validate", "Probe and validate a final 1080×1920 H.264/AAC MP4.", {
  path: z.string()
}, (input) => core("/renders/validate", "POST", input));
register("renders.list", "List render records, optionally for one Short.", {
  shortId: uuid.optional()
}, ({ shortId }) => core(`/renders${shortId ? `?shortId=${shortId}` : ""}`));

register("schedule.get", "Get launch calendar entries.", {},
  () => core("/schedule"));
registerStructured("schedule.get_rules", "Get the persisted default schedule rule snapshot.", {},
  scheduleRuleSetSchema, () => core("/schedule/rules"));
registerStructured("schedule.update_rules", "Create or exactly replace the persisted default schedule rule snapshot.", {
  expectedRevision: scheduleRuleUpdateInputSchema.shape.expectedRevision,
  startDate: scheduleRuleUpdateInputSchema.shape.startDate,
  timezone: scheduleRuleUpdateInputSchema.shape.timezone,
  allowedWeekdays: scheduleRuleUpdateInputSchema.shape.allowedWeekdays,
  times: scheduleRuleUpdateInputSchema.shape.times,
  maxPerDay: scheduleRuleUpdateInputSchema.shape.maxPerDay,
  blackoutDates: scheduleRuleUpdateInputSchema.shape.blackoutDates,
  minimumSameEpisodeSpacingHours:
    scheduleRuleUpdateInputSchema.shape.minimumSameEpisodeSpacingHours
}, scheduleRuleSetSchema, (input) => core("/schedule/rules", "PUT", input));
registerStructured("schedule.draft", "Draft deterministic legal slots from approved validated renders.", {
  shorts: scheduleDraftInputSchema.shape.shorts,
  expectedRulesRevision: scheduleDraftInputSchema.shape.expectedRulesRevision
}, scheduleDraftResultSchema, (input) => core("/schedule/draft", "POST", input));
register("schedule.move", "Move an unlocked entry to a legal, collision-free slot.", {
  entryId: uuid, expectedRevision, publishAt: z.string().datetime()
}, ({ entryId, ...input }) => core(`/schedule/${entryId}/move`, "POST", input));
register("schedule.mark_published", "Mark an entry published and optionally attach its YouTube URL.", {
  entryId: uuid, expectedRevision, youtubeUrl: z.string().url().optional()
}, ({ entryId, ...input }) => core(`/schedule/${entryId}/published`, "POST", input));

register("templates.list", "List versioned composition templates.", {}, () => core("/templates"));
register("templates.clone", "Clone a built-in or user template with direct-parent lineage.", {
  name: templateCloneInputSchema.shape.name,
  description: templateCloneInputSchema.shape.description,
  templateId: z.string().min(1)
}, ({ templateId, ...input }) => core(`/templates/${templateId}/clone`, "POST", input));
register("templates.update", "Update a user template using optimistic revision control.", {
  templateId: z.string().min(1),
  expectedRevision: templateUpdateInputSchema.shape.expectedRevision,
  name: templateUpdateInputSchema.shape.name,
  description: templateUpdateInputSchema.shape.description,
  composition: compositionSchema.optional()
}, ({ templateId, ...input }) => core(`/templates/${templateId}`, "PUT", input));
register("assets.list", "List reusable and per-Short assets.", {}, () => core("/assets"));
register("assets.import", "Inspect and reference an image, video, or audio asset in place.", {
  path: assetImportInputSchema.shape.path,
  provenance: assetImportInputSchema.shape.provenance,
  reusable: assetImportInputSchema.shape.reusable
}, (input) => core("/assets/import", "POST", input));

await server.connect(new StdioServerTransport());
