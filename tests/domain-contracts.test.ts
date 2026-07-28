import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { starterTemplates } from "../src/shared/templates";
import {
  analysisArtifactSchema,
  assetSchema,
  candidateGenerationDiagnosticSchema,
  candidateGenerationInputSchema,
  candidateGenerationResultSchema,
  candidateSchema,
  compositionSchema,
  domainEntitySchemas,
  domainEntityNames,
  episodeSchema,
  jobSchema,
  normalizedRectangleSchema,
  providerProvenanceSchema,
  renderSchema,
  scheduleEntrySchema,
  scheduleRuleSetSchema,
  shortProjectSchema,
  sourceRangesSchema,
  templateSchema,
  timedSegmentsSchema,
  transcriptRevisionSchema,
  utcInstantSchema,
  watchedFolderSchema
} from "../src/shared/domain";

const id = () => randomUUID();
const now = "2026-07-27T16:00:00.000Z";
const provenance = {
  provider: "faster-whisper",
  providerClass: "local" as const,
  modelId: "small.en",
  providerVersion: "1",
  optionsVersion: "v1",
  createdAt: now
};
const segment = {
  id: id(),
  startMs: 0,
  endMs: 2_000,
  text: "A timed sentence.",
  words: [
    { text: "A", startMs: 0, endMs: 500 },
    { text: "sentence", startMs: 500, endMs: 2_000 }
  ],
  speaker: null,
  confidence: .9
};
const composition = {
  width: 1080 as const,
  height: 1920 as const,
  background: "#000",
  safeArea: { top: 10, right: 10, bottom: 10, left: 10 },
  layers: [{
    id: "video",
    type: "video" as const,
    source: "episode" as const,
    region: { x: 0, y: 0, width: 1, height: 1 },
    fit: "fill" as const,
    cropTrack: []
  }]
};

