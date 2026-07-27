import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/core/candidates";
import { segments } from "./factories";

describe("candidate generation", () => {
  it("returns ranked, bounded, sentence-aligned and substantially non-overlapping windows", () => {
    const transcript = segments(80);
    const candidates = generateCandidates(crypto.randomUUID(), transcript, { count: 8 });

    expect(candidates.length).toBeGreaterThanOrEqual(5);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(candidates).toEqual([...candidates].sort((a, b) => b.score - a.score));
    for (const candidate of candidates) {
      expect(candidate.endMs - candidate.startMs).toBeGreaterThanOrEqual(20_000);
      expect(candidate.endMs - candidate.startMs).toBeLessThanOrEqual(90_000);
      expect(transcript.some((segment) => segment.startMs === candidate.startMs)).toBe(true);
      expect(transcript.some((segment) => segment.endMs === candidate.endMs)).toBe(true);
    }
    for (let left = 0; left < candidates.length; left++) {
      for (let right = left + 1; right < candidates.length; right++) {
        const a = candidates[left]!;
        const b = candidates[right]!;
        const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
        expect(overlap / Math.min(a.endMs - a.startMs, b.endMs - b.startMs)).toBeLessThanOrEqual(.35);
      }
    }
  });

  it("returns no candidates without a transcript", () => {
    expect(generateCandidates(crypto.randomUUID(), [])).toEqual([]);
  });
});
