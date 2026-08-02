import { describe, expect, it } from "vitest";
import {
  authenticatedContextSchema,
  completeUploadInputSchema,
  createUploadInputSchema,
  jobEnvelopeSchema,
  saasErrorCodes
} from "../../packages/saas-contracts/src/index.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ORG_ID = "00000000-0000-4000-8000-000000000002";
const PROJECT_ID = "00000000-0000-4000-8000-000000000003";

describe("SaaS contracts", () => {
  it("requires a verified tenant and role context", () => {
    expect(authenticatedContextSchema.parse({
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "editor",
      sessionId: "sess_1"
    })).toMatchObject({ organizationId: ORG_ID, role: "editor" });
    expect(() => authenticatedContextSchema.parse({
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "admin",
      sessionId: "sess_1"
    })).toThrow();
  });

  it("supports 20 GB uploads and rejects invalid checksums", () => {
    expect(createUploadInputSchema.parse({
      projectId: PROJECT_ID,
      displayName: "episode.mp4",
      expectedBytes: 20 * 1024 ** 3,
      checksumSha256: "a".repeat(64)
    }).expectedBytes).toBe(20 * 1024 ** 3);
    expect(() => createUploadInputSchema.parse({
      projectId: PROJECT_ID,
      displayName: "episode.mp4",
      expectedBytes: 1,
      checksumSha256: "not-a-checksum"
    })).toThrow();
  });

  it("versions and scopes every worker job", () => {
    expect(jobEnvelopeSchema.parse({
      schemaVersion: 1,
      jobId: USER_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      kind: "ingest",
      inputHash: "b".repeat(64),
      payload: { uploadId: USER_ID },
      requestedAt: "2026-08-01T12:00:00.000Z"
    })).toMatchObject({ schemaVersion: 1, organizationId: ORG_ID });
  });

  it("rejects duplicate multipart completion metadata", () => {
    const part = {
      partNumber: 1,
      etag: "etag",
      checksumSha256: `${"A".repeat(43)}=`
    };
    expect(() => completeUploadInputSchema.parse({ parts: [part, part] })).toThrow();
  });

  it("defines all commercial beta error codes", () => {
    expect(saasErrorCodes).toContain("AUTHENTICATION_REQUIRED");
    expect(saasErrorCodes).toContain("FORBIDDEN_ROLE");
    expect(saasErrorCodes).toContain("SUBSCRIPTION_INACTIVE");
    expect(saasErrorCodes).toContain("SEAT_LIMIT");
    expect(saasErrorCodes).toContain("PROCESSING_MINUTE_LIMIT");
    expect(saasErrorCodes).toContain("STORAGE_LIMIT");
    expect(saasErrorCodes).toContain("UPLOAD_EXPIRED");
    expect(saasErrorCodes).toContain("OBJECT_UNAVAILABLE");
    expect(saasErrorCodes).toContain("REVISION_CONFLICT");
  });
});