describe("SPEC 5.1 entity contracts", () => {
  const episodeId = id();
  const candidateId = id();
  const shortId = id();
  const renderId = id();

  const fixtures = [
    ["Episode", episodeSchema, {
      id: episodeId, sourcePath: "/media/a.mp4", canonicalPath: "/media/a.mp4",
      fingerprint: "quick:1", contentHash: null, fileSize: 1, modifiedAtMs: 1,
      durationMs: 120_000, width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac",
      status: "ready", missing: false, relinkRestoreStatus: null,
      candidateCount: 0, renderedShortCount: 0, scheduledCount: 0,
      createdAt: now, updatedAt: now
    }],
    ["WatchedFolder", watchedFolderSchema, {
      id: id(), canonicalPath: "/media", enabled: true, recursive: true, includePatterns: ["*.mp4"],
      lastScanStatus: "succeeded", lastScannedAt: now, lastScanError: null, createdAt: now, updatedAt: now
    }],
    ["TranscriptRevision", transcriptRevisionSchema, {
      id: id(), episodeId, revision: 1, language: "en", segments: [segment],
      provenance, acceptedState: "accepted", createdAt: now, updatedAt: now
    }],
    ["AnalysisArtifact", analysisArtifactSchema, {
      id: id(), entityId: episodeId, ownerType: "episode", kind: "episode_analysis",
      state: "accepted", provenance, inputHash: "sha256:abc",
      rawOutput: { topics: ["contracts"] }, acceptedProjection: { topics: ["contracts"] }, createdAt: now
    }],
    ["Candidate", candidateSchema, {
      id: candidateId, episodeId, startMs: 0, endMs: 30_000,
      sourceRange: { startMs: 0, endMs: 30_000 },
      transcript: "Complete thought.", topic: "Contracts", hook: "Why contracts matter",
      reason: "Self-contained", score: .8,
      scores: { hook: .8, coherence: .8, payoff: .8, independence: .8, delivery: .8, visualActivity: .8 },
      duplicateGroup: null, reviewStatus: "approved",
      generationProvenance: { artifactId: null, transcriptRevision: 1, generationVersion: "v1", provider: provenance },
      generationRunId: null, revision: 1, state: "active", createdAt: now, updatedAt: now
    }],
    ["ShortProject", shortProjectSchema, {
      id: shortId, episodeId, candidateId, title: "Contracts",
      sourceRanges: [{ startMs: 0, endMs: 30_000 }], templateId: "speaker-v1",
      templateLineage: { templateId: "speaker-v1", templateVersion: 1, parentTemplateId: null },
      composition,
      captions: {
        enabled: true, segments: [segment],
        style: { fontFamily: "Arial", fontSize: 60, color: "#fff", highlightColor: "#ff0" }
      },
      audio: {
        sourceGainDb: 0, muted: false, fadeInMs: 50, fadeOutMs: 50,
        bedAssetId: null, bedGainDb: null, normalizeLoudness: false
      },
      copy: {
        cleanedTranscript: "Complete thought.", rewrite: "", hookVariants: ["Hook"],
        titles: ["Title"], description: "", hashtags: [], thumbnailText: "Contracts"
      },
      copyState: "accepted", copySource: "candidate_accepted",
      approved: true, revision: 1, createdAt: now, updatedAt: now
    }],
    ["Template", templateSchema, {
      id: "speaker-v1", name: "Speaker", description: "Full screen", version: 1, revision: 1,
      parentTemplateId: null, builtIn: true, composition, createdAt: now, updatedAt: now
    }],
    ["Asset", assetSchema, {
      id: id(), sourcePath: "/media/logo.png", ownedArtifactPath: null, kind: "logo",
      provenance: "Owned by publisher", reusable: true, tags: ["brand"],
      width: 100, height: 100, durationMs: null, createdAt: now, updatedAt: now
    }],
    ["Render", renderSchema, {
      id: renderId, shortId, projectRevision: 1,
      encoder: { ffmpegVersion: "7.0", videoCodec: "h264", audioCodec: "aac", settings: { crf: 18 } },
      outputPath: "/output/a.mp4",
      validation: {
        valid: true, findings: [], width: 1080, height: 1920, durationMs: 30_000,
        videoCodec: "h264", audioCodec: "aac", validatedAt: now
      },
      state: "succeeded", error: null, contentHash: "abc", decisionHash: "def",
      createdAt: now, updatedAt: now
    }],
    ["ScheduleRuleSet", scheduleRuleSetSchema, {
      id: id(), revision: 1, startDate: "2026-07-27", timezone: "America/New_York",
      allowedWeekdays: [1, 3, 5], times: ["09:30", "17:00"], maxPerDay: 2,
      blackoutDates: ["2026-08-01"], minimumSameEpisodeSpacingHours: 48,
      createdAt: now, updatedAt: now
    }],
    ["ScheduleEntry", scheduleEntrySchema, {
      id: id(), shortId, renderId, episodeId, publishAt: now, timezone: "America/New_York",
      status: "published", priority: 10, rationale: "First legal slot", locked: true,
      youtubeUrl: "https://youtu.be/example", needsRerender: false, revision: 1,
      createdAt: now, updatedAt: now
    }],
    ["Job", jobSchema, {
      id: id(), type: "render", entityId: shortId, provider: "local", state: "running",
      progress: .5, stage: "encoding", attempts: 1, cancelRequested: false,
      errorCode: null, errorMessage: null, payloadReference: "inline:v1",
      createdAt: now, updatedAt: now
    }]
  ] as const;

  it("exports and parses every required entity", () => {
    expect(domainEntityNames).toEqual(fixtures.map(([name]) => name));
    expect(Object.keys(domainEntitySchemas)).toEqual([...domainEntityNames]);
    for (const [, schema, fixture] of fixtures) expect(schema.safeParse(fixture).success).toBe(true);
  });

  it("rejects unknown fields in entity records", () => {
    const fixture = fixtures[0][2];
    expect(episodeSchema.safeParse({ ...fixture, credential: "secret" }).success).toBe(false);
  });

  it("keeps shipped templates on the canonical contract", () => {
    starterTemplates.forEach((template) => expect(templateSchema.safeParse(template).success).toBe(true));
  });

  it("represents local, private-network, and cloud provider provenance", () => {
    for (const providerClass of ["local", "network", "cloud"] as const) {
      expect(providerProvenanceSchema.safeParse({ ...provenance, providerClass }).success).toBe(true);
    }
  });
});

