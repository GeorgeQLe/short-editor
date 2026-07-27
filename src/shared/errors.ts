import { z } from "zod";
import {
  type ApiErrorCode,
  type ApiErrorEnvelope,
  errorRegistry
} from "./error-contracts.js";

export class AppError extends Error {
  public readonly status: number;
  public readonly details?: unknown;
  public readonly retryable: boolean;

  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    status?: number,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.status = status ?? errorRegistry[code].status;
    this.details = details;
    this.retryable = errorRegistry[code].retryable;
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return new AppError("VALIDATION_ERROR", "Invalid request", undefined, error.issues);
  }
  return new AppError("INTERNAL_ERROR", "Unexpected internal error");
}

export function errorEnvelope(error: unknown): ApiErrorEnvelope {
  const normalized = normalizeError(error);
  const details = z.json().safeParse(normalized.details);
  return {
    apiVersion: "v1",
    error: {
      code: normalized.code,
      message: normalized.message,
      details: details.success ? details.data : null,
      retryable: normalized.retryable
    }
  };
}
