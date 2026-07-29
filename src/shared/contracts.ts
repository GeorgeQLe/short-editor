import { z } from "zod";
import { apiErrorCodeSchema } from "./error-contracts.js";
import {
  dateSchema,
  idSchema,
  ianaTimezoneSchema,
  normalizedRectangleSchema,
  positiveRevisionSchema,
  sourceRangeSchema,
  sourceRangesSchema,
  timeRangeSchema,
  utcInstantSchema,
  wallTimeSchema
} from "./validators.js";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const pageSchema = <T extends z.ZodType>(itemSchema: T) => z.strictObject({
  items: z.array(itemSchema),
  nextCursor: z.string().min(1).nullable()
});

export const apiSuccessEnvelopeSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.strictObject({
    apiVersion: z.literal("v1"),
    data: dataSchema
  });

export type ImportRejectionCode = "VALIDATION_ERROR" | "DEPENDENCY_UNAVAILABLE";

export interface ImportRejectedResult {
  path: string;
  code: ImportRejectionCode;
  reason: string;
}

export const importRejectedResultSchema = z.strictObject({
  path: z.string(),
  code: z.enum(["VALIDATION_ERROR", "DEPENDENCY_UNAVAILABLE"]),
  reason: z.string().min(1)
});

const nullableNonempty = z.string().min(1).nullable();
const confidenceSchema = z.number().min(0).max(1);
const jsonValueSchema: z.ZodType<unknown> = z.json();

export const episodeStatuses = [
  "discovered", "indexing", "analyzing", "ready", "error", "source_missing"
] as const;
export const episodeStatusSchema = z.enum(episodeStatuses);
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;

export const episodeSchema = z.strictObject({
  id: idSchema,
  sourcePath: z.string().min(1),
  canonicalPath: z.string().min(1),
  fingerprint: z.string().min(1),
  contentHash: nullableNonempty,
  fileSize: z.number().int().nonnegative(),
  modifiedAtMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  videoCodec: nullableNonempty,
  audioCodec: nullableNonempty,
  status: episodeStatusSchema,
  missing: z.boolean(),
  relinkRestoreStatus: z.enum(["discovered", "ready", "indexing"]).nullable(),
  candidateCount: z.number().int().nonnegative(),
  renderedShortCount: z.number().int().nonnegative(),
  scheduledCount: z.number().int().nonnegative(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Episode = z.infer<typeof episodeSchema>;

export const importResultSchema = z.strictObject({
  imported: z.array(episodeSchema),
  duplicates: z.array(episodeSchema),
  relinked: z.array(episodeSchema),
  rejected: z.array(importRejectedResultSchema)
});

export const watchedFolderScanStatuses = ["never_scanned", "scanning", "succeeded", "failed"] as const;
export const watchedFolderScanStatusSchema = z.enum(watchedFolderScanStatuses);
export const watchedFolderSchema = z.strictObject({
  id: idSchema,
  canonicalPath: z.string().min(1),
  enabled: z.boolean(),
  recursive: z.boolean(),
  includePatterns: z.array(z.string().min(1)),
  lastScanStatus: watchedFolderScanStatusSchema,
  lastScannedAt: utcInstantSchema.nullable(),
  lastScanError: nullableNonempty,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type WatchedFolder = z.infer<typeof watchedFolderSchema>;
export const watchedFolderConfigurationInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    path: z.string().min(1),
    enabled: z.boolean().optional(),
    recursive: z.boolean().optional(),
    includePatterns: z.array(z.string().min(1)).optional()
  }),
  z.strictObject({
    action: z.literal("update"),
    folderId: idSchema,
    path: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    recursive: z.boolean().optional(),
    includePatterns: z.array(z.string().min(1)).optional()
  }),
  z.strictObject({ action: z.literal("rescan"), folderId: idSchema })
]);
export type WatchedFolderConfigurationInput =
  z.infer<typeof watchedFolderConfigurationInputSchema>;
export const relinkSourceResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("relinked"), episode: episodeSchema }),
  z.strictObject({
    status: z.literal("confirmation_required"),
    confirmationToken: z.string().min(1),
    expiresAt: utcInstantSchema
  })
]);
export type RelinkSourceResult = z.infer<typeof relinkSourceResultSchema>;

export const providerClasses = ["local", "network", "cloud"] as const;
export const providerClassSchema = z.enum(providerClasses);
export const providerProvenanceSchema = z.strictObject({
  provider: z.string().min(1),
  providerClass: providerClassSchema,
  modelId: z.string().min(1),
  providerVersion: z.string().min(1),
  optionsVersion: z.string().min(1),
  providerRequestId: z.string().min(1).nullable().optional(),
  requestedModelId: z.string().min(1).optional(),
  returnedModelId: z.string().min(1).optional(),
  adapterVersion: z.string().min(1).optional(),
  promptVersion: z.string().min(1).nullable().optional(),
  schemaVersion: z.string().min(1).nullable().optional(),
  createdAt: utcInstantSchema
});
export type ProviderProvenance = z.infer<typeof providerProvenanceSchema>;