describe("Candidate generation contracts", () => {
  it("defaults to heuristic mode and requires an artifact in analysis mode", () => {
    const episodeId = id();
    expect(candidateGenerationInputSchema.safeParse({ episodeId }).success).toBe(false);
    expect(candidateGenerationInputSchema.parse({
      episodeId,
      strategy: "replace_pending"
    })).toEqual({
      episodeId,
      count: 8,
      mode: "heuristic",
      strategy: "replace_pending"
    });
    expect(candidateGenerationInputSchema.safeParse({
      episodeId,
      strategy: "replace_pending",
      mode: "analysis"
    }).success).toBe(false);
    expect(candidateGenerationInputSchema.parse({
      episodeId,
      strategy: "append_pending",
      mode: "analysis",
      analysisArtifactId: id()
    })).toMatchObject({ count: 8, mode: "analysis" });
  });

  it("discriminates sufficient and insufficient diagnostics", () => {
    expect(candidateGenerationDiagnosticSchema.safeParse({
      sufficient: false,
      code: "INSUFFICIENT_MATERIAL",
      minimumCandidateCount: 5,
      requestedCount: 8,
      generatedCount: 2,
      eligibleWindowCount: 3,
      rejectionCounts: {
        duration: 4, quality: 1, overlap: 0, semanticDuplication: 0
      }
    }).success).toBe(true);
    expect(candidateGenerationResultSchema.safeParse({
      candidates: [],
      diagnostic: { sufficient: true, requestedCount: 8, generatedCount: 0 }
    }).success).toBe(false);
  });
});

describe("reusable state validators", () => {
  it("rejects invalid IDs, non-Z instants, invalid zones, and zero revisions", () => {
    expect(episodeSchema.safeParse({ id: "not-an-id" }).success).toBe(false);
    expect(utcInstantSchema.safeParse("2026-07-27T12:00:00-04:00").success).toBe(false);
    expect(scheduleRuleSetSchema.safeParse({
      id: id(), revision: 0, startDate: "2026-01-01", timezone: "Mars/Olympus",
      allowedWeekdays: [1], times: ["24:00"], maxPerDay: 1, blackoutDates: [],
      minimumSameEpisodeSpacingHours: 0, createdAt: now, updatedAt: now
    }).success).toBe(false);
  });

  it("rejects reversed or overlapping source ranges", () => {
    expect(sourceRangesSchema.safeParse([{ startMs: 10, endMs: 5 }]).success).toBe(false);
    expect(sourceRangesSchema.safeParse([
      { startMs: 0, endMs: 100 },
      { startMs: 99, endMs: 200 }
    ]).success).toBe(false);
  });

  it("rejects overlapping segments and invalid word timing", () => {
    expect(timedSegmentsSchema.safeParse([
      segment,
      { ...segment, id: id(), startMs: 1_900, endMs: 3_000, words: [] }
    ]).success).toBe(false);
    expect(timedSegmentsSchema.safeParse([{
      ...segment,
      words: [{ text: "outside", startMs: 1_900, endMs: 2_100 }]
    }]).success).toBe(false);
  });

  it("rejects rectangles that cross normalized bounds", () => {
    expect(normalizedRectangleSchema.safeParse({ x: .8, y: 0, width: .3, height: 1 }).success).toBe(false);
    expect(compositionSchema.safeParse({
      ...composition,
      layers: [{ ...composition.layers[0], region: { x: 0, y: .7, width: 1, height: .5 } }]
    }).success).toBe(false);
  });
});
