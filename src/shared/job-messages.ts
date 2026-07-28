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
  projectRevision: positiveRevisionSchema,
  renderId: idSchema,
  preflightId: idSchema,
  sidecarFormat: z.enum(["srt", "webvtt"]).nullable()
});
export const watchedFolderScanJobPayloadSchema = z.strictObject({
  ...base("watched_folder_scan"),
  folderId: idSchema,
  reason: z.enum(["startup", "event", "periodic", "manual", "recovered"])
});
export const sourceReconcileJobPayloadSchema = z.strictObject({
  ...base("source_reconcile"),
  reason: z.enum(["startup", "periodic", "recovered"])
});
export const jobPayloadSchema = z.discriminatedUnion("type", [
  probeJobPayloadSchema,
  hashJobPayloadSchema,
  analyzeJobPayloadSchema,
  candidatesJobPayloadSchema,
  renderJobPayloadSchema,
  watchedFolderScanJobPayloadSchema,
  sourceReconcileJobPayloadSchema
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
export const watchedFolderScanJobResultSchema = z.strictObject({
  ...base("watched_folder_scan"), folderId: idSchema,
  discovered: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  relinked: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative()
});
export const sourceReconcileJobResultSchema = z.strictObject({
  ...base("source_reconcile"),
  checked: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  restored: z.number().int().nonnegative()
});
export const jobResultSchema = z.discriminatedUnion("type", [
  probeJobResultSchema,
  hashJobResultSchema,
  analyzeJobResultSchema,
  candidatesJobResultSchema,
  renderJobResultSchema,
  watchedFolderScanJobResultSchema,
  sourceReconcileJobResultSchema
]);
export type JobResult = z.infer<typeof jobResultSchema>;

export const jobMessageTypes = [
  "probe", "hash", "analyze", "candidates", "render",
  "watched_folder_scan", "source_reconcile"
] as const;
export const JOB_MESSAGE_TYPES = jobMessageTypes;
export const jobPayloadSchemas = {
  probe: probeJobPayloadSchema,
  hash: hashJobPayloadSchema,
  analyze: analyzeJobPayloadSchema,
  candidates: candidatesJobPayloadSchema,
  render: renderJobPayloadSchema,
  watched_folder_scan: watchedFolderScanJobPayloadSchema,
  source_reconcile: sourceReconcileJobPayloadSchema
} as const;
export const jobResultSchemas = {
  probe: probeJobResultSchema,
  hash: hashJobResultSchema,
  analyze: analyzeJobResultSchema,
  candidates: candidatesJobResultSchema,
  render: renderJobResultSchema,
  watched_folder_scan: watchedFolderScanJobResultSchema,
  source_reconcile: sourceReconcileJobResultSchema
} as const;
