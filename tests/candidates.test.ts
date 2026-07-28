import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_GENERATION_VERSION,
  compareCandidates,
  generateCandidates
} from "../src/core/candidates";
import type { TranscriptSegment } from "../src/shared/domain";
import { segments } from "./factories";

const deterministic = (value: ReturnType<typeof generateCandidates>) =>
  value.candidates.map(({ id: _id, createdAt: _createdAt, ...candidate }) => candidate);

function timedSegments(durations: number[], texts?: string[]): TranscriptSegment[] {
  let cursor = 0;
  return durations.map((duration, index) => {
    const startMs = cursor;
    cursor += duration;
    return {
      id: randomUUID(),
      startMs,
      endMs: cursor,
      text: texts?.[index] ?? `Here is why topic${index} matters, and the result is a complete lesson.`,
      words: [],
      speaker: null,
      confidence: .95
    };
  });
}

describe("candidate generation", () => {
  it("is repeatable, ranked, bounded, aligned, distinct, and revision-bound", () => {
    const transcript = segments(80);
    const context = {
      episodeId: randomUUID(),
      transcriptRevision: 7,
      segments: transcript,
      count: 8,
      mode: "heuristic" as const
    };
    const first = generateCandidates(context);
    const second = generateCandidates(context);

    expect(first.diagnostic).toEqual({ sufficient: true, requestedCount: 8, generatedCount: 8 });
    expect(deterministic(first)).toEqual(deterministic(second));
    expect(first.candidates).toEqual([...first.candidates].sort(compareCandidates));
    for (const candidate of first.candidates) {
      expect(candidate.endMs - candidate.startMs).toBeGreaterThanOrEqual(20_000);
      expect(candidate.endMs - candidate.startMs).toBeLessThanOrEqual(90_000);
      expect(transcript.some((segment) => segment.startMs === candidate.startMs)).toBe(true);
      expect(transcript.some((segment) => segment.endMs === candidate.endMs)).toBe(true);
      expect(candidate.generationProvenance).toEqual({
        artifactId: null,
        transcriptRevision: 7,
        generationVersion: CANDIDATE_GENERATION_VERSION,
        provider: null
      });
      expect(candidate.duplicateGroup).toMatch(/^[a-f0-9]{16}$/);
    }
    for (let left = 0; left < first.candidates.length; left++) {
      for (let right = left + 1; right < first.candidates.length; right++) {
        const a = first.candidates[left]!;
        const b = first.candidates[right]!;
        const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
        expect(overlap / Math.min(a.endMs - a.startMs, b.endMs - b.startMs)).toBeLessThanOrEqual(.35);
      }
    }
  });

  it("includes exact 20 and 90 second boundaries and has no segment-count cap", () => {
    const durations = [[20_000], [90_000], Array(10).fill(2_000)];
    const generatedDurations = durations.map((values) => generateCandidates({
      episodeId: randomUUID(),
      transcriptRevision: 1,
      segments: timedSegments(values),
      mode: "heuristic"
    }).candidates[0]!.endMs);
    expect(generatedDurations).toEqual([20_000, 90_000, 20_000]);
  });

  it("returns every valid choice and an explicit diagnostic without padding", () => {
    const result = generateCandidates({
      episodeId: randomUUID(),
      transcriptRevision: 2,
      segments: timedSegments([10_000, 10_000]),
      mode: "heuristic"
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostic).toMatchObject({
      sufficient: false,
      code: "INSUFFICIENT_MATERIAL",
      minimumCandidateCount: 5,
      requestedCount: 8,
      generatedCount: 1,
      eligibleWindowCount: 1
    });
  });

  it("uses only validated analysis scores, expands short highlights with an earlier tie break, and rejects floors", () => {
    const transcript = timedSegments(Array(12).fill(10_000));
    const provider = {
      provider: "ollama",
      providerClass: "local" as const,
      modelId: "gemma3",
      providerVersion: "1",
      optionsVersion: "v1",
      createdAt: "2026-07-27T12:00:00.000Z"
    };
    const artifactId = randomUUID();
    const strong = {
      hook: .8, coherence: .8, payoff: .8, independence: .8, delivery: .8, visualActivity: .95
    };
    const result = generateCandidates({
      episodeId: randomUUID(),
      transcriptRevision: 3,
      segments: transcript,
      mode: "analysis",
      analysisArtifactId: artifactId,
      provider,
      highlights: [
        { startMs: 20_100, endMs: 21_000, title: "Strong", reason: "Visual proof", scores: strong },
        {
          startMs: 30_100, endMs: 31_000, title: "Weak", reason: "Fragment",
          scores: { ...strong, coherence: .59 }
        },
        { startMs: 0, endMs: 100_000, title: "Overlong", reason: "Invalid", scores: strong },
        { startMs: 200_000, endMs: 201_000, title: "Outside", reason: "Invalid", scores: strong }
      ]
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      startMs: 10_000,
      endMs: 30_000,
      topic: "Strong",
      scores: strong,
      generationProvenance: { artifactId, transcriptRevision: 3, provider }
    });
    expect(result.diagnostic).toMatchObject({
      sufficient: false,
      rejectionCounts: { duration: 2, quality: 1 }
    });
  });

  it("uses documented component and range tie breakers", () => {
    const base = {
      episodeId: randomUUID(),
      transcriptRevision: 1,
      segments: timedSegments([20_000, 20_000, 20_000]),
      mode: "analysis" as const,
      analysisArtifactId: randomUUID(),
      provider: {
        provider: "fixture", providerClass: "local" as const, modelId: "v1",
        providerVersion: "1", optionsVersion: "1", createdAt: "2026-07-27T12:00:00.000Z"
      }
    };
    const scores = {
      hook: .7, coherence: .7, payoff: .7, independence: .7, delivery: .7, visualActivity: .7
    };
    const result = generateCandidates({
      ...base,
      highlights: [
        { startMs: 40_000, endMs: 60_000, title: "Later", reason: "Tie", scores },
        { startMs: 0, endMs: 20_000, title: "Earlier", reason: "Tie", scores }
      ]
    });
    expect(result.candidates.map((candidate) => candidate.startMs)).toEqual([0, 40_000]);
  });
});
