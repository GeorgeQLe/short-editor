import type { SaasErrorCode } from "@siftcut/saas-contracts";
import { ZodError } from "zod";
import { RepositoryError } from "@siftcut/infrastructure";

const statusByCode: Record<SaasErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN_ROLE: 403,
  SUBSCRIPTION_INACTIVE: 403,
  SEAT_LIMIT: 409,
  PROCESSING_MINUTE_LIMIT: 409,
  STORAGE_LIMIT: 409,
  UPLOAD_EXPIRED: 410,
  OBJECT_UNAVAILABLE: 404,
  REVISION_CONFLICT: 409,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  INTERNAL_ERROR: 500
};

export class SaasError extends Error {
  readonly status: number;
  constructor(
    readonly code: SaasErrorCode,
    message: string,
    readonly details: unknown = null,
    readonly retryable = false
  ) {
    super(message);
    this.name = "SaasError";
    this.status = statusByCode[code];
  }
}

export function normalizeError(error: unknown): SaasError {
  if (error instanceof SaasError) return error;
  if (error instanceof RepositoryError) {
    if (error.code === "NOT_FOUND") return new SaasError("NOT_FOUND", error.message);
    if (error.code === "REVISION_CONFLICT") {
      return new SaasError("REVISION_CONFLICT", error.message, error.details);
    }
    return new SaasError("VALIDATION_ERROR", error.message, error.details);
  }
  if (error instanceof ZodError) {
    return new SaasError("VALIDATION_ERROR", "Invalid request", error.issues);
  }
  if (error && typeof error === "object" && "status" in error && error.status === 413) {
    return new SaasError("VALIDATION_ERROR", "Request body is too large");
  }
  return new SaasError("INTERNAL_ERROR", "Unexpected internal error");
}
