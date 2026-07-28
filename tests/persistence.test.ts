import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/core/database";
import { Repository } from "../src/core/repository";
import { AppError } from "../src/shared/errors";
import { starterTemplates } from "../src/shared/templates";
import { candidate, episode, segments } from "./factories";

const databases: ReturnType<typeof openDatabase>[] = [];
const setup = () => {
  const db = openDatabase(":memory:");
  databases.push(db);
  return new Repository(db);
};
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("complete transactional persistence", () => {
  it("round-trips folders, large transcript revisions, artifacts, and complete assets", () => {
    const repository = setup();
    const now = new Date().toISOString();
    const source = episode();
    repository.insertEpisode(source);

    const folder = {
      id: randomUUID(),
      canonicalPath: "/media/shows",
      enabled: true,
      recursive: true,
      includePatterns: ["*.mp4", "season-*/*.mp4"],
      lastScanStatus: "succeeded" as const,
      lastScannedAt: now,
      lastScanError: null,
      createdAt: now,
      updatedAt: now
    };
    repository.saveWatchedFolder(folder);
    expect(repository.listWatchedFolders()).toEqual([folder]);

    const manySegments = segments(1_001);
    const provenance = {
      provider: "faster-whisper",
      providerClass: "local" as const,
      modelId: "large-v3",
      providerVersion: "1.2.3",
      optionsVersion: "transcript-v1",
      createdAt: now
    };
    const transcript = {
      id: randomUUID(),
      episodeId: source.id,
      revision: 1,
      language: "en",
      segments: manySegments,
      provenance,
      acceptedState: "accepted" as const,
      createdAt: now,
      updatedAt: now
    };
    repository.saveTranscriptRevision(transcript, 0);
    expect(repository.listTranscriptRevisions(source.id)).toEqual([transcript]);
    expect(repository.getTranscript(source.id)).toHaveLength(1_001);

    const analysis = {
      id: randomUUID(),
      entityId: source.id,
      ownerType: "episode" as const,
      kind: "episode_analysis" as const,
      state: "accepted" as const,
      provenance,
      inputHash: "sha256:input",
      rawOutput: { topics: ["one"] },
      acceptedProjection: { topics: ["one"], edited: true },
      createdAt: now
    };
    repository.insertAnalysisArtifact(analysis);
    expect(repository.listAnalysisArtifacts(source.id)).toEqual([analysis]);

    const asset = {
      id: randomUUID(),
      sourcePath: null,
      ownedArtifactPath: `artifacts/episodes/${source.id}/thumbnail.png`,
      kind: "image" as const,
      provenance: "generated locally",
      reusable: false,
      tags: ["thumbnail", "approved"],
      width: 1080,
      height: 1920,
      durationMs: null,
      createdAt: now,
      updatedAt: now
    };
    repository.saveAsset(asset);
    expect(repository.listAssets()).toEqual([asset]);

    const metadata = {
      id: randomUUID(),
      kind: "thumbnail",
      ownerType: "episode",
      ownerId: source.id,
      ownerRevision: 1,
      relativePath: asset.ownedArtifactPath,
      contentHash: "sha256:output",
      byteLength: 42,
      producerVersion: "fixture-v1",
      state: "complete" as const,
      createdAt: now
    };
    repository.saveArtifactRecord(metadata);
    expect(repository.listArtifactRecords(source.id)).toEqual([metadata]);
    expect(() => repository.saveArtifactRecord({
      ...metadata,
      id: randomUUID(),
      relativePath: "/absolute/path"
    })).toThrowError(AppError);
  });

  it("persists candidate provenance and every Short edit field", () => {
    const repository = setup();
    const source = episode();
    repository.insertEpisode(source);
    const generated = candidate(source.id, {
      generationProvenance: {
        artifactId: randomUUID(),
        transcriptRevision: 7,
        generationVersion: "candidates-v4",
        provider: {
          provider: "ollama",
          providerClass: "network",
          modelId: "qwen",
          providerVersion: "0.9",
          optionsVersion: "v4",
          createdAt: new Date().toISOString()
        }
      }
    });
    repository.replaceCandidates(source.id, [generated]);
    expect(repository.getCandidate(generated.id)).toEqual(generated);

    const now = new Date().toISOString();
    const project = {
      id: randomUUID(),
      episodeId: source.id,
      candidateId: generated.id,
      title: "Complete project",
      sourceRanges: [{ startMs: 100, endMs: 20_000 }],
      templateId: starterTemplates[0]!.id,
      templateLineage: {
        templateId: starterTemplates[0]!.id,
        templateVersion: 1,
        parentTemplateId: null
      },
      composition: structuredClone(starterTemplates[0]!.composition),
      captions: {
        enabled: true,
        segments: segments(2),
        style: { fontFamily: "Inter", fontSize: 72, color: "#eee", highlightColor: "#f00" }
      },
      audio: {
        sourceGainDb: -2,
        muted: false,
        fadeInMs: 100,
        fadeOutMs: 200,
        bedAssetId: null,
        bedGainDb: -18,
        normalizeLoudness: true
      },
      copy: {
        cleanedTranscript: "clean",
        rewrite: "rewrite",
        hookVariants: ["hook"],
        titles: ["title"],
        description: "description",
        hashtags: ["one"],
        thumbnailText: "thumbnail"
      },
      copyState: "accepted" as const,
      copySource: "legacy_accepted" as const,
      approved: false,
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    repository.createShort(project);
    expect(repository.getShort(project.id)).toEqual(project);
  });

  it("lists Candidates with the generation rank tie breakers", () => {
    const repository = setup();
    const source = episode();
    repository.insertEpisode(source);
    const lowHook = candidate(source.id, {
      id: randomUUID(),
      startMs: 0,
      endMs: 20_000,
      score: .8,
      scores: {
        hook: .7, coherence: .8, payoff: .8,
        independence: .8, delivery: .8, visualActivity: .5
      }
    });
    const later = candidate(source.id, {
      id: randomUUID(),
      startMs: 40_000,
      endMs: 60_000,
      score: .8,
      scores: {
        hook: .9, coherence: .8, payoff: .8,
        independence: .8, delivery: .8, visualActivity: .5
      }
    });
    const earlier = candidate(source.id, {
      id: randomUUID(),
      startMs: 20_000,
      endMs: 40_000,
      score: .8,
      scores: later.scores
    });
    repository.replaceCandidates(source.id, [lowHook, later, earlier]);
    expect(repository.listCandidates(source.id).map((item) => item.id))
      .toEqual([earlier.id, later.id, lowHook.id]);
  });

  it("uses CAS guards for transcripts, templates, rules, and forbidden states", () => {
    const repository = setup();
    const source = episode({ status: "discovered" });
    repository.insertEpisode(source);
    expect(() => repository.updateEpisodeStatus(source.id, "ready")).toMatchErrorCode("INVALID_STATE");
    expect(repository.updateEpisodeStatus(source.id, "indexing").status).toBe("indexing");

    const now = new Date().toISOString();
    const transcript = {
      id: randomUUID(),
      episodeId: source.id,
      revision: 1,
      language: "en",
      segments: segments(1),
      provenance: {
        provider: "fixture",
        providerClass: "local" as const,
        modelId: "fixture",
        providerVersion: "1",
        optionsVersion: "1",
        createdAt: now
      },
      acceptedState: "accepted" as const,
      createdAt: now,
      updatedAt: now
    };
    repository.saveTranscriptRevision(transcript, 0);
    expect(() => repository.saveTranscriptRevision({
      ...transcript,
      id: randomUUID(),
      revision: 2
    }, 0)).toMatchErrorCode("REVISION_CONFLICT");

    expect(() => repository.updateTemplate(
      starterTemplates[0]!.id,
      1,
      { name: "mutated built-in" }
    )).toMatchErrorCode("INVALID_STATE");
    const clone = repository.createTemplate({
      ...structuredClone(starterTemplates[0]!),
      id: "my-template",
      name: "My template",
      parentTemplateId: starterTemplates[0]!.id,
      builtIn: false,
      createdAt: now,
      updatedAt: now
    });
    expect(repository.updateTemplate(clone.id, 1, { name: "Renamed" })).toMatchObject({
      name: "Renamed",
      revision: 2,
      version: 2
    });
    expect(() => repository.updateTemplate(clone.id, 1, { name: "Stale" }))
      .toMatchErrorCode("REVISION_CONFLICT");

    const rules = {
      id: "default",
      revision: 1,
      startDate: "2026-07-27",
      timezone: "America/New_York",
      allowedWeekdays: [1, 3, 5],
      times: ["09:30", "17:00"],
      maxPerDay: 2,
      blackoutDates: ["2026-12-25"],
      minimumSameEpisodeSpacingHours: 48,
      createdAt: now,
      updatedAt: now
    };
    repository.createScheduleRuleSet(rules);
    expect(repository.updateScheduleRuleSet("default", 1, { maxPerDay: 3 }))
      .toMatchObject({ revision: 2, maxPerDay: 3 });
    expect(() => repository.updateScheduleRuleSet("default", 1, { maxPerDay: 4 }))
      .toMatchErrorCode("REVISION_CONFLICT");
  });

  it("rolls multi-row replacements back on failure", () => {
    const repository = setup();
    const source = episode();
    repository.insertEpisode(source);
    const original = candidate(source.id, { reviewStatus: "pending" });
    repository.replaceCandidates(source.id, [original]);
    const duplicate = candidate(source.id);
    expect(() => repository.replaceCandidates(source.id, [duplicate, duplicate])).toThrow();
    expect(repository.listCandidates(source.id)).toEqual([original]);
  });

  it("stores only scoped, revocable cloud authorization metadata", () => {
    const repository = setup();
    const grant = {
      id: randomUUID(),
      scopeType: "project" as const,
      scopeId: randomUUID(),
      provider: "openai",
      operationClasses: ["transcription", "analysis"],
      credentialHandle: "keychain:fixture",
      grantedAt: new Date().toISOString(),
      revokedAt: null
    };
    repository.grantCloudAuthorization(grant);
    expect(repository.listCloudAuthorizations(grant.scopeId)).toEqual([grant]);
    expect(repository.hasCloudAuthorization(
      "project", grant.scopeId, "openai", "analysis"
    )).toBe(true);
    expect(repository.hasCloudAuthorization(
      "project", grant.scopeId, "openai", "render"
    )).toBe(false);
    repository.revokeCloudAuthorization(grant.id);
    expect(repository.hasCloudAuthorization(
      "project", grant.scopeId, "openai", "analysis"
    )).toBe(false);
  });
});

declare module "vitest" {
  interface Assertion<T = any> {
    toMatchErrorCode(code: string): T;
  }
}

expect.extend({
  toMatchErrorCode(received: () => unknown, expected: string) {
    try {
      received();
      return { pass: false, message: () => `Expected ${expected}, but no error was thrown` };
    } catch (error) {
      const actual = error instanceof AppError ? error.code : undefined;
      return {
        pass: actual === expected,
        message: () => `Expected ${expected}, received ${String(actual)}`
      };
    }
  }
});
