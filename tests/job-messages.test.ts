import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  jobMessageTypes,
  jobPayloadSchema,
  jobResultSchema
} from "../src/shared/domain";

const id = () => randomUUID();
const now = "2026-07-27T16:00:00.000Z";

describe("versioned job messages", () => {
  it("accepts exactly one credential-free payload for every job kind", () => {
    const episodeId = id();
    const payloads = [
      { apiVersion: "v1", type: "probe", episodeId },
      { apiVersion: "v1", type: "hash", episodeId },
      { apiVersion: "v1", type: "analyze", episodeId, provider: "local", transcriptRevision: 1 },
      { apiVersion: "v1", type: "candidates", episodeId, transcriptRevision: 1, count: 8 },
      { apiVersion: "v1", type: "render", shortId: id(), projectRevision: 1 }
    ];
    expect(payloads.map((payload) => payload.type)).toEqual(jobMessageTypes);
    payloads.forEach((payload) => expect(jobPayloadSchema.safeParse(payload).success).toBe(true));
    expect(jobPayloadSchema.safeParse({ ...payloads[2], apiKey: "secret" }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ apiVersion: "v1", type: "future", arbitrary: {} }).success).toBe(false);
  });

  it("accepts exactly one result for every job kind", () => {
    const episodeId = id();
    const validation = {
      valid: true, findings: [], width: 1080, height: 1920, durationMs: 1_000,
      videoCodec: "h264", audioCodec: "aac", validatedAt: now
    };
    const score = { hook: 1, coherence: 1, payoff: 1, independence: 1, delivery: 1, visualActivity: 1 };
    const results = [
      {
        apiVersion: "v1", type: "probe", episodeId,
        probe: { durationMs: 1_000, width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac" }
      },
      { apiVersion: "v1", type: "hash", episodeId, algorithm: "sha256", contentHash: "a".repeat(64) },
      {
        apiVersion: "v1", type: "analyze", episodeId, transcriptRevisionId: id(), artifactIds: [id()],
        provenance: {
          provider: "local", providerClass: "local", modelId: "m", providerVersion: "1",
          optionsVersion: "v1", createdAt: now
        }
      },
      { apiVersion: "v1", type: "candidates", episodeId, candidateIds: [id()], scores: [score], diagnostic: null },
      {
        apiVersion: "v1", type: "render", shortId: id(), projectRevision: 1,
        renderId: id(), validation
      }
    ];
    expect(results.map((result) => result.type)).toEqual(jobMessageTypes);
    results.forEach((result) => expect(jobResultSchema.safeParse(result).success).toBe(true));
  });
});