export const transcriptWordSchema = timeRangeSchema.extend({
  text: z.string().refine((text) => text.trim().length > 0, "Word text must not be empty"),
  confidence: confidenceSchema.optional(),
  speaker: z.string().min(1).nullable().optional()
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

export const transcriptSegmentSchema = timeRangeSchema.extend({
  id: idSchema,
  text: z.string().refine((text) => text.trim().length > 0, "Segment text must not be empty"),
  words: z.array(transcriptWordSchema),
  speaker: z.string().min(1).nullable(),
  confidence: confidenceSchema.nullable()
}).superRefine((segment, context) => {
  let priorEnd = segment.startMs;
  segment.words.forEach((word, index) => {
    if (word.startMs < segment.startMs || word.endMs > segment.endMs) {
      context.addIssue({ code: "custom", path: ["words", index], message: "Word timing must be within its segment" });
    }
    if (word.startMs < priorEnd) {
      context.addIssue({ code: "custom", path: ["words", index, "startMs"], message: "Words must be ordered and non-overlapping" });
    }
    priorEnd = word.endMs;
  });
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const timedSegmentsSchema = z.array(transcriptSegmentSchema).min(1).superRefine((segments, context) => {
  for (let index = 1; index < segments.length; index++) {
    if (segments[index]!.startMs < segments[index - 1]!.endMs) {
      context.addIssue({ code: "custom", path: [index, "startMs"], message: "Segments must be ordered and non-overlapping" });
    }
  }
});

export const transcriptUpdateSegmentSchema = timeRangeSchema.extend({
  id: idSchema,
  text: z.string().refine((text) => text.trim().length > 0, "Segment text must not be empty"),
  words: z.array(transcriptWordSchema).nullable().optional().transform((words) => words ?? []),
  speaker: z.string().min(1).nullable().optional().transform((speaker) => speaker ?? null),
  confidence: confidenceSchema.nullable().optional().transform((confidence) => confidence ?? null)
}).superRefine((segment, context) => {
  let priorEnd = segment.startMs;
  segment.words.forEach((word, index) => {
    if (word.startMs < segment.startMs || word.endMs > segment.endMs) {
      context.addIssue({
        code: "custom",
        path: ["words", index],
        message: "Word timing must be within its segment"
      });
    }
    if (word.startMs < priorEnd) {
      context.addIssue({
        code: "custom",
        path: ["words", index, "startMs"],
        message: "Words must be ordered and non-overlapping"
      });
    }
    priorEnd = word.endMs;
  });
});

export const transcriptUpdateSegmentsSchema = z.array(transcriptUpdateSegmentSchema)
  .min(1)
  .superRefine((segments, context) => {
    for (let index = 1; index < segments.length; index++) {
      if (segments[index]!.startMs < segments[index - 1]!.endMs) {
        context.addIssue({
          code: "custom",
          path: [index, "startMs"],
          message: "Segments must be ordered and non-overlapping"
        });
      }
    }
  });

export const transcriptUpdateInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  language: z.string().trim().min(2),
  segments: transcriptUpdateSegmentsSchema
});
export type TranscriptUpdateInput = z.infer<typeof transcriptUpdateInputSchema>;

export const transcriptAcceptedStates = ["proposed", "accepted", "superseded"] as const;
export const transcriptAcceptedStateSchema = z.enum(transcriptAcceptedStates);
export const transcriptRevisionSchema = z.strictObject({
  id: idSchema,
  episodeId: idSchema,
  revision: positiveRevisionSchema,
  language: z.string().min(2),
  segments: timedSegmentsSchema,
  provenance: providerProvenanceSchema,
  acceptedState: transcriptAcceptedStateSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type TranscriptRevision = z.infer<typeof transcriptRevisionSchema>;

export const artifactKinds = [
  "transcript", "episode_analysis", "candidate_generation", "content_package", "reframing"
] as const;
export const artifactKindSchema = z.enum(artifactKinds);
export const artifactOwnerTypes = ["episode", "transcript_revision", "candidate", "short_project"] as const;
export const artifactOwnerTypeSchema = z.enum(artifactOwnerTypes);
export const artifactStates = ["proposed", "accepted", "superseded", "corrupt"] as const;
export const artifactStateSchema = z.enum(artifactStates);
export const analysisArtifactSchema = z.strictObject({
  id: idSchema,
  entityId: idSchema,
  ownerType: artifactOwnerTypeSchema,
  kind: artifactKindSchema,
  state: artifactStateSchema,
  provenance: providerProvenanceSchema,
  inputHash: z.string().min(1),
  rawOutput: jsonValueSchema,
  acceptedProjection: jsonValueSchema.nullable(),
  createdAt: utcInstantSchema
});
export type AnalysisArtifact = z.infer<typeof analysisArtifactSchema>;

export const scoreBreakdownSchema = z.strictObject({
  hook: confidenceSchema,
  coherence: confidenceSchema,
  payoff: confidenceSchema,
  independence: confidenceSchema,
  delivery: confidenceSchema,
  visualActivity: confidenceSchema
});
export const candidateReviewStatuses = ["pending", "approved", "rejected"] as const;
export const candidateReviewStatusSchema = z.enum(candidateReviewStatuses);
export const generationProvenanceSchema = z.strictObject({
  artifactId: idSchema.nullable(),
  transcriptRevision: positiveRevisionSchema,
  generationVersion: z.string().min(1),
  provider: providerProvenanceSchema.nullable()
});
export const candidateStates = ["active", "superseded"] as const;
export const candidateStateSchema = z.enum(candidateStates);
export const candidateSchema = z.strictObject({
  id: idSchema,
  episodeId: idSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  sourceRange: sourceRangeSchema.optional(),
  transcript: z.string().min(1),
  topic: z.string().min(1),
  hook: z.string().min(1),
  reason: z.string().min(1),
  score: confidenceSchema,
  scores: scoreBreakdownSchema,
  duplicateGroup: z.string().min(1).nullable(),
  reviewStatus: candidateReviewStatusSchema,
  generationProvenance: generationProvenanceSchema,
  generationRunId: idSchema.nullable(),
  revision: positiveRevisionSchema,
  state: candidateStateSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
}).superRefine((candidate, context) => {
  if (candidate.endMs <= candidate.startMs) {
    context.addIssue({ code: "custom", path: ["endMs"], message: "Candidate end must be after its start" });
  }
  if (candidate.sourceRange && (
    candidate.sourceRange.startMs !== candidate.startMs || candidate.sourceRange.endMs !== candidate.endMs
  )) {
    context.addIssue({ code: "custom", path: ["sourceRange"], message: "Source range must match candidate timing" });
  }
});
export type Candidate = z.infer<typeof candidateSchema>;
export type ClipCandidate = Candidate;

const candidateGenerationCountSchema = z.number().int().min(5).max(10).default(8);
export const candidateGenerationStrategies = ["replace_pending", "append_pending"] as const;
export const candidateGenerationStrategySchema = z.enum(candidateGenerationStrategies);
export const candidateGenerationInputSchema = z.union([
  z.strictObject({
    episodeId: idSchema,
    count: candidateGenerationCountSchema,
    strategy: candidateGenerationStrategySchema,
    mode: z.literal("analysis"),
    analysisArtifactId: idSchema
  }),
  z.strictObject({
    episodeId: idSchema,
    count: candidateGenerationCountSchema,
    strategy: candidateGenerationStrategySchema,
    mode: z.literal("heuristic").default("heuristic")
  })
]);
export type CandidateGenerationInput = z.input<typeof candidateGenerationInputSchema>;

const candidateGenerationCountsSchema = z.strictObject({
  requestedCount: z.number().int().min(5).max(10),
  generatedCount: z.number().int().nonnegative().max(10)
});
export const candidateGenerationDiagnosticSchema = z.discriminatedUnion("sufficient", [
  candidateGenerationCountsSchema.extend({
    sufficient: z.literal(true)
  }),
  candidateGenerationCountsSchema.extend({
    sufficient: z.literal(false),
    code: z.enum(["INSUFFICIENT_MATERIAL", "INSUFFICIENT_NOVEL_MATERIAL"]),
    minimumCandidateCount: z.literal(5),
    eligibleWindowCount: z.number().int().nonnegative(),
    rejectionCounts: z.strictObject({
      duration: z.number().int().nonnegative(),
      quality: z.number().int().nonnegative(),
      overlap: z.number().int().nonnegative(),
      semanticDuplication: z.number().int().nonnegative()
    })
  })
]).superRefine((diagnostic, context) => {
  if (diagnostic.generatedCount > diagnostic.requestedCount) {
    context.addIssue({
      code: "custom",
      path: ["generatedCount"],
      message: "Generated count cannot exceed requested count"
    });
  }
  if (diagnostic.sufficient && diagnostic.generatedCount < 5) {
    context.addIssue({
      code: "custom",
      path: ["generatedCount"],
      message: "A sufficient result must contain at least five Candidates"
    });
  }
  if (!diagnostic.sufficient && diagnostic.generatedCount >= 5) {
    context.addIssue({
      code: "custom",
      path: ["generatedCount"],
      message: "An insufficient result must contain fewer than five Candidates"
    });
  }
});
export type CandidateGenerationDiagnostic =
  z.infer<typeof candidateGenerationDiagnosticSchema>;
export const candidateGenerationRunSchema = z.strictObject({
  id: idSchema,
  episodeId: idSchema,
  transcriptRevision: positiveRevisionSchema,
  mode: z.enum(["heuristic", "analysis"]),
  analysisArtifactId: idSchema.nullable(),
  provider: providerProvenanceSchema.nullable(),
  strategy: candidateGenerationStrategySchema,
  generationVersion: z.string().min(1),
  requestedCount: z.number().int().min(5).max(10),
  proposedCount: z.number().int().nonnegative().max(10),
  insertedCount: z.number().int().nonnegative().max(10),
  retainedDecisionConflictCount: z.number().int().nonnegative(),
  retainedPendingConflictCount: z.number().int().nonnegative(),
  diagnostic: candidateGenerationDiagnosticSchema,
  createdAt: utcInstantSchema
});
export type CandidateGenerationRun = z.infer<typeof candidateGenerationRunSchema>;
export const candidateGenerationResultSchema = z.strictObject({
  candidates: z.array(candidateSchema).max(10),
  diagnostic: candidateGenerationDiagnosticSchema,
  run: candidateGenerationRunSchema
}).superRefine((result, context) => {
  if (result.candidates.length !== result.diagnostic.generatedCount) {
    context.addIssue({
      code: "custom",
      path: ["diagnostic", "generatedCount"],
      message: "Generated count must match the Candidate array"
    });
  }
  if (result.run.insertedCount !== result.candidates.length) {
    context.addIssue({
      code: "custom",
      path: ["run", "insertedCount"],
      message: "Run inserted count must match the Candidate array"
    });
  }
  if (result.run.proposedCount < result.run.insertedCount) {
    context.addIssue({
      code: "custom",
      path: ["run", "proposedCount"],
      message: "Run proposed count cannot be smaller than inserted count"
    });
  }
  if (JSON.stringify(result.run.diagnostic) !== JSON.stringify(result.diagnostic)) {
    context.addIssue({
      code: "custom",
      path: ["run", "diagnostic"],
      message: "Run diagnostic must match the generation result"
    });
  }
});
export type CandidateGenerationResult = z.infer<typeof candidateGenerationResultSchema>;

const cropRectangleAtSchema = z.strictObject({
  atMs: z.number().int().nonnegative(),
  ...normalizedRectangleSchema.shape
});

function orderedUniqueTimes<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).superRefine((items, context) => {
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1] as { atMs: number };
      const current = items[index] as { atMs: number };
      if (current.atMs <= previous.atMs) {
        context.addIssue({
          code: "custom",
          path: [index, "atMs"],
          message: "Crop timestamps must be unique and strictly increasing"
        });
      }
    }
  });
}

