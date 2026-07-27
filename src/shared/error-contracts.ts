import { z } from "zod";

export const apiErrorCodes = [
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "REVISION_CONFLICT",
  "SOURCE_MISSING",
  "SOURCE_IDENTITY_MISMATCH",
  "DEPENDENCY_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_OUTPUT_INVALID",
  "CLOUD_NOT_AUTHORIZED",
  "CLOUD_CONFIRMATION_REQUIRED",
  "INVALID_STATE",
  "SCHEDULE_COLLISION",
  "JOB_CANCELLED",
  "ARTIFACT_CORRUPT",
  "INTERNAL_ERROR"
] as const;

export const apiErrorCodeSchema = z.enum(apiErrorCodes);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export const API_ERROR_CODES = apiErrorCodes;

export interface ErrorDefinition {
  status: number;
  retryable: boolean;
}

export const errorRegistry = {
  NOT_FOUND: { status: 404, retryable: false },
  VALIDATION_ERROR: { status: 422, retryable: false },
  REVISION_CONFLICT: { status: 409, retryable: false },
  SOURCE_MISSING: { status: 409, retryable: false },
  SOURCE_IDENTITY_MISMATCH: { status: 409, retryable: false },
  DEPENDENCY_UNAVAILABLE: { status: 503, retryable: true },
  PROVIDER_UNAVAILABLE: { status: 503, retryable: true },
  PROVIDER_OUTPUT_INVALID: { status: 422, retryable: false },
  CLOUD_NOT_AUTHORIZED: { status: 403, retryable: false },
  CLOUD_CONFIRMATION_REQUIRED: { status: 409, retryable: false },
  INVALID_STATE: { status: 409, retryable: false },
  SCHEDULE_COLLISION: { status: 409, retryable: false },
  JOB_CANCELLED: { status: 409, retryable: false },
  ARTIFACT_CORRUPT: { status: 422, retryable: false },
  INTERNAL_ERROR: { status: 500, retryable: false }
} as const satisfies Record<ApiErrorCode, ErrorDefinition>;
export const ERROR_REGISTRY = errorRegistry;

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  details: z.json().nullable(),
  retryable: z.boolean()
});
export const apiErrorEnvelopeSchema = z.strictObject({
  apiVersion: z.literal("v1"),
  error: apiErrorSchema
});
export const errorBodySchema = apiErrorSchema;
export const errorEnvelopeSchema = apiErrorEnvelopeSchema;

export type ApiErrorShape = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export const revisionConflictDetailsSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  actualRevision: z.number().int().positive()
});
