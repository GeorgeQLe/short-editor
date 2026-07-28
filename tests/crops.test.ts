import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateAutomaticCropTrack,
  interpolateCropFrames,
  remapSamplesToShort,
  resolveEffectiveCrop,
  type VisualCropArtifact
} from "../src/core/crops";
import { starterTemplates } from "../src/shared/templates";
import type { ManualCropControl, VisualCropSample } from "../src/shared/domain";

const now = "2026-07-28T12:00:00.000Z";
const layer = structuredClone(
  starterTemplates[2]!.composition.layers.find((value) => value.id === "speaker")!
);
if (layer.type !== "video") throw new Error("fixture layer must be video");

const baseSample = (atMs: number, boxes: Partial<VisualCropSample> = {}): VisualCropSample => ({
  atMs,
  activity: 0.5,
  speakerFraming: null,
  faceCount: null,
  screenShare: null,
  ...boxes
});
const artifact = (samples: VisualCropSample[]): VisualCropArtifact => ({
  capabilities: {
    activity: "supported",
    speakerFraming: "supported",
    faceDetection: "supported",
    screenShareDetection: "supported"
  },
  samples,
  provenance: {}
});
const generate = (
  visual: VisualCropArtifact,
  overrides: Partial<Parameters<typeof generateAutomaticCropTrack>[0]> = {}
) => generateAutomaticCropTrack({
  layer,
  sourceRanges: [{ startMs: 10_000, endMs: 20_000 }],
  outputDurationMs: 10_000,
  sourceWidth: 1920,
  sourceHeight: 1080,
  artifactId: randomUUID(),
  artifactContentHash: "fixture-hash",
  artifact: visual,
  generatedAt: now,
  ...overrides
});

