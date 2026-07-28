import { createHash, randomUUID } from "node:crypto";
import type {
  CandidateGenerationDiagnostic,
  CandidateGenerationResult,
  ClipCandidate,
  ProviderProvenance,
  TranscriptSegment
} from "../shared/domain.js";

export const CANDIDATE_ALGORITHM_VERSION = "segment-windows-v2";
export const CANDIDATE_SCORING_VERSION = "quality-floors-v1";
export const CANDIDATE_DEDUPLICATION_VERSION = "overlap-0.35+jaccard-0.88-v1";
export const CANDIDATE_GENERATION_VERSION = [
  CANDIDATE_ALGORITHM_VERSION,
  CANDIDATE_SCORING_VERSION,
  CANDIDATE_DEDUPLICATION_VERSION
].join("+");
export const CANDIDATE_MINIMUM_COUNT = 5;
export const CANDIDATE_MIN_DURATION_MS = 20_000;
export const CANDIDATE_MAX_DURATION_MS = 90_000;
export const CANDIDATE_SCORE_FLOOR = 0.55;
export const CANDIDATE_COHERENCE_FLOOR = 0.60;
export const CANDIDATE_INDEPENDENCE_FLOOR = 0.55;

export interface CandidateGenerationContext {
  episodeId: string;
  transcriptRevision: number;
  segments: TranscriptSegment[];
  count?: number;
  mode?: "heuristic";
}

export interface AnalysisHighlight {
  startMs: number;
  endMs: number;
  title: string;
  reason: string;
  scores: ClipCandidate["scores"];
}

export interface AnalysisCandidateGenerationContext {
  episodeId: string;
  transcriptRevision: number;
  segments: TranscriptSegment[];
  count?: number;
  mode: "analysis";
  analysisArtifactId: string;
  provider: ProviderProvenance;
  highlights: AnalysisHighlight[];
}

