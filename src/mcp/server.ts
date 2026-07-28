import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { transcriptUpdateSegmentsSchema } from "../shared/domain.js";

const coreUrl = process.env.SHORT_EDITOR_CORE_URL ?? "http://127.0.0.1:43120/v1";
const server = new McpServer({ name: "short-editor", version: "1.0.0" });
const uuid = z.string().uuid();
const expectedRevision = z.number().int().positive();

type Method = "GET" | "POST" | "PUT";
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
  episodeId: uuid, count: z.number().int().min(5).max(10).optional()
}, (input) => core("/candidates/generate", "POST", input));
register("candidates.review", "Approve or reject a candidate.", {
  candidateId: uuid, status: z.enum(["approved", "rejected"])
}, ({ candidateId, status }) => core(`/candidates/${candidateId}/review`, "POST", { status }));

register("shorts.create", "Create a non-destructive Short project from an approved candidate.", {
  candidateId: uuid, templateId: z.string().optional()
}, (input) => core("/shorts", "POST", input));
register("shorts.get", "Get a Short project and its current revision.", { shortId: uuid },
  ({ shortId }) => core(`/shorts/${shortId}`));
register("shorts.update_composition", "Update composition using optimistic revision control.", {
  shortId: uuid, expectedRevision, composition: z.record(z.string(), z.unknown())
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/composition`, "PUT", input));
register("shorts.update_copy", "Update accepted copy without overwriting other fields.", {
  shortId: uuid, expectedRevision, copy: z.record(z.string(), z.unknown())
}, ({ shortId, ...input }) => core(`/shorts/${shortId}/copy`, "PUT", input));

register("renders.start", "Queue a render for an approved, current Short revision.", {
  shortId: uuid, expectedRevision
}, (input) => core("/renders/start", "POST", input));
register("renders.validate", "Probe and validate a final 1080×1920 H.264/AAC MP4.", {
  path: z.string()
}, (input) => core("/renders/validate", "POST", input));
register("renders.list", "List render records, optionally for one Short.", {
  shortId: uuid.optional()
}, ({ shortId }) => core(`/renders${shortId ? `?shortId=${shortId}` : ""}`));

register("schedule.get", "Get launch calendar entries.", {},
  () => core("/schedule"));
register("schedule.draft", "Draft deterministic legal slots from approved validated renders.", {
  shorts: z.array(z.record(z.string(), z.unknown())),
  rules: z.record(z.string(), z.unknown())
}, (input) => core("/schedule/draft", "POST", input));
register("schedule.move", "Move an unlocked entry to a legal, collision-free slot.", {
  entryId: uuid, expectedRevision, publishAt: z.string().datetime()
}, ({ entryId, ...input }) => core(`/schedule/${entryId}/move`, "POST", input));
register("schedule.mark_published", "Mark an entry published and optionally attach its YouTube URL.", {
  entryId: uuid, expectedRevision, youtubeUrl: z.string().url().optional()
}, ({ entryId, ...input }) => core(`/schedule/${entryId}/published`, "POST", input));

register("templates.list", "List versioned composition templates.", {}, () => core("/templates"));
register("assets.list", "List reusable and per-Short assets.", {}, () => core("/assets"));
register("assets.import", "Import an image/video asset with a provenance note.", {
  path: z.string(), provenance: z.string().min(1), reusable: z.boolean().default(true)
}, (input) => core("/assets/import", "POST", input));

await server.connect(new StdioServerTransport());
