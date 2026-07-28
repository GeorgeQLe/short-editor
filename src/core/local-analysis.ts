import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import {
  providerCallWorkerResultSchema,
  providerClassSchema,
  visualSamplingWorkerResultSchema,
  type AnalysisArtifact,
  type ProviderProvenance,
  type TranscriptRevision
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import type { PythonWorkerSupervisor } from "./python-worker-supervisor.js";
import { analysisCacheIdentity } from "./analysis-cache.js";

export const OLLAMA_PROMPT_VERSION = "episode-analysis-prompt-v1";
export const OLLAMA_SCHEMA_VERSION = "episode-analysis-schema-v1";
export const VISUAL_OPTIONS_VERSION = "visual-sampling-v1";
export const OLLAMA_CAPABILITIES_SCHEMA_VERSION = "ollama-capabilities-v1";

const modelIdSchema = z.string().min(1).max(200).refine(
  (value) => !/[\s/\\]/.test(value) && !value.includes(".."),
  "modelId must be an Ollama model identifier"
);

export const ollamaOptionsSchema = z.strictObject({
  baseUrl: z.string().url().default("http://127.0.0.1:11434"),
  modelId: modelIdSchema.default("gemma3"),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  networkDisclosed: z.boolean().default(false),
  cloudAuthorized: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0)
}).superRefine((value, context) => {
  let providerClass: z.infer<typeof providerClassSchema>;
  try {
    providerClass = classifyProviderEndpoint(value.baseUrl);
  } catch {
    context.addIssue({ code: "custom", path: ["baseUrl"], message: "Unsupported Ollama endpoint" });
    return;
  }
  if (providerClass === "network" && !value.networkDisclosed) {
    context.addIssue({
      code: "custom",
      path: ["networkDisclosed"],
      message: "Private-LAN Ollama use requires network disclosure acknowledgement"
    });
  }
  if (providerClass === "cloud" && !value.cloudAuthorized) {
    context.addIssue({
      code: "custom",
      path: ["cloudAuthorized"],
      message: "Public Ollama use requires persisted cloud authorization"
    });
  }
});
export type OllamaOptions = z.infer<typeof ollamaOptionsSchema>;

export const visualSamplingOptionsSchema = z.strictObject({
  intervalMs: z.number().int().min(250).max(60_000).default(2_000),
  maximumSamples: z.number().int().min(1).max(10_000).default(300),
  fixtureId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional()
});
export type VisualSamplingOptions = z.infer<typeof visualSamplingOptionsSchema>;
export const localAnalysisJobOptionsSchema = z.strictObject({
  mode: z.literal("ollama"),
  ollama: ollamaOptionsSchema,
  visual: visualSamplingOptionsSchema
});
export type LocalAnalysisJobOptions = z.infer<typeof localAnalysisJobOptionsSchema>;

const componentScoresSchema = z.strictObject({
  hook: z.number().min(0).max(1),
  coherence: z.number().min(0).max(1),
  payoff: z.number().min(0).max(1),
  independence: z.number().min(0).max(1),
  delivery: z.number().min(0).max(1),
  visualActivity: z.number().min(0).max(1)
});
export const episodeAnalysisOutputSchema = z.strictObject({
  summary: z.string().min(1),
  topics: z.array(z.string().min(1)).max(50),
  highlights: z.array(z.strictObject({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    title: z.string().min(1),
    reason: z.string().min(1),
    scores: componentScoresSchema
  })).max(100)
}).superRefine((value, context) => {
  value.highlights.forEach((highlight, index) => {
    if (highlight.endMs <= highlight.startMs) {
      context.addIssue({
        code: "custom",
        path: ["highlights", index, "endMs"],
        message: "Highlight end must follow its start"
      });
    }
  });
});
export type EpisodeAnalysisOutput = z.infer<typeof episodeAnalysisOutputSchema>;

export const episodeAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "topics", "highlights"],
  properties: {
    summary: { type: "string", minLength: 1 },
    topics: { type: "array", maxItems: 50, items: { type: "string", minLength: 1 } },
    highlights: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startMs", "endMs", "title", "reason", "scores"],
        properties: {
          startMs: { type: "integer", minimum: 0 },
          endMs: { type: "integer", minimum: 1 },
          title: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          scores: {
            type: "object",
            additionalProperties: false,
            required: ["hook", "coherence", "payoff", "independence", "delivery", "visualActivity"],
            properties: Object.fromEntries(
              ["hook", "coherence", "payoff", "independence", "delivery", "visualActivity"]
                .map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])
            )
          }
        }
      }
    }
  }
} as z.infer<ReturnType<typeof z.json>>;

export function classifyProviderEndpoint(input: string): "local" | "network" | "cloud" {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("VALIDATION_ERROR", "Ollama endpoints must use HTTP or HTTPS", 422);
  }
  if (url.username || url.password) {
    throw new AppError("VALIDATION_ERROR", "Ollama endpoint credentials are not allowed in URLs", 422);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost") return "local";
  const ipVersion = isIP(host);
  if (!ipVersion) return "cloud";
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    if (octets[0] === 127) return "local";
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) return "network";
    return "cloud";
  }
  if (host.startsWith("::ffff:")) {
    return classifyProviderEndpoint(`${url.protocol}//${host.slice(7)}${url.port ? `:${url.port}` : ""}`);
  }
  if (host === "::1") return "local";
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return "network";
  return "cloud";
}

function normalizedBaseUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "") || "";
  return url.toString().replace(/\/$/, "");
}

export class LocalVisualSampler {
  constructor(private readonly worker: PythonWorkerSupervisor) {}