export const cropDetectionObservationSchema = z.strictObject({
  ...normalizedRectangleSchema.shape,
  confidence: z.number().min(0).max(1).optional()
});
export type CropDetectionObservation = z.infer<typeof cropDetectionObservationSchema>;

export const visualCropSampleSchema = z.strictObject({
  atMs: z.number().int().nonnegative(),
  activity: z.number().min(0).max(1),
  speakerFraming: z.number().min(0).max(1).nullable(),
  faceCount: z.number().int().nonnegative().nullable(),
  screenShare: z.boolean().nullable(),
  faces: z.array(cropDetectionObservationSchema).optional(),
  people: z.array(cropDetectionObservationSchema).optional(),
  screens: z.array(cropDetectionObservationSchema).optional()
});
export type VisualCropSample = z.infer<typeof visualCropSampleSchema>;

export const automaticCropFrameSchema = cropRectangleAtSchema;
export type AutomaticCropFrame = z.infer<typeof automaticCropFrameSchema>;
export const automaticCropProvenanceSchema = z.strictObject({
  artifactId: idSchema,
  artifactContentHash: z.string().min(1),
  generatorVersion: z.string().min(1),
  smoothingVersion: z.string().min(1),
  target: z.enum(["person", "screen", "auto"]),
  sourceWidth: z.number().int().positive().nullable(),
  sourceHeight: z.number().int().positive().nullable(),
  generatedAt: utcInstantSchema
});
export const automaticCropFallbackSchema = z.strictObject({
  mode: z.enum(["none", "fit", "fill"]),
  reason: z.enum([
    "none",
    "missing_samples",
    "missing_detections",
    "unsupported_detection",
    "missing_dimensions",
    "unmatched_source"
  ])
}).superRefine((fallback, context) => {
  if ((fallback.mode === "none") !== (fallback.reason === "none")) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "A fallback mode and reason must either both be present or both be absent"
    });
  }
});
export const automaticCropTrackSchema = z.strictObject({
  frames: orderedUniqueTimes(automaticCropFrameSchema),
  provenance: automaticCropProvenanceSchema.nullable(),
  fallback: automaticCropFallbackSchema
});
export type AutomaticCropTrack = z.infer<typeof automaticCropTrackSchema>;

