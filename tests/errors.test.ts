import { z } from "zod";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import type { CoreService } from "../src/core/service";
import {
  apiErrorCodes,
  apiErrorEnvelopeSchema,
  errorRegistry,
  revisionConflictDetailsSchema
} from "../src/shared/domain";
import { AppError, errorEnvelope, normalizeError } from "../src/shared/errors";

describe("v1 error registry and normalization", () => {
  it("covers all 15 codes with registered defaults", () => {
    expect(apiErrorCodes).toHaveLength(15);
    expect(Object.keys(errorRegistry)).toEqual([...apiErrorCodes]);
    expect(errorRegistry.NOT_FOUND).toEqual({ status: 404, retryable: false });
    expect(errorRegistry.DEPENDENCY_UNAVAILABLE).toEqual({ status: 503, retryable: true });
    expect(errorRegistry.PROVIDER_UNAVAILABLE).toEqual({ status: 503, retryable: true });
  });

  it("derives defaults while retaining compatible explicit status and details", () => {
    const defaulted = new AppError("INVALID_STATE", "No");
    expect(defaulted).toMatchObject({ status: 409, retryable: false });
    const details = { expectedRevision: 2, actualRevision: 3 };
    const compatible = new AppError("REVISION_CONFLICT", "Stale", 418, details);
    expect(compatible).toMatchObject({ status: 418, retryable: false, details });
    expect(revisionConflictDetailsSchema.parse(details)).toEqual(details);
  });

  it("emits strict v1 envelopes and maps Zod failures", () => {
    const failure = z.string().uuid().safeParse("bad");
    if (failure.success) throw new Error("Expected fixture to fail");
    const envelope = errorEnvelope(failure.error);
    expect(envelope.error).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
    expect(apiErrorEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("preserves known application errors", () => {
    const original = new AppError("SOURCE_MISSING", "Reconnect source", undefined, { episodeId: "safe-id" });
    expect(normalizeError(original)).toBe(original);
    expect(errorEnvelope(original).error.details).toEqual({ episodeId: "safe-id" });
  });

  it("fully redacts unknown exception messages, stacks, paths, credentials, and payloads", () => {
    const secret = "sk-sensitive-token";
    const unknown = new Error(`Failed /Users/person/private.mov with ${secret}`);
    unknown.stack = `STACK ${secret} transcript payload`;
    const serialized = JSON.stringify(errorEnvelope(unknown));
    expect(serialized).toContain("INTERNAL_ERROR");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("transcript");
    expect(errorEnvelope(unknown).error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Unexpected internal error",
      details: null,
      retryable: false
    });
  });

  it("uses the registered v1 envelope in HTTP middleware", async () => {
    const app = createApi({} as CoreService);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/v1/library/episodes/not-a-uuid`);
      expect(response.status).toBe(422);
      expect(apiErrorEnvelopeSchema.parse(await response.json())).toMatchObject({
        apiVersion: "v1",
        error: { code: "VALIDATION_ERROR", retryable: false }
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
