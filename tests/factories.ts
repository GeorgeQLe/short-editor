import { randomUUID } from "node:crypto";
import type { ClipCandidate, Episode, TranscriptSegment } from "../src/shared/domain";

export function episode(overrides: Partial<Episode> = {}): Episode {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), sourcePath: "/fixture/episode.mp4", canonicalPath: `/fixture/${randomUUID()}.mp4`,
    fingerprint: randomUUID(), contentHash: null, fileSize: 100, modifiedAtMs: 100,
    durationMs: 120_000, width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac",
    status: "ready", missing: false, relinkRestoreStatus: null,
    candidateCount: 0, renderedShortCount: 0, scheduledCount: 0,
    createdAt: now, updatedAt: now, ...overrides
  };
}

export function segments(count = 60): TranscriptSegment[] {
  return Array.from({ length: count }, (_, index) => {
    const concept = `concept${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`;
    return ({
    id: randomUUID(), startMs: index * 5_000, endMs: (index + 1) * 5_000,
    text: index % 6 === 0
      ? `Here is why ${concept} changes the outcome completely.`
      : `${concept} explains a distinct practical example and the result.`,
    words: [], speaker: "speaker-1", confidence: 0.95
    });
  });
}

export function candidate(episodeId: string, overrides: Partial<ClipCandidate> = {}): ClipCandidate {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), episodeId, startMs: 0, endMs: 30_000,
    transcript: "Here is why this practical lesson changes the result.",
    topic: "practical lesson", hook: "Here is why this matters.",
    reason: "Strong hook and payoff.", score: 0.8,
    scores: { hook: .9, coherence: .8, payoff: .8, independence: .8, delivery: .7, visualActivity: .5 },
    duplicateGroup: null, reviewStatus: "approved",
    generationProvenance: {
      artifactId: null, transcriptRevision: 1, generationVersion: "fixture-v1", provider: null
    },
    generationRunId: null, revision: 1, state: "active",
    createdAt: now, updatedAt: now, ...overrides
  };
}