export const manualCropControlSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    id: idSchema,
    mode: z.literal("crop"),
    atMs: z.number().int().nonnegative(),
    x: normalizedRectangleSchema.shape.x,
    y: normalizedRectangleSchema.shape.y,
    width: normalizedRectangleSchema.shape.width,
    height: normalizedRectangleSchema.shape.height
  }).superRefine((frame, context) => {
    if (frame.x + frame.width > 1) {
      context.addIssue({ code: "custom", path: ["width"], message: "Crop exceeds horizontal bounds" });
    }
    if (frame.y + frame.height > 1) {
      context.addIssue({ code: "custom", path: ["height"], message: "Crop exceeds vertical bounds" });
    }
  }),
  z.strictObject({
    id: idSchema,
    mode: z.literal("automatic"),
    atMs: z.number().int().nonnegative()
  })
]);
export type ManualCropControl = z.infer<typeof manualCropControlSchema>;
export const manualCropTrackSchema = orderedUniqueTimes(manualCropControlSchema);

const layerBase = {
  id: z.string().min(1),
  source: z.enum(["episode", "asset", "none"]),
  assetId: idSchema.nullable(),
  region: normalizedRectangleSchema,
  fit: z.enum(["fill", "fit"])
};
const captionColorSchema = z.string().regex(
  /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/,
  "Colors must use #RRGGBB or #RRGGBBAA"
);
export const captionStyleSchema = z.strictObject({
  fontFamily: z.literal("Inter"),
  fontWeight: z.union([z.literal(400), z.literal(700)]),
  fontSizePx: z.number().int().min(12).max(200),
  position: z.strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1)
  }),
  maxWidth: z.number().min(0.1).max(1),
  textColor: captionColorSchema,
  highlightColor: captionColorSchema,
  textTransform: z.enum(["none", "uppercase"]).default("none"),
  outline: z.strictObject({
    color: captionColorSchema,
    widthPx: z.number().min(0).max(20)
  }),
  background: z.strictObject({
    color: captionColorSchema,
    paddingPx: z.number().min(0).max(100),
    cornerRadiusPx: z.number().min(0).max(100)
  })
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const textLayerStyleSchema = z.strictObject({
  fontFamily: z.literal("Inter"),
  fontWeight: z.union([z.literal(400), z.literal(700)]),
  fontSizePx: z.number().int().min(12).max(200),
  color: captionColorSchema,
  backgroundColor: captionColorSchema,
  backgroundPaddingPx: z.number().min(0).max(100),
  align: z.enum(["left", "center", "right"]),
  verticalAlign: z.enum(["top", "center", "bottom"]),
  wrap: z.boolean(),
  maxLines: z.number().int().min(1).max(20),
  overflow: z.enum(["clip", "ellipsis"]),
  textTransform: z.enum(["none", "uppercase"])
});
export const textLayerContentSchema = z.union([
  z.string(),
  z.null(),
  z.strictObject({ binding: z.literal("short_title") })
]);
const emptyAutomaticCropTrack = {
  frames: [],
  provenance: null,
  fallback: { mode: "fit" as const, reason: "missing_samples" as const }
};
export const videoLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal("video"),
  cropTarget: z.enum(["person", "screen", "auto"]).default("auto"),
  automaticCropTrack: automaticCropTrackSchema.default(emptyAutomaticCropTrack),
  manualCropTrack: manualCropTrackSchema.default([])
});
export const nonVideoLayerSchema = z.strictObject({
  ...layerBase,
  type: z.enum(["image", "captions", "shape", "logo"])
});
export const mediaLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal("media"),
  source: z.literal("asset")
});
export const textLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal("text"),
  source: z.literal("none"),
  assetId: z.null(),
  content: textLayerContentSchema,
  style: textLayerStyleSchema
});
export const layerSchema = z.discriminatedUnion("type", [
  videoLayerSchema,
  nonVideoLayerSchema,
  mediaLayerSchema,
  textLayerSchema
]);
export const compositionSchema = z.strictObject({
  width: z.literal(1080),
  height: z.literal(1920),
  background: z.string().min(1),
  safeArea: z.strictObject({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative()
  }),
  layers: z.array(layerSchema),
  captionStylePreset: captionStyleSchema.optional()
});
export type Composition = z.infer<typeof compositionSchema>;

export const contentPackageSchema = z.strictObject({
  cleanedTranscript: z.string(),
  rewrite: z.string(),
  hookVariants: z.array(z.string()),
  titles: z.array(z.string()),
  description: z.string(),
  hashtags: z.array(z.string()),
  thumbnailText: z.string()
});
export type ContentPackage = z.infer<typeof contentPackageSchema>;
export const candidateContentPackageSchema = z.strictObject({
  candidateId: idSchema,
  candidateRevision: positiveRevisionSchema,
  proposalArtifactId: idSchema,
  proposed: contentPackageSchema,
  accepted: contentPackageSchema.nullable(),
  proposalProvenance: providerProvenanceSchema,
  inputHash: z.string().min(1)
});
export type CandidateContentPackage = z.infer<typeof candidateContentPackageSchema>;
export const candidateContentPackageAcceptInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  contentPackage: contentPackageSchema
});
export const captionWordSchema = timeRangeSchema.extend({
  text: z.string().refine((text) => text.trim().length > 0, "Word text must not be empty")
});
export type CaptionWord = z.infer<typeof captionWordSchema>;
export const captionCueSchema = timeRangeSchema.extend({
  id: idSchema,
  text: z.string().refine((text) => text.trim().length > 0, "Cue text must not be empty"),
  words: z.array(captionWordSchema)
}).superRefine((cue, context) => {
  let priorEnd = cue.startMs;
  cue.words.forEach((word, index) => {
    if (word.startMs < cue.startMs || word.endMs > cue.endMs) {
      context.addIssue({
        code: "custom", path: ["words", index],
        message: "Word timing must be within its cue"
      });
    }
    if (word.startMs < priorEnd) {
      context.addIssue({
        code: "custom", path: ["words", index, "startMs"],
        message: "Words must be ordered and non-overlapping"
      });
    }
    priorEnd = word.endMs;
  });
});
export type CaptionCue = z.infer<typeof captionCueSchema>;
export const captionCuesSchema = z.array(captionCueSchema).superRefine((cues, context) => {
  const seen = new Set<string>();
  cues.forEach((cue, index) => {
    if (seen.has(cue.id)) {
      context.addIssue({
        code: "custom", path: [index, "id"], message: "Caption cue IDs must be unique"
      });
    }
    seen.add(cue.id);
  });
});
export const captionWarningCodes = [
  "CAPTION_OVERFLOW",
  "CAPTION_SAFE_AREA",
  "CAPTION_MISSING_GLYPH",
  "CAPTION_SHORT_CUE",
  "CAPTION_OVERLAP",
  "CAPTION_OUTSIDE_SOURCE_RANGE"
] as const;
export const captionWarningCodeSchema = z.enum(captionWarningCodes);
export type CaptionWarningCode = z.infer<typeof captionWarningCodeSchema>;
export const captionWarningSchema = z.strictObject({
  code: captionWarningCodeSchema,
  cueId: idSchema,
  message: z.string().min(1)
});
export type CaptionWarning = z.infer<typeof captionWarningSchema>;
export const captionSidecarReferenceSchema = z.strictObject({
  artifactId: idSchema,
  format: z.enum(["srt", "webvtt"]),
  relativePath: z.string().min(1),
  contentHash: z.string().min(1),
  byteLength: z.number().int().nonnegative()
});
export type CaptionSidecarReference = z.infer<typeof captionSidecarReferenceSchema>;
export const captionSidecarsSchema = z.strictObject({
  srt: captionSidecarReferenceSchema.nullable(),
  webvtt: captionSidecarReferenceSchema.nullable()
});
export const captionStateSchema = z.strictObject({
  enabled: z.boolean(),
  cues: captionCuesSchema,
  style: captionStyleSchema,
  warnings: z.array(captionWarningSchema),
  sidecars: captionSidecarsSchema
});
export type CaptionState = z.infer<typeof captionStateSchema>;
export const captionUpdateInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  enabled: z.boolean(),
  cues: captionCuesSchema,
  style: captionStyleSchema
});
export type CaptionUpdateInput = z.infer<typeof captionUpdateInputSchema>;
export const audioWarningCodes = ["AUDIO_SPEECH_BACKGROUND_RATIO"] as const;
export const audioWarningCodeSchema = z.enum(audioWarningCodes);
export type AudioWarningCode = z.infer<typeof audioWarningCodeSchema>;
export const audioWarningSchema = z.strictObject({
  code: audioWarningCodeSchema,
  message: z.string().min(1)
});
export type AudioWarning = z.infer<typeof audioWarningSchema>;

