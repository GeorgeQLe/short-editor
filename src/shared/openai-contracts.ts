import { z } from "zod";
import {
  analysisArtifactSchema,
  providerProvenanceSchema,
  timedSegmentsSchema
} from "./contracts.js";
import { idSchema, utcInstantSchema } from "./validators.js";

export const OPENAI_ADAPTER_VERSION = "openai-http-v1";
export const OPENAI_SPEECH_OPTIONS_VERSION = "openai-speech-v1";
export const OPENAI_ANALYSIS_PROMPT_VERSION = "episode-analysis-prompt-v1";
export const OPENAI_ANALYSIS_SCHEMA_VERSION = "episode-analysis-schema-v1";

const modelIdSchema = z.string().min(1).max(200).refine(
  (value) => !/[\s/\\]/.test(value) && !value.includes(".."),
  "modelId must be an exact provider model identifier"
);

export const openAiSpeechModeSchema = z.enum(["transcription", "diarization"]);
export type OpenAiSpeechMode = z.infer<typeof openAiSpeechModeSchema>;

export const openAiSpeechOptionsSchema = z.strictObject({
  mode: openAiSpeechModeSchema,
  modelId: modelIdSchema,
  wordTimestamps: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000)
}).superRefine((value, context) => {
  if (value.mode === "diarization" && value.wordTimestamps) {
    context.addIssue({
      code: "custom",
      path: ["wordTimestamps"],
      message: "Diarization does not fabricate word timestamps"
    });
  }
  if (value.wordTimestamps && value.modelId !== "whisper-1") {
    context.addIssue({
      code: "custom",
      path: ["modelId"],
      message: "Word timestamps are supported only by whisper-1"
    });
  }
});
export type OpenAiSpeechOptions = z.infer<typeof openAiSpeechOptionsSchema>;

export const openAiAnalysisOptionsSchema = z.strictObject({
  modelId: modelIdSchema,
  timeoutMs: z.number().int().min(1_000).max(600_000).default(180_000),
  temperature: z.number().min(0).max(2).default(0),
  visual: z.strictObject({
    intervalMs: z.number().int().min(250).max(60_000).default(2_000),
    maximumSamples: z.number().int().min(1).max(10_000).default(300)
  })
});
export type OpenAiAnalysisOptions = z.infer<typeof openAiAnalysisOptionsSchema>;

export const providerRequestMetadataSchema = z.strictObject({
  providerRequestId: z.string().min(1).nullable(),
  requestedModelId: modelIdSchema,
  returnedModelId: modelIdSchema,
  cloudClassification: z.literal("cloud"),
  adapterVersion: z.string().min(1),
  promptVersion: z.string().min(1).nullable(),
  schemaVersion: z.string().min(1).nullable(),
  optionsVersion: z.string().min(1),
  createdAt: utcInstantSchema
});
export type ProviderRequestMetadata = z.infer<typeof providerRequestMetadataSchema>;

export const openAiSpeechResultSchema = z.strictObject({
  operation: z.literal("speech"),
  mode: openAiSpeechModeSchema,
  language: z.string().min(2),
  segments: timedSegmentsSchema,
  rawOutput: z.json(),
  provenance: providerProvenanceSchema,
  requestMetadata: providerRequestMetadataSchema
});
export type OpenAiSpeechResult = z.infer<typeof openAiSpeechResultSchema>;

export const openAiAnalysisResultSchema = z.strictObject({
  operation: z.literal("analysis"),
  schemaVersion: z.literal(OPENAI_ANALYSIS_SCHEMA_VERSION),
  output: z.json(),
  rawOutput: z.json(),
  provenance: providerProvenanceSchema,
  requestMetadata: providerRequestMetadataSchema
});
export type OpenAiAnalysisResult = z.infer<typeof openAiAnalysisResultSchema>;

const authorizationContextSchema = z.strictObject({
  scopeType: z.enum(["project", "batch"]),
  scopeId: idSchema,
  operationClass: z.enum(["transcription", "analysis"])
});

export const openAiBridgeRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("speech"),
    requestId: idSchema,
    jobId: idSchema,
    credentialHandle: z.string().min(1),
    inputPath: z.string().min(1),
    options: openAiSpeechOptionsSchema,
    authorization: authorizationContextSchema
  }),
  z.strictObject({
    operation: z.literal("analysis"),
    requestId: idSchema,
    jobId: idSchema,
    credentialHandle: z.string().min(1),
    inputPaths: z.array(z.string().min(1)).min(1),
    options: openAiAnalysisOptionsSchema,
    authorization: authorizationContextSchema
  })
]);
export type OpenAiBridgeRequest = z.infer<typeof openAiBridgeRequestSchema>;

export const openAiBridgeCancelSchema = z.strictObject({
  operation: z.literal("cancel"),
  requestId: idSchema,
  jobId: idSchema
});
export type OpenAiBridgeCancel = z.infer<typeof openAiBridgeCancelSchema>;

export const openAiBridgeEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("progress"),
    requestId: idSchema,
    jobId: idSchema,
    progress: z.number().min(0).max(1),
    stage: z.string().min(1)
  }),
  z.strictObject({
    type: z.literal("result"),
    requestId: idSchema,
    jobId: idSchema,
    result: z.union([openAiSpeechResultSchema, openAiAnalysisResultSchema])
  }),
  z.strictObject({
    type: z.literal("error"),
    requestId: idSchema,
    jobId: idSchema,
    code: z.enum([
      "DEPENDENCY_UNAVAILABLE",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_OUTPUT_INVALID",
      "CLOUD_NOT_AUTHORIZED",
      "JOB_CANCELLED",
      "INTERNAL_ERROR"
    ]),
    message: z.string().min(1),
    retryable: z.boolean()
  })
]);
export type OpenAiBridgeEvent = z.infer<typeof openAiBridgeEventSchema>;

export const providerCapabilitySchema = z.strictObject({
  provider: z.enum(["local", "ollama", "openai"]),
  providerClass: z.enum(["local", "network", "cloud"]),
  operations: z.array(z.enum(["transcription", "diarization", "analysis"])),
  features: z.array(z.string().min(1)),
  defaultModels: z.record(z.string(), z.string().min(1))
});
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerStatusSchema = z.strictObject({
  provider: z.enum(["local", "ollama", "openai"]),
  configured: z.boolean(),
  credentialConfigured: z.boolean(),
  transcriptionReady: z.boolean(),
  analysisReady: z.boolean(),
  authorization: z.strictObject({
    transcription: z.boolean(),
    analysis: z.boolean()
  }),
  detail: z.string().min(1).nullable()
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const providerStatusListSchema = z.array(providerStatusSchema);
export const providerCapabilityListSchema = z.array(providerCapabilitySchema);

export const analysisCacheIdentityInputSchema = z.strictObject({
  sourceHash: z.string().min(1),
  transcriptId: idSchema,
  transcriptRevision: z.number().int().positive(),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  visualSamplingVersion: z.string().min(1),
  visualOptions: z.json(),
  outputOptions: z.json()
});
export type AnalysisCacheIdentityInput = z.infer<typeof analysisCacheIdentityInputSchema>;

export const successfulAnalysisArtifactSchema = analysisArtifactSchema.refine(
  (artifact) => artifact.state === "proposed" || artifact.state === "accepted",
  "Only successful artifacts are cacheable"
);
