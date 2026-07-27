import { z } from "zod";

export const idSchema = z.string().uuid();
export type Id = z.infer<typeof idSchema>;

export const episodeStatusSchema = z.enum([
  "discovered", "indexing", "analyzing", "ready", "error", "source_missing"
]);
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;

export const episodeSchema = z.object({
  id: idSchema,
  sourcePath: z.string(),
  canonicalPath: z.string(),
  fingerprint: z.string(),
  contentHash: z.string().nullable(),
  fileSize: z.number().int().nonnegative(),
  modifiedAtMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  status: episodeStatusSchema,
  missing: z.boolean(),
  candidateCount: z.number().int().nonnegative(),
  renderedShortCount: z.number().int().nonnegative(),
  scheduledCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Episode = z.infer<typeof episodeSchema>;

export const transcriptWordSchema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  confidence: z.number().min(0).max(1).optional(),
  speaker: z.string().optional()
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

export const transcriptSegmentSchema = z.object({
  id: idSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
  words: z.array(transcriptWordSchema),
  speaker: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable()
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const scoreBreakdownSchema = z.object({
  hook: z.number().min(0).max(1),
  coherence: z.number().min(0).max(1),
  payoff: z.number().min(0).max(1),
  independence: z.number().min(0).max(1),
  delivery: z.number().min(0).max(1),
  visualActivity: z.number().min(0).max(1)
});

export const candidateSchema = z.object({
  id: idSchema,
  episodeId: idSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  transcript: z.string(),
  topic: z.string(),
  hook: z.string(),
  reason: z.string(),
  score: z.number().min(0).max(1),
  scores: scoreBreakdownSchema,
  duplicateGroup: z.string().nullable(),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string()
});
export type ClipCandidate = z.infer<typeof candidateSchema>;

export const cropKeyframeSchema = z.object({
  atMs: z.number().int().nonnegative(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
  source: z.enum(["automatic", "manual"])
});

export const layerSchema = z.object({
  id: z.string(),
  type: z.enum(["video", "image", "captions", "shape", "logo"]),
  source: z.enum(["episode", "asset", "none"]),
  region: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1)
  }),
  fit: z.enum(["fill", "fit"]),
  cropTrack: z.array(cropKeyframeSchema).default([])
});

export const compositionSchema = z.object({
  width: z.literal(1080),
  height: z.literal(1920),
  background: z.string(),
  safeArea: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),
  layers: z.array(layerSchema)
});
export type Composition = z.infer<typeof compositionSchema>;

export const shortProjectSchema = z.object({
  id: idSchema,
  episodeId: idSchema,
  candidateId: idSchema.nullable(),
  title: z.string(),
  sourceRanges: z.array(z.object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive()
  })).min(1),
  templateId: z.string(),
  composition: compositionSchema,
  copy: z.object({
    cleanedTranscript: z.string(),
    rewrite: z.string(),
    hookVariants: z.array(z.string()),
    titles: z.array(z.string()),
    description: z.string(),
    hashtags: z.array(z.string()),
    thumbnailText: z.string()
  }),
  approved: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ShortProject = z.infer<typeof shortProjectSchema>;

export const jobSchema = z.object({
  id: idSchema,
  type: z.enum(["probe", "hash", "analyze", "candidates", "render"]),
  entityId: idSchema.nullable(),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  progress: z.number().min(0).max(1),
  stage: z.string(),
  attempts: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Job = z.infer<typeof jobSchema>;

export const scheduleRulesSchema = z.object({
  startDate: z.string().date(),
  timezone: z.string().min(1),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).min(1),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1),
  maxPerDay: z.number().int().positive(),
  blackoutDates: z.array(z.string().date()),
  minimumSameEpisodeSpacingHours: z.number().int().nonnegative()
});
export type ScheduleRules = z.infer<typeof scheduleRulesSchema>;

export type ApiErrorCode =
  | "NOT_FOUND" | "VALIDATION_ERROR" | "REVISION_CONFLICT"
  | "SOURCE_MISSING" | "DEPENDENCY_UNAVAILABLE" | "CLOUD_NOT_AUTHORIZED"
  | "INVALID_STATE" | "SCHEDULE_COLLISION" | "INTERNAL_ERROR";

export interface ApiErrorShape {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiResult<T> {
  data: T;
  apiVersion: "v1";
}