const sourceGainDbSchema = z.number().finite().min(-60).max(12);
const bedGainDbSchema = z.number().finite().min(-60).max(0);
const cutFadeMsSchema = z.number().int().min(0).max(500);
const audioSettingsShape = {
  sourceGainDb: sourceGainDbSchema,
  sourceMuted: z.boolean(),
  cutFadeMs: cutFadeMsSchema,
  bedAssetId: idSchema.nullable(),
  bedGainDb: bedGainDbSchema.nullable()
};
const validateBedPair = (
  audio: { bedAssetId: string | null; bedGainDb: number | null },
  context: z.RefinementCtx
) => {
  if ((audio.bedAssetId === null) !== (audio.bedGainDb === null)) {
    context.addIssue({
      code: "custom",
      path: [audio.bedAssetId === null ? "bedAssetId" : "bedGainDb"],
      message: "bedAssetId and bedGainDb must both be null or both be set"
    });
  }
};
export const audioStateSchema = z.strictObject({
  ...audioSettingsShape,
  warnings: z.array(audioWarningSchema)
}).superRefine(validateBedPair);
export type AudioState = z.infer<typeof audioStateSchema>;
export const audioUpdateInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  ...audioSettingsShape
}).superRefine(validateBedPair);
export type AudioUpdateInput = z.infer<typeof audioUpdateInputSchema>;

export const sourceAudioDecisionSchema = z.strictObject({
  source: z.literal("episode"),
  episodeId: idSchema,
  sourceStartMs: z.number().int().nonnegative(),
  sourceEndMs: z.number().int().positive(),
  outputStartMs: z.number().int().nonnegative(),
  outputEndMs: z.number().int().positive(),
  gainDb: sourceGainDbSchema,
  muted: z.boolean(),
  fadeInMs: cutFadeMsSchema,
  fadeOutMs: cutFadeMsSchema
});
export const bedPlaybackSegmentSchema = z.strictObject({
  outputStartMs: z.number().int().nonnegative(),
  outputEndMs: z.number().int().positive(),
  assetStartMs: z.number().int().nonnegative(),
  assetEndMs: z.number().int().positive()
});
export const bedAudioDecisionSchema = z.strictObject({
  assetId: idSchema,
  gainDb: bedGainDbSchema,
  startsAtAssetTimeMs: z.literal(0),
  loops: z.boolean(),
  playback: z.array(bedPlaybackSegmentSchema)
});
export const audioDecisionSchema = z.strictObject({
  version: z.literal("audio-decisions-v1"),
  outputDurationMs: z.number().int().positive(),
  source: z.array(sourceAudioDecisionSchema).min(1),
  bed: bedAudioDecisionSchema.nullable(),
  warnings: z.array(audioWarningSchema)
});
export type AudioDecision = z.infer<typeof audioDecisionSchema>;
export const templateLineageSchema = z.strictObject({
  templateId: z.string().min(1),
  templateVersion: positiveRevisionSchema,
  parentTemplateId: z.string().min(1).nullable()
});
export const shortProjectSchema = z.strictObject({
  id: idSchema,
  episodeId: idSchema,
  candidateId: idSchema.nullable(),
  title: z.string().min(1),
  sourceRanges: sourceRangesSchema,
  templateId: z.string().min(1),
  templateLineage: templateLineageSchema,
  composition: compositionSchema,
  captions: captionStateSchema,
  audio: audioStateSchema,
  copy: contentPackageSchema,
  copyState: z.enum(["proposed", "accepted"]),
  copySource: z.enum([
    "candidate_proposal", "candidate_accepted", "user_accepted", "legacy_accepted"
  ]),
  approved: z.boolean(),
  revision: positiveRevisionSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
}).superRefine((project, context) => {
  const durationMs = project.sourceRanges.reduce(
    (total, range) => total + range.endMs - range.startMs,
    0
  );
  project.composition.layers.forEach((layer, layerIndex) => {
    if (layer.type !== "video") return;
    const tracks = [
      ["automaticCropTrack", layer.automaticCropTrack.frames] as const,
      ["manualCropTrack", layer.manualCropTrack] as const
    ];
    for (const [track, controls] of tracks) {
      controls.forEach((control, controlIndex) => {
        if (control.atMs > durationMs) {
          context.addIssue({
            code: "custom",
            path: ["composition", "layers", layerIndex, track, controlIndex, "atMs"],
            message: "Crop timestamp exceeds the Short output duration"
          });
        }
      });
    }
  });
});
export type ShortProject = z.infer<typeof shortProjectSchema>;