describe("automatic crop generation", () => {
  it("remaps source gaps and reordered ranges onto contiguous Short time", () => {
    const samples = [
      baseSample(1_000),
      baseSample(11_000),
      baseSample(21_000)
    ];
    expect(remapSamplesToShort(samples, [
      { startMs: 20_000, endMs: 22_000 },
      { startMs: 0, endMs: 2_000 },
      { startMs: 10_000, endMs: 12_000 }
    ])).toEqual([
      { shortAtMs: 1_000, sample: samples[2] },
      { shortAtMs: 3_000, sample: samples[0] },
      { shortAtMs: 5_000, sample: samples[1] }
    ]);
  });

  it("selects and unions people, prefers screens for auto, corrects aspect, and stays bounded", () => {
    const peopleTrack = generate(artifact([
      baseSample(10_000, {
        faces: [{ x: 0.05, y: 0.1, width: 0.1, height: 0.2 }],
        people: [{ x: 0.7, y: 0.2, width: 0.2, height: 0.6 }],
        screens: [{ x: 0.2, y: 0.2, width: 0.3, height: 0.3 }]
      }),
      baseSample(15_000, {
        people: [{ x: 0.85, y: 0.75, width: 0.15, height: 0.25 }]
      })
    ]));
    expect(peopleTrack.fallback).toEqual({ mode: "none", reason: "none" });
    expect(peopleTrack.frames).toHaveLength(2);
    for (const frame of peopleTrack.frames) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(1);
      expect(frame.y + frame.height).toBeLessThanOrEqual(1);
      expect((frame.width * 1920) / (frame.height * 1080)).toBeCloseTo(
        (layer.region.width * 1080) / (layer.region.height * 1920)
      );
    }

    const auto = generate(artifact([
      baseSample(10_000, {
        people: [{ x: 0.8, y: 0.1, width: 0.1, height: 0.2 }],
        screens: [{ x: 0.05, y: 0.1, width: 0.4, height: 0.4 }]
      })
    ]), { layer: { ...layer, cropTarget: "auto" } });
    expect(auto.frames[0]!.x).toBeLessThan(0.5);
  });

  it("emits explicit fit/fill fallbacks for unsupported or unavailable inputs", () => {
    const unsupported = artifact([]);
    unsupported.capabilities.faceDetection = "unsupported";
    unsupported.capabilities.speakerFraming = "unsupported";
    expect(generate(unsupported).fallback).toEqual({ mode: "fill", reason: "missing_samples" });

    const noDetections = artifact([baseSample(10_000)]);
    noDetections.capabilities.faceDetection = "unsupported";
    noDetections.capabilities.speakerFraming = "unsupported";
    expect(generate(noDetections).fallback).toEqual({
      mode: "fill",
      reason: "unsupported_detection"
    });
    expect(generate(noDetections, {
      layer: { ...layer, fit: "fit" }
    }).frames[0]).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect(generate(noDetections, {
      sourceWidth: null,
      sourceHeight: null
    }).fallback.reason).toBe("missing_dimensions");
  });

  it("smooths deterministically and linearly interpolates bounded frames", () => {
    const first = generate(artifact([
      baseSample(10_000, { people: [{ x: 0, y: 0, width: 0.1, height: 0.2 }] }),
      baseSample(20_000, { people: [{ x: 0.9, y: 0.8, width: 0.1, height: 0.2 }] })
    ]), { sourceRanges: [{ startMs: 10_000, endMs: 20_000 }] });
    const second = generate(first.provenance
      ? artifact([
        baseSample(10_000, { people: [{ x: 0, y: 0, width: 0.1, height: 0.2 }] }),
        baseSample(20_000, { people: [{ x: 0.9, y: 0.8, width: 0.1, height: 0.2 }] })
      ])
      : artifact([]), { sourceRanges: [{ startMs: 10_000, endMs: 20_000 }] });
    expect(second.frames).toEqual(first.frames);
    const middle = interpolateCropFrames(first.frames, 5_000)!;
    expect(middle.x).toBeGreaterThanOrEqual(first.frames[0]!.x);
    expect(middle.x).toBeLessThanOrEqual(first.frames[1]!.x);
    for (let atMs = 0; atMs <= 10_000; atMs += 50) {
      const sampled = interpolateCropFrames(first.frames, atMs)!;
      expect(sampled.x).toBeGreaterThanOrEqual(0);
      expect(sampled.y).toBeGreaterThanOrEqual(0);
      expect(sampled.x + sampled.width).toBeLessThanOrEqual(1);
      expect(sampled.y + sampled.height).toBeLessThanOrEqual(1);
    }
  });

  it("keeps landscape, portrait, and square sources aspect-correct through intermittent detections", () => {
    for (const [sourceWidth, sourceHeight] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
      const track = generate(artifact([
        baseSample(10_000, { people: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.4 }] }),
        baseSample(15_000),
        baseSample(20_000, { faces: [{ x: 0.7, y: 0.2, width: 0.2, height: 0.3 }] })
      ]), {
        sourceWidth,
        sourceHeight,
        sourceRanges: [{ startMs: 10_000, endMs: 20_000 }]
      });
      expect(track.frames).toHaveLength(2);
      for (const frame of track.frames) {
        expect((frame.width * sourceWidth) / (frame.height * sourceHeight)).toBeCloseTo(
          (layer.region.width * 1080) / (layer.region.height * 1920)
        );
      }
    }
  });
});

describe("manual crop precedence", () => {
  const automatic = {
    frames: [
      { atMs: 0, x: 0, y: 0, width: 0.5, height: 0.5 },
      { atMs: 10_000, x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
    ],
    provenance: null,
    fallback: { mode: "none" as const, reason: "none" as const }
  };
  const controls: ManualCropControl[] = [
    { id: randomUUID(), mode: "crop", atMs: 2_000, x: 0, y: 0, width: 0.2, height: 0.2 },
    { id: randomUUID(), mode: "crop", atMs: 4_000, x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    { id: randomUUID(), mode: "automatic", atMs: 6_000 }
  ];

  it("interpolates crop overrides and resumes automatic exactly at the marker", () => {
    expect(resolveEffectiveCrop(automatic, controls, 1_000)).toEqual(
      interpolateCropFrames(automatic.frames, 1_000)
    );
    expect(resolveEffectiveCrop(automatic, controls, 3_000)).toMatchObject({ x: 0.2, y: 0.2 });
    expect(resolveEffectiveCrop(automatic, controls, 5_999)).toMatchObject({ x: 0.4, y: 0.4 });
    expect(resolveEffectiveCrop(automatic, controls, 6_000)).toEqual(
      interpolateCropFrames(automatic.frames, 6_000)
    );
  });
});
