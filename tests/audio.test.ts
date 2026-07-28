import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAudioDecision,
  deriveAudioWarnings
} from "../src/core/audio";
import { audioUpdateInputSchema, type AudioState } from "../src/shared/domain";

const episodeId = randomUUID();
const bedAssetId = randomUUID();
const audio = (overrides: Partial<AudioState> = {}): AudioState => ({
  sourceGainDb: 0,
  sourceMuted: false,
  cutFadeMs: 250,
  bedAssetId: null,
  bedGainDb: null,
  warnings: [],
  ...overrides
});

describe("deterministic audio decisions", () => {
  it("maps every Episode range contiguously and caps fades at half each range", () => {
    const decision = buildAudioDecision({
      episodeId,
      sourceRanges: [
        { startMs: 10_000, endMs: 10_101 },
        { startMs: 30_000, endMs: 31_000 },
        { startMs: 50_000, endMs: 50_500 }
      ],
      audio: audio({ sourceGainDb: 6, sourceMuted: true, cutFadeMs: 250 }),
      bedDurationMs: null
    });
    expect(decision.source).toEqual([
      {
        source: "episode", episodeId,
        sourceStartMs: 10_000, sourceEndMs: 10_101,
        outputStartMs: 0, outputEndMs: 101,
        gainDb: 6, muted: true, fadeInMs: 50, fadeOutMs: 50
      },
      {
        source: "episode", episodeId,
        sourceStartMs: 30_000, sourceEndMs: 31_000,
        outputStartMs: 101, outputEndMs: 1_101,
        gainDb: 6, muted: true, fadeInMs: 250, fadeOutMs: 250
      },
      {
        source: "episode", episodeId,
        sourceStartMs: 50_000, sourceEndMs: 50_500,
        outputStartMs: 1_101, outputEndMs: 1_601,
        gainDb: 6, muted: true, fadeInMs: 250, fadeOutMs: 250
      }
    ]);
    expect(decision.outputDurationMs).toBe(1_601);
  });

  it("starts the bed at zero, stays continuous across cuts, loops, and trims exactly", () => {
    const input = {
      episodeId,
      sourceRanges: [
        { startMs: 1_000, endMs: 2_000 },
        { startMs: 9_000, endMs: 10_501 }
      ],
      audio: audio({ bedAssetId, bedGainDb: -18 }),
      bedDurationMs: 1_000
    };
    const first = buildAudioDecision(input);
    expect(first.bed).toEqual({
      assetId: bedAssetId,
      gainDb: -18,
      startsAtAssetTimeMs: 0,
      loops: true,
      playback: [
        { outputStartMs: 0, outputEndMs: 1_000, assetStartMs: 0, assetEndMs: 1_000 },
        { outputStartMs: 1_000, outputEndMs: 2_000, assetStartMs: 0, assetEndMs: 1_000 },
        { outputStartMs: 2_000, outputEndMs: 2_501, assetStartMs: 0, assetEndMs: 501 }
      ]
    });
    expect(buildAudioDecision(structuredClone(input))).toEqual(first);
  });

  it("trims a long bed once and never creates generated or rewrite audio routes", () => {
    const decision = buildAudioDecision({
      episodeId,
      sourceRanges: [{ startMs: 4_000, endMs: 6_000 }],
      audio: audio({ bedAssetId, bedGainDb: -24 }),
      bedDurationMs: 5_000
    });
    expect(decision.bed).toMatchObject({
      loops: false,
      playback: [
        { outputStartMs: 0, outputEndMs: 2_000, assetStartMs: 0, assetEndMs: 2_000 }
      ]
    });
    expect(decision.source.every((route) => route.source === "episode")).toBe(true);
    expect(JSON.stringify(decision)).not.toMatch(/rewrite|voice|generated/i);
  });
});

describe("audio warnings and input schema", () => {
  it("warns below 12 dB, but not at or above the threshold", () => {
    expect(deriveAudioWarnings(audio({
      sourceGainDb: 0, bedAssetId, bedGainDb: -11.99
    }))).toHaveLength(1);
    expect(deriveAudioWarnings(audio({
      sourceGainDb: 0, bedAssetId, bedGainDb: -12
    }))).toEqual([]);
    expect(deriveAudioWarnings(audio({
      sourceGainDb: 0, bedAssetId, bedGainDb: -12.01
    }))).toEqual([]);
  });

  it("warns for every muted-source/bed combination and never without a bed", () => {
    expect(deriveAudioWarnings(audio({
      sourceMuted: true, sourceGainDb: 12, bedAssetId, bedGainDb: -60
    }))).toHaveLength(1);
    expect(deriveAudioWarnings(audio({ sourceMuted: true }))).toEqual([]);
  });

  it("strictly rejects unknown, non-finite, inconsistent, and out-of-range settings", () => {
    const valid = {
      expectedRevision: 1,
      sourceGainDb: -60,
      sourceMuted: false,
      cutFadeMs: 500,
      bedAssetId: null,
      bedGainDb: null
    };
    expect(audioUpdateInputSchema.parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, unknown: true },
      { ...valid, sourceGainDb: Number.NaN },
      { ...valid, sourceGainDb: Number.POSITIVE_INFINITY },
      { ...valid, sourceGainDb: -60.01 },
      { ...valid, sourceGainDb: 12.01 },
      { ...valid, cutFadeMs: 1.5 },
      { ...valid, cutFadeMs: 501 },
      { ...valid, bedAssetId, bedGainDb: null },
      { ...valid, bedAssetId: null, bedGainDb: -18 },
      { ...valid, bedAssetId, bedGainDb: 0.01 },
      { ...valid, bedAssetId, bedGainDb: -60.01 }
    ]) expect(audioUpdateInputSchema.safeParse(invalid).success).toBe(false);
  });
});