export const captionUpdateResultSchema = z.strictObject({
  short: shortProjectSchema,
  warnings: z.array(captionWarningSchema),
  sidecars: captionSidecarsSchema
});
export type CaptionUpdateResult = z.infer<typeof captionUpdateResultSchema>;

export const audioUpdateResultSchema = z.strictObject({
  short: shortProjectSchema,
  warnings: z.array(audioWarningSchema)
});
export type AudioUpdateResult = z.infer<typeof audioUpdateResultSchema>;

export const shortTimelineUpdateInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  sourceRanges: sourceRangesSchema
});
export type ShortTimelineUpdateInput = z.infer<typeof shortTimelineUpdateInputSchema>;

export const shortApprovalInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema
});
export type ShortApprovalInput = z.infer<typeof shortApprovalInputSchema>;

export const cropReanalysisInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  layerIds: z.array(z.string().min(1)).min(1).optional()
});
export type CropReanalysisInput = z.infer<typeof cropReanalysisInputSchema>;
export const manualCropAddInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  control: manualCropControlSchema
});
export type ManualCropAddInput = z.infer<typeof manualCropAddInputSchema>;
export const manualCropMoveInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  controlId: idSchema,
  atMs: z.number().int().nonnegative(),
  crop: normalizedRectangleSchema.optional()
});
export type ManualCropMoveInput = z.infer<typeof manualCropMoveInputSchema>;
export const manualCropRemoveInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  controlId: idSchema
});
export type ManualCropRemoveInput = z.infer<typeof manualCropRemoveInputSchema>;

export const templateSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: positiveRevisionSchema,
  revision: positiveRevisionSchema,
  parentTemplateId: z.string().min(1).nullable(),
  builtIn: z.boolean(),
  composition: compositionSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Template = z.infer<typeof templateSchema>;
export const templateCloneInputSchema = z.strictObject({
  name: z.string().trim().min(1),
  description: z.string().optional()
});
export type TemplateCloneInput = z.infer<typeof templateCloneInputSchema>;
export const templateUpdateInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  composition: compositionSchema.optional()
}).refine((input) =>
  input.name !== undefined || input.description !== undefined || input.composition !== undefined, {
  message: "At least one template change is required"
});
export type TemplateUpdateInput = z.infer<typeof templateUpdateInputSchema>;

export const assetKinds = ["image", "video", "audio", "logo"] as const;
export const assetKindSchema = z.enum(assetKinds);
export const assetSchema = z.strictObject({
  id: idSchema,
  sourcePath: z.string().min(1).nullable(),
  ownedArtifactPath: z.string().min(1).nullable(),
  kind: assetKindSchema,
  provenance: z.string().min(1),
  reusable: z.boolean(),
  tags: z.array(z.string().min(1)),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
}).refine((asset) => (asset.sourcePath === null) !== (asset.ownedArtifactPath === null), {
  path: ["sourcePath"],
  message: "Exactly one asset path must be supplied"
});
export type Asset = z.infer<typeof assetSchema>;
export const assetImportInputSchema = z.strictObject({
  path: z.string().trim().min(1),
  provenance: z.string().trim().min(1),
  reusable: z.boolean()
});
export type AssetImportInput = z.infer<typeof assetImportInputSchema>;