  async sample(
    jobId: string,
    sourcePath: string,
    options: VisualSamplingOptions,
    onProgress?: (progress: number, stage: string) => void
  ) {
    const configured = visualSamplingOptionsSchema.parse(options);
    const raw = await this.worker.runJob(jobId, {
      kind: "visual_sampling",
      sourcePath,
      intervalMs: configured.intervalMs,
      maximumSamples: configured.maximumSamples,
      ...(configured.fixtureId ? { fixtureId: configured.fixtureId } : {})
    }, onProgress);
    return visualSamplingWorkerResultSchema.parse(raw);
  }
}

export class OllamaAnalysisProvider {
  constructor(private readonly worker: PythonWorkerSupervisor) {}

  async status(baseUrl: string, networkDisclosed = false, cloudAuthorized = false) {
    const providerClass = classifyProviderEndpoint(baseUrl);
    return {
      provider: "ollama",
      providerClass,
      baseUrl: normalizedBaseUrl(baseUrl),
      requiresNetworkDisclosure: providerClass === "network" && !networkDisclosed,
      requiresCloudAuthorization: providerClass === "cloud" && !cloudAuthorized
    };
  }

  async discover(
    jobId: string,
    options: OllamaOptions
  ): Promise<{
    models: Array<{ modelId: string; size: number | null; family: string | null }>;
    provenance: ProviderProvenance;
  }> {
    const configured = ollamaOptionsSchema.parse(options);
    const providerClass = classifyProviderEndpoint(configured.baseUrl);
    const raw = await this.worker.runJob(jobId, {
      kind: "provider_call",
      provider: "ollama",
      modelId: configured.modelId,
      credentialHandle: null,
      operation: "capabilities",
      inputArtifactPaths: [],
      schemaVersion: OLLAMA_CAPABILITIES_SCHEMA_VERSION,
      options: {
        baseUrl: normalizedBaseUrl(configured.baseUrl),
        endpointClass: providerClass,
        maximumEndpointClass: providerClass,
        networkConsent: configured.networkDisclosed,
        cloudConsent: configured.cloudAuthorized,
        timeoutMs: configured.timeoutMs,
        temperature: configured.temperature,
        promptVersion: OLLAMA_PROMPT_VERSION,
        outputSchema: {}
      }
    });
    const result = providerCallWorkerResultSchema.parse(raw);
    const capabilities = z.strictObject({
      models: z.array(z.strictObject({
        modelId: z.string().min(1),
        size: z.number().int().nonnegative().nullable(),
        family: z.string().min(1).nullable()
      }))
    }).safeParse(result.output);
    if (
      result.schemaVersion !== OLLAMA_CAPABILITIES_SCHEMA_VERSION ||
      !capabilities.success
    ) {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "Ollama returned invalid capabilities", 422);
    }
    return { models: capabilities.data.models, provenance: result.provenance };
  }

  async analyze(
    jobId: string,
    inputArtifactPaths: string[],
    options: OllamaOptions,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<{ output: EpisodeAnalysisOutput; provenance: ProviderProvenance }> {
    const configured = ollamaOptionsSchema.parse(options);
    const providerClass = classifyProviderEndpoint(configured.baseUrl);
    const raw = await this.worker.runJob(jobId, {
      kind: "provider_call",
      provider: "ollama",
      modelId: configured.modelId,
      credentialHandle: null,
      operation: "analysis",
      inputArtifactPaths,
      schemaVersion: OLLAMA_SCHEMA_VERSION,
      options: {
        baseUrl: normalizedBaseUrl(configured.baseUrl),
        endpointClass: providerClass,
        maximumEndpointClass: providerClass,
        networkConsent: configured.networkDisclosed,
        cloudConsent: configured.cloudAuthorized,
        timeoutMs: configured.timeoutMs,
        temperature: configured.temperature,
        promptVersion: OLLAMA_PROMPT_VERSION,
        outputSchema: episodeAnalysisJsonSchema
      }
    }, onProgress);
    const result = providerCallWorkerResultSchema.parse(raw);
    if (result.schemaVersion !== OLLAMA_SCHEMA_VERSION) {
      throw new AppError("PROVIDER_OUTPUT_INVALID", "Ollama returned an incompatible schema version", 422);
    }
    const output = episodeAnalysisOutputSchema.safeParse(result.output);
    if (!output.success) {
      throw new AppError(
        "PROVIDER_OUTPUT_INVALID",
        "Ollama returned output that does not match the analysis schema",
        422
      );
    }
    return { output: output.data, provenance: result.provenance };
  }
}

export function analysisInputHash(input: {
  sourceHash: string;
  transcript: TranscriptRevision;
  ollama: OllamaOptions;
  visual: VisualSamplingOptions;
}): string {
  return analysisCacheIdentity({
    sourceHash: input.sourceHash,
    transcriptRevision: input.transcript.revision,
    transcriptId: input.transcript.id,
    provider: "ollama",
    modelId: input.ollama.modelId,
    promptVersion: OLLAMA_PROMPT_VERSION,
    schemaVersion: OLLAMA_SCHEMA_VERSION,
    visualSamplingVersion: VISUAL_OPTIONS_VERSION,
    visualOptions: visualSamplingOptionsSchema.parse(input.visual),
    outputOptions: {
      baseUrl: normalizedBaseUrl(input.ollama.baseUrl),
      providerClass: classifyProviderEndpoint(input.ollama.baseUrl),
      temperature: input.ollama.temperature
    }
  });
}

export function createAnalysisArtifact(
  episodeId: string,
  inputHash: string,
  output: EpisodeAnalysisOutput,
  provenance: ProviderProvenance
): AnalysisArtifact {
  return {
    id: randomUUID(),
    entityId: episodeId,
    ownerType: "episode",
    kind: "episode_analysis",
    state: "proposed",
    provenance,
    inputHash,
    rawOutput: output,
    acceptedProjection: null,
    createdAt: provenance.createdAt
  };
}
