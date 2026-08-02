import { z } from "zod";

export const idSchema = z.string().uuid();
export const utcInstantSchema = z.string().datetime({ offset: true });
export const roleSchema = z.enum(["owner", "editor", "viewer"]);
export type OrganizationRole = z.infer<typeof roleSchema>;

export const saasErrorCodes = [
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN_ROLE",
  "SUBSCRIPTION_INACTIVE",
  "SEAT_LIMIT",
  "PROCESSING_MINUTE_LIMIT",
  "STORAGE_LIMIT",
  "UPLOAD_EXPIRED",
  "OBJECT_UNAVAILABLE",
  "REVISION_CONFLICT",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR"
] as const;
export const saasErrorCodeSchema = z.enum(saasErrorCodes);
export type SaasErrorCode = z.infer<typeof saasErrorCodeSchema>;

export const errorEnvelopeSchema = z.strictObject({
  apiVersion: z.literal("v1"),
  error: z.strictObject({
    code: saasErrorCodeSchema,
    message: z.string().min(1),
    details: z.json().nullable(),
    retryable: z.boolean()
  })
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const authenticatedContextSchema = z.strictObject({
  userId: idSchema,
  organizationId: idSchema,
  role: roleSchema,
  sessionId: z.string().min(1),
  authenticatedAt: utcInstantSchema.optional()
});
export type AuthenticatedContext = z.infer<typeof authenticatedContextSchema>;

export const organizationSchema = z.strictObject({
  id: idSchema,
  clerkOrganizationId: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(["trialing", "active", "read_only", "deleting"]),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Organization = z.infer<typeof organizationSchema>;

export const membershipSchema = z.strictObject({
  organizationId: idSchema,
  userId: idSchema,
  role: roleSchema,
  state: z.enum(["active", "revoked"]),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Membership = z.infer<typeof membershipSchema>;

export const projectKindSchema = z.enum(["episode_to_shorts", "screenletter_recording"]);
export type ProjectKind = z.infer<typeof projectKindSchema>;
export const projectOriginSchema = z.enum(["siftcut_web", "screenletter_ios"]);
export type ProjectOrigin = z.infer<typeof projectOriginSchema>;

export const projectSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(160),
  kind: projectKindSchema,
  origin: projectOriginSchema,
  revision: z.number().int().positive(),
  state: z.enum(["active", "deleting"]),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  kind: projectKindSchema.optional().default("episode_to_shorts"),
  origin: projectOriginSchema.optional().default("siftcut_web")
});
export const updateProjectInputSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(160)
});
export const deleteProjectInputSchema = z.strictObject({
  expectedRevision: z.number().int().positive()
});

export const subscriptionSchema = z.strictObject({
  organizationId: idSchema,
  state: z.enum(["trialing", "active", "past_due", "canceled", "read_only"]),
  paidThrough: utcInstantSchema.nullable(),
  trialEndsAt: utcInstantSchema.nullable(),
  stripeCustomerId: z.string().min(1).nullable(),
  stripeSubscriptionId: z.string().min(1).nullable()
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const entitlementSchema = z.strictObject({
  memberLimit: z.number().int().positive(),
  sourceMinuteLimit: z.number().int().positive(),
  storageByteLimit: z.number().int().positive(),
  canCreateWork: z.boolean()
});
export type Entitlement = z.infer<typeof entitlementSchema>;

export const usageSchema = z.strictObject({
  periodStartsAt: utcInstantSchema,
  periodEndsAt: utcInstantSchema,
  sourceMinutesUsed: z.number().nonnegative(),
  sourceMinutesReserved: z.number().nonnegative(),
  storageBytesUsed: z.number().int().nonnegative(),
  storageBytesReserved: z.number().int().nonnegative()
});
export type Usage = z.infer<typeof usageSchema>;

export const uploadSessionSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  displayName: z.string().min(1),
  expectedBytes: z.number().int().positive().max(5 * 1024 ** 4),
  partSizeBytes: z.number().int().min(5 * 1024 ** 2),
  state: z.enum(["open", "completing", "complete", "aborted", "expired"]),
  expiresAt: utcInstantSchema,
  createdAt: utcInstantSchema
});
export type UploadSession = z.infer<typeof uploadSessionSchema>;

export const createUploadInputSchema = z.strictObject({
  projectId: idSchema,
  displayName: z.string().trim().min(1).max(512),
  expectedBytes: z.number().int().positive().max(5 * 1024 ** 4),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/)
});
export const uploadPartsInputSchema = z.strictObject({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100)
    .refine((items) => new Set(items).size === items.length, "Part numbers must be unique")
});
export const completeUploadInputSchema = z.strictObject({
  parts: z.array(z.strictObject({
    partNumber: z.number().int().min(1).max(10_000),
    etag: z.string().min(1),
    checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  })).min(1).refine(
    (parts) => new Set(parts.map((part) => part.partNumber)).size === parts.length,
    "Completed part numbers must be unique"
  )
});