export const renderStates = ["queued", "running", "succeeded", "failed", "cancelled", "stale"] as const;
export const renderStateSchema = z.enum(renderStates);
export const validationSeverities = ["error", "warning"] as const;
export const validationSeveritySchema = z.enum(validationSeverities);
export const renderValidationFindingSchema = z.strictObject({
  code: z.string().min(1),
  severity: validationSeveritySchema,
  message: z.string().min(1),
  details: jsonValueSchema.optional()
});
export const renderValidationResultSchema = z.strictObject({
  valid: z.boolean(),
  findings: z.array(renderValidationFindingSchema),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  videoCodec: nullableNonempty,
  audioCodec: nullableNonempty,
  validatedAt: utcInstantSchema
});
export type RenderValidationResult = z.infer<typeof renderValidationResultSchema>;
export const RENDER_DETERMINISM_VERSION = "render-determinism-v1" as const;
const sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const normalizedStreamEvidenceSchema = z.strictObject({
  sha256: sha256DigestSchema,
  byteCount: z.number().int().positive()
});
export const renderDeterminismComparisons = ["baseline", "matched", "mismatch"] as const;
export const renderDeterminismComparisonSchema = z.enum(renderDeterminismComparisons);
export const renderDeterminismSchema = z.strictObject({
  version: z.literal(RENDER_DETERMINISM_VERSION),
  algorithm: z.literal("sha256"),
  video: normalizedStreamEvidenceSchema.extend({
    pixelFormat: z.literal("yuv420p"),
    width: z.literal(1080),
    height: z.literal(1920)
  }),
  audio: normalizedStreamEvidenceSchema.extend({
    sampleFormat: z.literal("s16le"),
    sampleRate: z.literal(48_000),
    channels: z.literal(2)
  }),
  identityHash: sha256DigestSchema,
  comparison: renderDeterminismComparisonSchema,
  referenceRenderId: idSchema.nullable()
}).superRefine((evidence, context) => {
  if (evidence.comparison === "baseline" && evidence.referenceRenderId !== null) {
    context.addIssue({
      code: "custom",
      path: ["referenceRenderId"],
      message: "Baseline evidence cannot reference another Render"
    });
  }
  if (evidence.comparison !== "baseline" && evidence.referenceRenderId === null) {
    context.addIssue({
      code: "custom",
      path: ["referenceRenderId"],
      message: "Compared evidence must reference the baseline Render"
    });
  }
});
export type RenderDeterminism = z.infer<typeof renderDeterminismSchema>;
export const renderSchema = z.strictObject({
  id: idSchema,
  shortId: idSchema,
  projectRevision: positiveRevisionSchema,
  lineageId: idSchema,
  previousRenderId: idSchema.nullable(),
  attempt: positiveRevisionSchema,
  preflightId: idSchema.nullable(),
  encoder: z.strictObject({
    ffmpegVersion: z.string().min(1),
    videoCodec: z.string().min(1),
    audioCodec: z.string().min(1),
    settings: jsonValueSchema
  }),
  outputPath: z.string().min(1).nullable(),
  sidecarPath: z.string().min(1).nullable(),
  validation: renderValidationResultSchema.nullable(),
  determinism: renderDeterminismSchema.nullable(),
  state: renderStateSchema,
  error: z.strictObject({ code: apiErrorCodeSchema, message: z.string().min(1) }).nullable(),
  contentHash: nullableNonempty,
  decisionHash: nullableNonempty,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Render = z.infer<typeof renderSchema>;

export const renderSidecarFormatSchema = z.enum(["srt", "webvtt"]).nullable();
export const renderStartRequestSchema = z.strictObject({
  shortId: idSchema,
  expectedRevision: positiveRevisionSchema,
  preflightId: idSchema,
  sidecarFormat: renderSidecarFormatSchema.default(null)
});
export type RenderStartRequest = z.infer<typeof renderStartRequestSchema>;
export const renderStartResultSchema = z.strictObject({
  render: renderSchema,
  job: z.lazy(() => jobSchema)
});
export type RenderStartResult = z.infer<typeof renderStartResultSchema>;

export const renderPreflightFindingCodes = [
  "SHORT_NOT_APPROVED",
  "SOURCE_MISSING",
  "SOURCE_CHANGED",
  "SOURCE_PROBE_FAILED",
  "SOURCE_VIDEO_STREAM_MISSING",
  "SOURCE_VIDEO_STREAM_UNSUPPORTED",
  "SOURCE_AUDIO_STREAM_MISSING",
  "SOURCE_AUDIO_STREAM_UNSUPPORTED",
  "SOURCE_RANGE_INVALID",
  "ASSET_MISSING",
  "ASSET_CHANGED",
  "ASSET_KIND_MISMATCH",
  "ASSET_INTEGRITY_FAILED",
  "ASSET_PROBE_FAILED",
  "CAPTION_OVERFLOW",
  "CAPTION_SAFE_AREA",
  "CAPTION_MISSING_GLYPH",
  "CAPTION_SHORT_CUE",
  "CAPTION_OVERLAP",
  "CAPTION_OUTSIDE_SOURCE_RANGE",
  "CAPTION_FONT_UNAVAILABLE",
  "CROP_BOUNDS_INVALID",
  "CROP_TIMESTAMP_INVALID",
  "AUDIO_BED_INVALID",
  "AUDIO_SPEECH_BACKGROUND_RATIO",
  "AUDIO_SOURCE_MISSING",
  "DURATION_EXCEEDED",
  "FFMPEG_UNAVAILABLE",
  "FFPROBE_UNAVAILABLE",
  "OUTPUT_SETTINGS_INVALID",
  "SAFE_AREA_INVALID",
  "CONTENT_ID_WARNING"
] as const;
export const renderPreflightFindingCodeSchema = z.enum(renderPreflightFindingCodes);
export type RenderPreflightFindingCode =
  z.infer<typeof renderPreflightFindingCodeSchema>;
export const renderPreflightFindingCategories = [
  "approval",
  "source",
  "range",
  "asset",
  "caption",
  "crop",
  "audio",
  "duration",
  "dependency",
  "output",
  "safe_area",
  "content_id"
] as const;
export const renderPreflightFindingCategorySchema =
  z.enum(renderPreflightFindingCategories);
const findingDetailValueSchema = z.union([
  z.string().min(1),
  z.number().finite(),
  z.boolean()
]);
export const renderPreflightFindingSchema = z.strictObject({
  code: renderPreflightFindingCodeSchema,
  severity: validationSeveritySchema,
  category: renderPreflightFindingCategorySchema,
  message: z.string().min(1),
  remediation: z.string().min(1),
  details: z.record(z.string(), findingDetailValueSchema).optional(),
  helpUrl: z.string().url().optional()
});
export type RenderPreflightFinding = z.infer<typeof renderPreflightFindingSchema>;
export const renderPreflightRequestSchema = z.strictObject({
  shortId: idSchema,
  expectedRevision: positiveRevisionSchema
});
export type RenderPreflightRequest = z.infer<typeof renderPreflightRequestSchema>;
export const renderPreflightDependencyVersionsSchema = z.strictObject({
  ffmpeg: z.string().min(1).nullable(),
  ffprobe: z.string().min(1).nullable()
});
export const renderPreflightResultSchema = z.strictObject({
  id: idSchema,
  shortId: idSchema,
  revision: positiveRevisionSchema,
  snapshotHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(["passed", "failed"]),
  findings: z.array(renderPreflightFindingSchema),
  dependencyVersions: renderPreflightDependencyVersionsSchema,
  createdAt: utcInstantSchema
});
export type RenderPreflightResult = z.infer<typeof renderPreflightResultSchema>;

const uniqueScheduleValues = (
  values: readonly (string | number)[],
  context: z.RefinementCtx,
  path: string
) => {
  const seen = new Set<string | number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [path, index],
        message: `Duplicate ${path === "times" ? "wall time" : path === "allowedWeekdays" ? "weekday" : "blackout date"}`
      });
    }
    seen.add(value);
  });
};

export const scheduleRulesSchema = z.strictObject({
  startDate: dateSchema,
  timezone: ianaTimezoneSchema,
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).min(1),
  times: z.array(wallTimeSchema).min(1),
  maxPerDay: z.number().int().positive().max(1440),
  blackoutDates: z.array(dateSchema),
  minimumSameEpisodeSpacingHours: z.number().int().nonnegative().max(24 * 365)
}).superRefine((rules, context) => {
  uniqueScheduleValues(rules.allowedWeekdays, context, "allowedWeekdays");
  uniqueScheduleValues(rules.times, context, "times");
  uniqueScheduleValues(rules.blackoutDates, context, "blackoutDates");
  if (rules.maxPerDay > rules.times.length) {
    context.addIssue({
      code: "custom",
      path: ["maxPerDay"],
      message: "Daily cap cannot exceed the number of configured wall times"
    });
  }
});
export type ScheduleRules = z.infer<typeof scheduleRulesSchema>;
export const scheduleRuleSetSchema = scheduleRulesSchema.safeExtend({
  id: z.union([idSchema, z.string().min(1)]),
  revision: positiveRevisionSchema,
  timezoneDatabaseVersion: z.string().min(1),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type ScheduleRuleSet = z.infer<typeof scheduleRuleSetSchema>;
export const scheduleRuleUpdateInputSchema = scheduleRulesSchema.safeExtend({
  expectedRevision: positiveRevisionSchema.optional()
});
export type ScheduleRuleUpdateInput = z.infer<typeof scheduleRuleUpdateInputSchema>;

export const schedulableShortSchema = z.strictObject({
  shortId: idSchema,
  renderId: idSchema,
  episodeId: idSchema,
  priority: z.number().int(),
  topic: z.string().min(1).optional()
});
export type SchedulableShort = z.infer<typeof schedulableShortSchema>;
export const scheduleDraftInputSchema = z.strictObject({
  shorts: z.array(schedulableShortSchema),
  expectedRulesRevision: positiveRevisionSchema
});
export type ScheduleDraftInput = z.infer<typeof scheduleDraftInputSchema>;
export const scheduleMoveInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  publishAt: utcInstantSchema
});
export type ScheduleMoveInput = z.infer<typeof scheduleMoveInputSchema>;

const youtubeUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || ![
    "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"
  ].includes(url.hostname.toLowerCase())) {
    context.addIssue({
      code: "custom",
      message: "YouTube URL must use HTTPS on youtube.com or youtu.be"
    });
  }
});
export const scheduleMarkPublishedInputSchema = z.strictObject({
  expectedRevision: positiveRevisionSchema,
  youtubeUrl: youtubeUrlSchema.optional()
});
export type ScheduleMarkPublishedInput = z.infer<typeof scheduleMarkPublishedInputSchema>;

export const scheduleDstPolicyId = "shift-forward-gap-earlier-overlap-v1" as const;
export const scheduleDstWarningSchema = z.strictObject({
  kind: z.enum(["nonexistent_local_time", "ambiguous_local_time"]),
  localDate: dateSchema,
  localTime: wallTimeSchema,
  timezone: ianaTimezoneSchema,
  selectedUtcInstant: utcInstantSchema,
  alternativeUtcInstant: utcInstantSchema.optional(),
  adjustmentMinutes: z.number().int().nonnegative()
});
export type ScheduleDstWarning = z.infer<typeof scheduleDstWarningSchema>;

export const scheduleDraftEntrySchema = z.strictObject({
  id: idSchema,
  shortId: idSchema,
  renderId: idSchema,
  episodeId: idSchema,
  publishAt: utcInstantSchema,
  timezone: ianaTimezoneSchema,
  priority: z.number().int(),
  rationale: z.string().min(1)
});
export type ScheduleDraftEntry = z.infer<typeof scheduleDraftEntrySchema>;
export const scheduleDraftResultSchema = z.strictObject({
  entries: z.array(scheduleDraftEntrySchema),
  warnings: z.array(scheduleDstWarningSchema),
  rulesRevision: positiveRevisionSchema,
  dstPolicy: z.literal(scheduleDstPolicyId),
  resolverTimezoneDatabaseVersion: z.string().min(1)
});
export type ScheduleDraftResult = z.infer<typeof scheduleDraftResultSchema>;

export const scheduleEntryStatuses = ["draft", "planned", "published"] as const;
export const scheduleEntryStatusSchema = z.enum(scheduleEntryStatuses);
export const scheduleEntrySchema = z.strictObject({
  id: idSchema,
  shortId: idSchema,
  renderId: idSchema,
  episodeId: idSchema,
  publishAt: utcInstantSchema,
  timezone: ianaTimezoneSchema,
  status: scheduleEntryStatusSchema,
  priority: z.number().int(),
  rationale: z.string().min(1),
  locked: z.boolean(),
  youtubeUrl: z.string().url().nullable(),
  needsRerender: z.boolean(),
  revision: positiveRevisionSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
}).refine((entry) => entry.locked === (entry.status === "published"), {
  path: ["locked"],
  message: "Only published entries may be locked, and published entries must be locked"
}).refine((entry) => entry.status === "published" || entry.youtubeUrl === null, {
  path: ["youtubeUrl"],
  message: "Only published entries may have a YouTube URL"
});
export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

export const jobTypes = [
  "probe", "hash", "analyze", "candidates", "render",
  "watched_folder_scan", "source_reconcile"
] as const;
export const jobTypeSchema = z.enum(jobTypes);
export const jobStates = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const jobStateSchema = z.enum(jobStates);
export const jobSchema = z.strictObject({
  id: idSchema,
  type: jobTypeSchema,
  entityId: idSchema.nullable(),
  provider: z.string().min(1).nullable(),
  state: jobStateSchema,
  progress: z.number().min(0).max(1),
  stage: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  cancelRequested: z.boolean(),
  errorCode: apiErrorCodeSchema.nullable(),
  errorMessage: nullableNonempty,
  payloadReference: z.string().min(1).nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Job = z.infer<typeof jobSchema>;

export const watchedFolderConfigurationResultSchema = z.union([
  watchedFolderSchema,
  jobSchema
]);

export const localTranscriptionStatusSchema = z.strictObject({
  available: z.boolean(),
  models: z.array(z.strictObject({
    modelId: z.string().min(1),
    installed: z.boolean()
  })),
  features: z.array(z.string().min(1))
});

export const renderProbeValidationSchema = z.strictObject({
  valid: z.boolean(),
  errors: z.array(z.string().min(1)),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  videoCodec: z.string().min(1).nullable(),
  audioCodec: z.string().min(1).nullable()
});

export const domainEntityNames = [
  "Episode", "WatchedFolder", "TranscriptRevision", "AnalysisArtifact", "Candidate",
  "ShortProject", "Template", "Asset", "Render", "ScheduleRuleSet", "ScheduleEntry", "Job"
] as const;

export const domainEntitySchemas = {
  Episode: episodeSchema,
  WatchedFolder: watchedFolderSchema,
  TranscriptRevision: transcriptRevisionSchema,
  AnalysisArtifact: analysisArtifactSchema,
  Candidate: candidateSchema,
  ShortProject: shortProjectSchema,
  Template: templateSchema,
  Asset: assetSchema,
  Render: renderSchema,
  ScheduleRuleSet: scheduleRuleSetSchema,
  ScheduleEntry: scheduleEntrySchema,
  Job: jobSchema
} as const;

export const lifecycleInventories = {
  Episode: episodeStatuses,
  Job: jobStates,
  Candidate: candidateReviewStatuses,
  Render: renderStates,
  ScheduleEntry: scheduleEntryStatuses,
  AnalysisArtifact: artifactStates
} as const;

export const EPISODE_STATUSES = episodeStatuses;
export const JOB_STATES = jobStates;
export const CANDIDATE_REVIEW_STATUSES = candidateReviewStatuses;
export const RENDER_STATES = renderStates;
export const SCHEDULE_ENTRY_STATUSES = scheduleEntryStatuses;
export const ARTIFACT_STATES = artifactStates;
