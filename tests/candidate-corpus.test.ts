import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/core/candidates";
import type { ClipCandidate, TranscriptSegment } from "../src/shared/domain";

const root = join(import.meta.dirname, "fixtures", "candidate-corpus");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
  thresholds: {
    validity: number;
    recall: number;
    precision: number;
    pairwiseRankingAccuracy: number;
    temporalIou: number;
  };
  cases: string[];
};
type Scores = ClipCandidate["scores"];
type Highlight = {
  startMs: number; endMs: number; title: string; reason: string; scores: Scores;
};
const transcripts = JSON.parse(readFileSync(join(root, "transcripts.json"), "utf8")) as Record<
  string,
  { durationsMs: number[]; texts: string[]; highlights: Highlight[] }
>;
const labels = JSON.parse(readFileSync(join(root, "labels.json"), "utf8")) as Record<
  string,
  {
    expectedStatus: "sufficient" | "insufficient";
    eligibleHighlights: Array<{
      startMs: number; endMs: number; grade: number; semanticGroup: string;
    }>;
  }
>;

function segmentsFor(input: { durationsMs: number[]; texts: string[] }): TranscriptSegment[] {
  let cursor = 0;
  return input.durationsMs.map((duration, index) => {
    const startMs = cursor;
    cursor += duration;
    return {
      id: randomUUID(), startMs, endMs: cursor, text: input.texts[index]!,
      words: [], speaker: null, confidence: .95
    };
  });
}

function iou(left: { startMs: number; endMs: number }, right: { startMs: number; endMs: number }) {
  const intersection = Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
  const union = Math.max(left.endMs, right.endMs) - Math.min(left.startMs, right.startMs);
  return union ? intersection / union : 0;
}

function tokenJaccard(left: string, right: string) {
  const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

describe("balanced anonymized Candidate corpus gate", () => {
  it("meets validity, recall, precision, and pairwise ranking thresholds", () => {
    const generated: Array<{
      candidate: ClipCandidate;
      labels: typeof labels[string]["eligibleHighlights"];
    }> = [];
    let valid = 0;
    let total = 0;
    let recalled = 0;
    let labelCount = 0;
    let correctPairs = 0;
    let gradedPairs = 0;

    for (const name of manifest.cases) {
      const transcript = transcripts[name]!;
      const annotation = labels[name]!;
      const result = generateCandidates({
        episodeId: randomUUID(),
        transcriptRevision: 4,
        segments: segmentsFor(transcript),
        mode: "analysis",
        analysisArtifactId: randomUUID(),
        provider: {
          provider: "anonymized-fixture", providerClass: "local", modelId: "corpus-v1",
          providerVersion: "1", optionsVersion: "1", createdAt: "2026-07-27T12:00:00.000Z"
        },
        highlights: transcript.highlights
      });
      expect(result.diagnostic.sufficient ? "sufficient" : "insufficient")
        .toBe(annotation.expectedStatus);

      for (const candidate of result.candidates) {
        total++;
        const durationValid = candidate.endMs - candidate.startMs >= 20_000
          && candidate.endMs - candidate.startMs <= 90_000;
        const alignmentValid = result.candidates.every((item) =>
          segmentsFor(transcript).some((segment) => segment.startMs === item.startMs)
          && segmentsFor(transcript).some((segment) => segment.endMs === item.endMs)
        );
        const provenanceValid = candidate.generationProvenance.transcriptRevision === 4
          && candidate.generationProvenance.artifactId !== null
          && candidate.generationProvenance.provider?.provider === "anonymized-fixture";
        const distinct = result.candidates.every((other) => other === candidate
          || (iou(candidate, other) <= .35 && tokenJaccard(candidate.transcript, other.transcript) < .88));
        if (durationValid && alignmentValid && provenanceValid && distinct) valid++;
        generated.push({ candidate, labels: annotation.eligibleHighlights });
      }
      for (const label of annotation.eligibleHighlights) {
        labelCount++;
        if (result.candidates.some((candidate) => iou(candidate, label) >= manifest.thresholds.temporalIou)) {
          recalled++;
        }
      }
      for (let left = 0; left < result.candidates.length; left++) {
        for (let right = left + 1; right < result.candidates.length; right++) {
          const leftLabel = annotation.eligibleHighlights.find(
            (label) => iou(result.candidates[left]!, label) >= manifest.thresholds.temporalIou
          );
          const rightLabel = annotation.eligibleHighlights.find(
            (label) => iou(result.candidates[right]!, label) >= manifest.thresholds.temporalIou
          );
          if (!leftLabel || !rightLabel || leftLabel.grade === rightLabel.grade) continue;
          gradedPairs++;
          if (leftLabel.grade > rightLabel.grade) correctPairs++;
        }
      }
    }

    const precisionHits = generated.filter(({ candidate, labels: caseLabels }) =>
      caseLabels.some((label) => iou(candidate, label) >= manifest.thresholds.temporalIou)
    ).length;
    const metrics = {
      validity: valid / total,
      recall: recalled / labelCount,
      precision: precisionHits / generated.length,
      pairwiseRankingAccuracy: correctPairs / gradedPairs
    };
    expect(metrics.validity).toBeGreaterThanOrEqual(manifest.thresholds.validity);
    expect(metrics.recall).toBeGreaterThanOrEqual(manifest.thresholds.recall);
    expect(metrics.precision).toBeGreaterThanOrEqual(manifest.thresholds.precision);
    expect(metrics.pairwiseRankingAccuracy)
      .toBeGreaterThanOrEqual(manifest.thresholds.pairwiseRankingAccuracy);
    expect(metrics).toEqual({
      validity: 1,
      recall: 1,
      precision: 1,
      pairwiseRankingAccuracy: 1
    });
  });
});