export const assetSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  displayName: z.string().min(1),
  kind: z.enum(["source", "proxy", "waveform", "thumbnail", "audio", "render"]),
  byteLength: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
  durationMs: z.number().int().positive().nullable(),
  state: z.enum(["processing", "complete", "unavailable"]),
  createdAt: utcInstantSchema
});
export type Asset = z.infer<typeof assetSchema>;

export const screenletterRecordingModeSchema = z.enum(["screen_microphone", "camera"]);
export type ScreenletterRecordingMode = z.infer<typeof screenletterRecordingModeSchema>;
export const screenletterRecordingStateSchema = z.enum([
  "created",
  "recording",
  "awaiting_upload",
  "uploading",
  "processing",
  "ready",
  "failed",
  "deleted"
]);
export type ScreenletterRecordingState = z.infer<typeof screenletterRecordingStateSchema>;

export const screenletterRecordingSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  ownerId: idSchema,
  name: z.string().trim().min(1).max(160),
  mode: screenletterRecordingModeSchema,
  state: screenletterRecordingStateSchema,
  sourceAssetId: idSchema.nullable(),
  proxyAssetId: idSchema.nullable(),
  publishedAssetId: idSchema.nullable(),
  shareToken: idSchema,
  shareRevision: z.number().int().positive(),
  failureCode: z.string().min(1).nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
  deletedAt: utcInstantSchema.nullable()
});
export type ScreenletterRecording = z.infer<typeof screenletterRecordingSchema>;

export const createScreenletterRecordingInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  mode: screenletterRecordingModeSchema
});
export const publishScreenletterRecordingInputSchema = z.strictObject({
  renderAssetId: idSchema,
  expectedRevision: z.number().int().positive()
});
export const rollbackScreenletterRecordingInputSchema = z.strictObject({
  expectedRevision: z.number().int().positive()
});
export const startScreenletterEditInputSchema = z.strictObject({
  transcribe: z.boolean().optional().default(true)
});
export const screenletterEditLaunchSchema = z.strictObject({
  recordingId: idSchema,
  projectId: idSchema,
  sourceAssetId: idSchema,
  candidateId: z.null(),
  transcribe: z.boolean(),
  maximumDurationMs: z.literal(180_000),
  editorUrl: z.string().url()
});
export type ScreenletterEditLaunch = z.infer<typeof screenletterEditLaunchSchema>;

export const publicScreenletterShareSchema = z.strictObject({
  name: z.string().min(1),
  mode: screenletterRecordingModeSchema,
  shareRevision: z.number().int().positive(),
  previewUrl: z.string().url(),
  previewExpiresAt: utcInstantSchema,
  createdAt: utcInstantSchema
});
export type PublicScreenletterShare = z.infer<typeof publicScreenletterShareSchema>;

export const reportScreenletterAbuseInputSchema = z.strictObject({
  category: z.enum(["spam", "harassment", "copyright", "sexual_content", "violence", "other"]),
  details: z.string().trim().max(2_000).optional()
});

export const mediaAccessSchema = z.strictObject({
  assetId: idSchema,
  purpose: z.enum(["preview", "download"]),
  url: z.string().url(),
  expiresAt: utcInstantSchema
});

export const jobKinds = ["ingest", "transcribe", "analyze", "render", "delete"] as const;
export const jobKindSchema = z.enum(jobKinds);
export const jobEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: idSchema,
  organizationId: idSchema,
  projectId: idSchema,
  kind: jobKindSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.record(z.string(), z.json()),
  requestedAt: utcInstantSchema
});
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

export const durableEventSchema = z.strictObject({
  id: z.number().int().positive(),
  type: z.string().min(1),
  organizationId: idSchema,
  projectId: idSchema.nullable(),
  data: z.record(z.string(), z.json()),
  createdAt: utcInstantSchema
});
export type DurableEvent = z.infer<typeof durableEventSchema>;
