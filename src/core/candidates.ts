import { createHash, randomUUID } from "node:crypto";
import type { ClipCandidate, TranscriptSegment } from "../shared/domain.js";

export interface CandidateOptions {
  minDurationMs?: number;
  maxDurationMs?: number;
  count?: number;
}

const hookTerms = /\b(here'?s|why|how|secret|mistake|never|always|most|best|worst|imagine|surprising|truth)\b/i;
const payoffTerms = /\b(therefore|so that|the result|which means|because|finally|lesson|takeaway)\b/i;

export function generateCandidates(
  episodeId: string,
  segments: TranscriptSegment[],
  options: CandidateOptions = {}
): ClipCandidate[] {
  const minDuration = options.minDurationMs ?? 20_000;
  const maxDuration = options.maxDurationMs ?? 90_000;
  const targetCount = Math.min(10, Math.max(5, options.count ?? 8));
  if (!segments.length) return [];

  const windows: ClipCandidate[] = [];
  for (let startIndex = 0; startIndex < segments.length; startIndex++) {
    let endIndex = startIndex;
    while (endIndex < segments.length && segments[endIndex]!.endMs - segments[startIndex]!.startMs < minDuration) {
      endIndex++;
    }
    if (endIndex >= segments.length) continue;
    while (
      endIndex + 1 < segments.length
      && segments[endIndex + 1]!.endMs - segments[startIndex]!.startMs <= maxDuration
      && endIndex - startIndex < 8
    ) endIndex++;
    const selected = segments.slice(startIndex, endIndex + 1);
    const duration = selected.at(-1)!.endMs - selected[0]!.startMs;
    if (duration > maxDuration) continue;
    windows.push(scoreWindow(episodeId, selected));
  }

  const chosen: ClipCandidate[] = [];
  for (const candidate of windows.sort((a, b) => b.score - a.score)) {
    const overlap = chosen.some((other) => intersectionRatio(candidate, other) > 0.35);
    // High threshold: repeated framing words are common within one episode, while
    // only near-identical ideas should be collapsed across distant time ranges.
    const semanticDuplicate = chosen.some((other) => jaccard(candidate.transcript, other.transcript) > 0.88);
    if (!overlap && !semanticDuplicate) chosen.push(candidate);
    if (chosen.length === targetCount) break;
  }
  return chosen;
}

function scoreWindow(episodeId: string, segments: TranscriptSegment[]): ClipCandidate {
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
  const score = clamp(
    hook * 0.25 + coherence * 0.2 + payoff * 0.2 + independence * 0.2 + delivery * 0.1 + visualActivity * 0.05
  );
  const keywords = topKeywords(text);
  return {
    id: randomUUID(), episodeId, startMs: segments[0]!.startMs, endMs: segments.at(-1)!.endMs,
    transcript: text, topic: keywords.slice(0, 3).join(" · ") || "Untitled idea",
    hook: first, reason: reasonFor(scores), score, scores,
    duplicateGroup: createHash("sha1").update(keywords.slice(0, 5).sort().join("|")).digest("hex").slice(0, 10),
    reviewStatus: "pending", createdAt: new Date().toISOString()
  };
}

function reasonFor(scores: ClipCandidate["scores"]): string {
  const labels = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
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
  const left = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const right = new Set(b.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
