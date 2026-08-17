import { z } from "zod";
import { idSchema, normalizedRectangleSchema, positiveRevisionSchema, utcInstantSchema } from "./validators.js";
import { candidateSchema, compositionSchema, renderPreflightResultSchema, renderSchema, shortProjectSchema } from "./contracts.js";

export const shortWorkflowStates = [
  "importing", "analyzing", "selecting_candidate", "assembling_draft",
  "awaiting_review", "preflighting", "rendering", "exporting", "failed",
  "cancelled", "completed"
] as const;
export const shortWorkflowStateSchema = z.enum(shortWorkflowStates);
export const graphicsPresetSchema = z.enum(["hook", "lower_third", "end_card"]);
export const motionGraphicLayerSchema = z.strictObject({
  id: z.string().min(1),
  visible: z.boolean().default(true),
  type: z.literal("motion_graphic"),
  source: z.literal("none"),
  assetId: z.null(),
  region: normalizedRectangleSchema,
  fit: z.literal("fit"),
  preset: graphicsPresetSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  primaryText: z.string().trim().min(1).max(160),
  secondaryText: z.string().trim().max(160).default(""),
  theme: z.enum(["dark", "light", "accent"]).default("dark")
}).refine((layer) => layer.endMs > layer.startMs, {
  path: ["endMs"], message: "Motion graphic end must be after its start"
});
export type MotionGraphicLayer = z.infer<typeof motionGraphicLayerSchema>;
export const graphicsPreferenceSchema = z.strictObject({
  enabled: z.boolean().default(true),
  presets: z.array(graphicsPresetSchema).max(3).default(["hook", "lower_third", "end_card"]),
  speakerName: z.string().trim().min(1).max(80).optional(),
  speakerRole: z.string().trim().min(1).max(100).optional(),
  callToAction: z.string().trim().min(1).max(120).optional()
});
export const createShortWorkflowInputSchema = z.strictObject({
  sourcePath: z.string().min(1),
  targetDurationMs: z.number().int().min(1_000).max(180_000).default(45_000),
  creativeDirection: z.string().trim().max(2_000).optional(),
  templateId: z.string().min(1).optional(),
  captionsEnabled: z.boolean().default(true),
  graphics: graphicsPreferenceSchema.default({ enabled: true, presets: ["hook", "lower_third", "end_card"] }),
  exportDirectory: z.string().min(1).optional(),
  reviewMode: z.enum(["review_required", "auto_approve"]).default("review_required"),
  idempotencyKey: z.string().min(1).max(200).optional()
});
export type CreateShortWorkflowInput = z.infer<typeof createShortWorkflowInputSchema>;

export const workflowFailureSchema = z.strictObject({
  code: z.string().min(1), message: z.string().min(1), retryable: z.boolean(),
  stage: shortWorkflowStateSchema
});
export const workflowProgressSchema = z.strictObject({
  value: z.number().min(0).max(1), stage: z.string().min(1)
});
export const shortWorkflowSchema = z.strictObject({
  id: idSchema,
  state: shortWorkflowStateSchema,
  revision: positiveRevisionSchema,
  input: createShortWorkflowInputSchema,
  progress: workflowProgressSchema,
  warnings: z.array(z.string()),
  episodeId: idSchema.nullable(),
  analysisJobId: idSchema.nullable(),
  candidateId: idSchema.nullable(),
  shortId: idSchema.nullable(),
  preflightId: idSchema.nullable(),
  renderId: idSchema.nullable(),
  renderJobId: idSchema.nullable(),
  exportPath: z.string().nullable(),
  candidate: candidateSchema.nullable().optional(),
  composition: compositionSchema.nullable().optional(),
  graphicsProposal: z.array(motionGraphicLayerSchema),
  short: shortProjectSchema.nullable().optional(),
  preflight: renderPreflightResultSchema.nullable().optional(),
  render: renderSchema.nullable().optional(),
  failure: workflowFailureSchema.nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type ShortWorkflow = z.infer<typeof shortWorkflowSchema>;
export const resumeShortWorkflowInputSchema = z.strictObject({
  workflowId: idSchema,
  expectedRevision: positiveRevisionSchema,
  action: z.enum(["approve_draft", "retry"])
});
export const cancelShortWorkflowInputSchema = z.strictObject({
  workflowId: idSchema,
  expectedRevision: positiveRevisionSchema
});
export const exportRenderInputSchema = z.strictObject({
  renderId: idSchema,
  directory: z.string().min(1),
  filename: z.string().min(1).max(240).optional()
});
export const renderExportResultSchema = z.strictObject({
  renderId: idSchema, path: z.string().min(1), contentHash: z.string().min(1)
});