const hookTerms = /\b(here'?s|why|how|secret|mistake|never|always|most|best|worst|imagine|surprising|truth)\b/i;
const payoffTerms = /\b(therefore|so that|the result|which means|because|finally|lesson|takeaway)\b/i;
const componentOrder: Array<keyof ClipCandidate["scores"]> = [
  "hook", "coherence", "payoff", "independence", "delivery", "visualActivity"
];
const componentWeights: Record<keyof ClipCandidate["scores"], number> = {
  hook: 0.25,
  coherence: 0.20,
  payoff: 0.20,
  independence: 0.20,
  delivery: 0.10,
  visualActivity: 0.05
};

export function generateCandidates(
  context: CandidateGenerationContext | AnalysisCandidateGenerationContext
): CandidateGenerationResult {
  const requestedCount = Math.min(10, Math.max(5, context.count ?? 8));
  const rejections = { duration: 0, quality: 0, overlap: 0, semanticDuplication: 0 };
  let eligibleWindowCount = 0;
  let proposals: ClipCandidate[] = [];

  if (context.mode === "analysis") {
    for (const highlight of context.highlights) {
      const aligned = alignHighlight(context.segments, highlight);
      if (!aligned) {
        rejections.duration++;
        continue;
      }
      eligibleWindowCount++;
      const proposal = candidateFromSegments(context, aligned, highlight.scores, {
        topic: highlight.title,
        reason: highlight.reason,
        artifactId: context.analysisArtifactId,
        provider: context.provider
      });
      if (passesQuality(proposal)) proposals.push(proposal);
      else rejections.quality++;
    }
  } else {
    for (let start = 0; start < context.segments.length; start++) {
      for (let end = start; end < context.segments.length; end++) {
        const selected = context.segments.slice(start, end + 1);
        const duration = selected.at(-1)!.endMs - selected[0]!.startMs;
        if (duration < CANDIDATE_MIN_DURATION_MS) {
          rejections.duration++;
          continue;
        }
        if (duration > CANDIDATE_MAX_DURATION_MS) {
          rejections.duration += context.segments.length - end;
          break;
        }
        eligibleWindowCount++;
        const proposal = scoreHeuristicWindow(context, selected);
        if (passesQuality(proposal)) proposals.push(proposal);
        else rejections.quality++;
      }
    }
  }

  proposals.sort(compareCandidates);
  const clusters = clusterProposals(proposals);
  const representatives = clusters.map((cluster) => {
    const sorted = cluster.map((index) => proposals[index]!).sort(compareCandidates);
    const representative = sorted[0]!;
    const temporalDuplicates = sorted.slice(1).filter(
      (candidate) => intersectionRatio(representative, candidate) > 0.35
    ).length;
    rejections.overlap += temporalDuplicates;
    rejections.semanticDuplication += sorted.length - 1 - temporalDuplicates;
    return {
      ...representative,
      duplicateGroup: duplicateGroupFor(sorted)
    };
  }).sort(compareCandidates);
  const candidates = representatives.slice(0, requestedCount);
  const diagnostic: CandidateGenerationDiagnostic = candidates.length >= CANDIDATE_MINIMUM_COUNT
    ? { sufficient: true, requestedCount, generatedCount: candidates.length }
    : {
      sufficient: false,
      code: "INSUFFICIENT_MATERIAL",
      minimumCandidateCount: CANDIDATE_MINIMUM_COUNT,
      requestedCount,
      generatedCount: candidates.length,
      eligibleWindowCount,
      rejectionCounts: rejections
    };
  return { candidates, diagnostic };
}

function scoreHeuristicWindow(
  context: CandidateGenerationContext,
  segments: TranscriptSegment[]
): ClipCandidate {
  const text = segments.map((segment) => segment.text.trim()).join(" ");
  const first = segments[0]!.text;
  const last = segments.at(-1)!.text;
  const words = text.split(/\s+/).filter(Boolean);
  const durationSeconds = (segments.at(-1)!.endMs - segments[0]!.startMs) / 1000;
  const wordsPerMinute = words.length / durationSeconds * 60;
  const hook = clamp(0.3 + (hookTerms.test(first) ? 0.45 : 0) + (/[?!]/.test(first) ? 0.15 : 0));
  const coherence = clamp(0.45 + (/[.!?]$/.test(last.trim()) ? 0.3 : 0) + (segments.length >= 2 ? 0.15 : 0));
  const payoff = clamp(0.3 + (payoffTerms.test(text) ? 0.45 : 0) + (/\b(but|instead|actually)\b/i.test(text) ? 0.15 : 0));
  const independence = clamp(0.75 - (/^(and|but|so|it|they|this)\b/i.test(first.trim()) ? 0.35 : 0));
  const delivery = clamp(1 - Math.abs(wordsPerMinute - 155) / 220);
  const visualActivity = 0.5;
  const scores = { hook, coherence, payoff, independence, delivery, visualActivity };
  return candidateFromSegments(context, segments, scores);
}

function candidateFromSegments(
  context: CandidateGenerationContext | AnalysisCandidateGenerationContext,
  segments: TranscriptSegment[],
  scores: ClipCandidate["scores"],
  analysis?: {
    topic: string;
    reason: string;
    artifactId: string;
    provider: ProviderProvenance;
  }
): ClipCandidate {
  const text = normalizeWhitespace(segments.map((segment) => segment.text.trim()).join(" "));
  const first = segments[0]!.text.trim();
  const keywords = topKeywords(text);
  return {
    id: randomUUID(), episodeId: context.episodeId,
    startMs: segments[0]!.startMs, endMs: segments.at(-1)!.endMs,
    transcript: text,
    topic: analysis?.topic ?? (keywords.slice(0, 3).join(" · ") || "Untitled idea"),
    hook: first, reason: analysis?.reason ?? reasonFor(scores), score: aggregateScore(scores), scores,
    duplicateGroup: null,
    reviewStatus: "pending",
    generationProvenance: {
      artifactId: analysis?.artifactId ?? null,
      transcriptRevision: context.transcriptRevision,
      generationVersion: CANDIDATE_GENERATION_VERSION,
      provider: analysis?.provider ?? null
    },
    createdAt: new Date().toISOString()
  };
}

function alignHighlight(
  segments: TranscriptSegment[],
  highlight: AnalysisHighlight
): TranscriptSegment[] | null {
  const first = segments.findIndex((segment) =>
    segment.endMs > highlight.startMs && segment.startMs < highlight.endMs
  );
  if (first === -1) return null;
  let last = -1;
  for (let index = first; index < segments.length; index++) {
    if (segments[index]!.startMs >= highlight.endMs) break;
    if (segments[index]!.endMs > highlight.startMs) last = index;
  }
  if (last === -1) return null;
  let left = first;
  let right = last;
  let duration = segments[right]!.endMs - segments[left]!.startMs;
  if (duration > CANDIDATE_MAX_DURATION_MS) return null;
  while (duration < CANDIDATE_MIN_DURATION_MS) {
    const earlier = left > 0 ? segments[left - 1]! : null;
    const later = right + 1 < segments.length ? segments[right + 1]! : null;
    if (!earlier && !later) return null;
    if (earlier && (!later || segmentDuration(earlier) <= segmentDuration(later))) left--;
    else right++;
    duration = segments[right]!.endMs - segments[left]!.startMs;
    if (duration > CANDIDATE_MAX_DURATION_MS) return null;
  }
  return segments.slice(left, right + 1);
}

function clusterProposals(proposals: ClipCandidate[]): number[][] {
  const clusters: number[][] = [];
  proposals.forEach((proposal, index) => {
    const cluster = clusters.find((candidateIndexes) => {
      const representative = proposals[candidateIndexes[0]!]!;
      return intersectionRatio(representative, proposal) > 0.35
        || jaccard(representative.transcript, proposal.transcript) >= 0.88;
    });
    if (cluster) cluster.push(index);
    else clusters.push([index]);
  });
  return clusters;
}

export function compareCandidates(a: ClipCandidate, b: ClipCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  for (const component of componentOrder) {
    if (a.scores[component] !== b.scores[component]) {
      return b.scores[component] - a.scores[component];
    }
  }
  return a.startMs - b.startMs
    || a.endMs - b.endMs
    || lexicalCompare(normalizedTranscript(a.transcript), normalizedTranscript(b.transcript));
}

function aggregateScore(scores: ClipCandidate["scores"]): number {
  return clamp(componentOrder.reduce(
    (total, component) => total + scores[component] * componentWeights[component],
    0
  ));
}

function passesQuality(candidate: ClipCandidate): boolean {
  return candidate.score >= CANDIDATE_SCORE_FLOOR
    && candidate.scores.coherence >= CANDIDATE_COHERENCE_FLOOR
    && candidate.scores.independence >= CANDIDATE_INDEPENDENCE_FLOOR;
}

function duplicateGroupFor(candidates: ClipCandidate[]): string {
  const content = [...new Set(candidates.map((candidate) =>
    normalizedTranscript(candidate.transcript)
  ))].sort().join("|");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function reasonFor(scores: ClipCandidate["scores"]): string {
  const labels = componentOrder.map((name) => [name, scores[name]] as const)
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
  return `Strong ${labels[0]} and ${labels[1]}; complete sentence-aligned idea.`;
}

function topKeywords(text: string): string[] {
  const stop = new Set(["that", "this", "with", "from", "have", "your", "about", "there", "what", "when", "they", "would", "could", "should"]);
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!stop.has(raw)) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

function intersectionRatio(a: ClipCandidate, b: ClipCandidate): number {
  const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  return overlap / Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
}

function jaccard(a: string, b: string): number {
  const left = new Set(normalizedTokens(a));
  const right = new Set(normalizedTokens(b));
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function normalizedTokens(text: string): string[] {
  return normalizedTranscript(text).match(/[a-z0-9]+/g) ?? [];
}

function normalizedTranscript(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function segmentDuration(segment: TranscriptSegment): number {
  return segment.endMs - segment.startMs;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
