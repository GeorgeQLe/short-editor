import { z } from "zod";
import { providerProvenanceSchema, renderValidationResultSchema, scoreBreakdownSchema } from "./contracts.js";
import { idSchema, positiveRevisionSchema } from "./validators.js";

const base = <T extends string>(type: T) => ({
  apiVersion: z.literal("v1"),
  type: z.literal(type)
});
const mediaProbeSchema = z.strictObject({
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  videoCodec: z.string().min(1),
  audioCodec: z.string().min(1).nullable()
});

export const probeJobPayloadSchema = z.strictObject({ ...base("probe"), episodeId: idSchema });
export const hashJobPayloadSchema = z.strictObject({ ...base("hash"), episodeId: idSchema });
export const analyzeJobPayloadSchema = z.strictObject({
  ...base("analyze"),
  episodeId: idSchema,
  provider: z.enum(["local", "openai"]),
  transcriptRevision: positiveRevisionSchema.nullable()
});
export const candidatesJobPayloadSchema = z.strictObject({
  ...base("candidates"),
  episodeId: idSchema,
  transcriptRevision: positiveRevisionSchema,
  count: z.number().int().min(5).max(10)
});
export const renderJobPayloadSchema = z.strictObject({
  ...base("render"),
  shortId: idSchema,
  projectRevision: positiveRevisionSchema
});
export const jobPayloadSchema = z.discriminatedUnion("type", [
  probeJobPayloadSchema,
  hashJobPayloadSchema,
  analyzeJobPayloadSchema,
  candidatesJobPayloadSchema,
  renderJobPayloadSchema
]);
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const probeJobResultSchema = z.strictObject({ ...base("probe"), episodeId: idSchema, probe: mediaProbeSchema });
export const hashJobResultSchema = z.strictObject({
  ...base("hash"), episodeId: idSchema, algorithm: z.literal("sha256"), contentHash: z.string().regex(/^[a-f0-9]{64}$/)
});
export const analyzeJobResultSchema = z.strictObject({
  ...base("analyze"), episodeId: idSchema, transcriptRevisionId: idSchema,
  artifactIds: z.array(idSchema), provenance: providerProvenanceSchema
});
export const candidatesJobResultSchema = z.strictObject({
  ...base("candidates"), episodeId: idSchema, candidateIds: z.array(idSchema),
  scores: z.array(scoreBreakdownSchema), diagnostic: z.string().nullable()
});
export const renderJobResultSchema = z.strictObject({
  ...base("render"), shortId: idSchema, projectRevision: positiveRevisionSchema,
  renderId: idSchema, validation: renderValidationResultSchema
});
export const jobResultSchema = z.discriminatedUnion("type", [
  probeJobResultSchema,
  hashJobResultSchema,
  analyzeJobResultSchema,
  candidatesJobResultSchema,
  renderJobResultSchema
]);
export type JobResult = z.infer<typeof jobResultSchema>;

export const jobMessageTypes = ["probe", "hash", "analyze", "candidates", "render"] as const;
export const JOB_MESSAGE_TYPES = jobMessageTypes;
export const jobPayloadSchemas = {
  probe: probeJobPayloadSchema,
  hash: hashJobPayloadSchema,
  analyze: analyzeJobPayloadSchema,
  candidates: candidatesJobPayloadSchema,
  render: renderJobPayloadSchema
} as const;
export const jobResultSchemas = {
  probe: probeJobResultSchema,
  hash: hashJobResultSchema,
  analyze: analyzeJobResultSchema,
  candidates: candidatesJobResultSchema,
  render: renderJobResultSchema
} as const;
