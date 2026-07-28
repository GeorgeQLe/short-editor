import {
  automaticCropTrackSchema,
  type AutomaticCropFrame,
  type AutomaticCropTrack,
  type Composition,
  type ManualCropControl,
  type ShortProject,
  type VisualCropSample,
  visualCropSampleSchema
} from "../shared/domain.js";
import { z } from "zod";

export const CROP_GENERATOR_VERSION = "automatic-crop-v1";
export const CROP_SMOOTHING_VERSION = "ema-0.35-padding-0.15-v1";
const SMOOTHING_ALPHA = 0.35;
const DETECTION_PADDING = 0.15;

export const visualCropArtifactSchema = z.strictObject({
  capabilities: z.strictObject({
    activity: z.literal("supported"),
    speakerFraming: z.enum(["supported", "unsupported"]),
    faceDetection: z.enum(["supported", "unsupported"]),
    screenShareDetection: z.enum(["supported", "unsupported"])
  }),
  samples: z.array(visualCropSampleSchema),
  provenance: z.unknown()
});
export type VisualCropArtifact = z.infer<typeof visualCropArtifactSchema>;

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GenerateAutomaticCropInput {
  layer: Extract<Composition["layers"][number], { type: "video" }>;
  sourceRanges: ShortProject["sourceRanges"];
  outputDurationMs: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  artifactId: string;
  artifactContentHash: string;
  artifact: VisualCropArtifact;
  generatedAt: string;
}

export function generateAutomaticCropTrack(input: GenerateAutomaticCropInput): AutomaticCropTrack {
  const fallbackMode = input.layer.fit;
  if (input.layer.source !== "episode") {
    return fallbackTrack(input, fallbackMode, "unmatched_source");
  }
  if (!input.sourceWidth || !input.sourceHeight) {
    return fallbackTrack(input, fallbackMode, "missing_dimensions");
  }
  const sourceWidth = input.sourceWidth;
  const sourceHeight = input.sourceHeight;
  const remapped = remapSamplesToShort(input.artifact.samples, input.sourceRanges);
  if (!remapped.length) return fallbackTrack(input, fallbackMode, "missing_samples");

  const capabilitySupported = input.layer.cropTarget === "screen"
    ? input.artifact.capabilities.screenShareDetection === "supported"
    : input.layer.cropTarget === "person"
      ? input.artifact.capabilities.faceDetection === "supported"
        || input.artifact.capabilities.speakerFraming === "supported"
      : input.artifact.capabilities.screenShareDetection === "supported"
        || input.artifact.capabilities.faceDetection === "supported"
        || input.artifact.capabilities.speakerFraming === "supported";

  const targetAspect = layerPixelAspect(input.layer);
  const detected = remapped.flatMap(({ shortAtMs, sample }) => {
    const observations = selectObservations(sample, input.layer.cropTarget);
    if (!observations.length) return [];
    const union = unionRectangles(observations);
    return [{
      atMs: shortAtMs,
      ...aspectCorrect(
        pad(union, DETECTION_PADDING),
        targetAspect,
        sourceWidth,
        sourceHeight
      )
    }];
  });
  if (!detected.length) {
    return fallbackTrack(
      input,
      fallbackMode,
      capabilitySupported ? "missing_detections" : "unsupported_detection"
    );
  }

  const frames = smoothFrames(detected);
  return automaticCropTrackSchema.parse({
    frames,
    provenance: provenance(input),
    fallback: { mode: "none", reason: "none" }
  });
}

export function remapSamplesToShort(
  samples: readonly VisualCropSample[],
  ranges: ShortProject["sourceRanges"]
): Array<{ shortAtMs: number; sample: VisualCropSample }> {
  const output: Array<{ shortAtMs: number; sample: VisualCropSample }> = [];
  let offset = 0;
  for (const range of ranges) {
    for (const sample of samples) {
      if (sample.atMs < range.startMs || sample.atMs > range.endMs) continue;
      output.push({ shortAtMs: offset + sample.atMs - range.startMs, sample });
    }
    offset += range.endMs - range.startMs;
  }
  output.sort((a, b) => a.shortAtMs - b.shortAtMs);
  return output.filter((value, index) =>
    index === 0 || value.shortAtMs !== output[index - 1]!.shortAtMs
  );
}

export function interpolateCropFrames(
  frames: readonly AutomaticCropFrame[],
  atMs: number
): Rectangle | null {
  if (!frames.length) return null;
  if (atMs <= frames[0]!.atMs) return rectangle(frames[0]!);
  const last = frames[frames.length - 1]!;
  if (atMs >= last.atMs) return rectangle(last);
  const rightIndex = frames.findIndex((frame) => frame.atMs >= atMs);
  const left = frames[rightIndex - 1]!;
  const right = frames[rightIndex]!;
  if (right.atMs === atMs) return rectangle(right);
  return interpolate(left, right, (atMs - left.atMs) / (right.atMs - left.atMs));
}

export function resolveEffectiveCrop(
  automatic: AutomaticCropTrack,
  manual: readonly ManualCropControl[],
  atMs: number
): Rectangle | null {
  const priorIndex = findLastIndex(manual, (control) => control.atMs <= atMs);
  if (priorIndex < 0 || manual[priorIndex]!.mode === "automatic") {
    return interpolateCropFrames(automatic.frames, atMs);
  }
  const left = manual[priorIndex]!;
  if (left.mode !== "crop") return interpolateCropFrames(automatic.frames, atMs);
  const next = manual[priorIndex + 1];
  if (next?.mode === "crop" && atMs < next.atMs) {
    return interpolate(left, next, (atMs - left.atMs) / (next.atMs - left.atMs));
  }
  return rectangle(left);
}

function selectObservations(
  sample: VisualCropSample,
  target: "person" | "screen" | "auto"
): Rectangle[] {
  const screens = sample.screens ?? [];
  const people = [...(sample.people ?? []), ...(sample.faces ?? [])];
  if (target === "screen") return screens;
  if (target === "person") return people;
  return screens.length ? screens : people;
}

function fallbackTrack(
  input: GenerateAutomaticCropInput,
  mode: "fit" | "fill",
  reason: AutomaticCropTrack["fallback"]["reason"]
): AutomaticCropTrack {
  const frame = mode === "fit"
    ? { x: 0, y: 0, width: 1, height: 1 }
    : aspectCorrect(
      { x: 0, y: 0, width: 1, height: 1 },
      layerPixelAspect(input.layer),
      input.sourceWidth ?? 1,
      input.sourceHeight ?? 1
    );
  return automaticCropTrackSchema.parse({
    frames: [{ atMs: 0, ...frame }],
    provenance: provenance(input),
    fallback: { mode, reason }
  });
}

function provenance(input: GenerateAutomaticCropInput) {
  return {
    artifactId: input.artifactId,
    artifactContentHash: input.artifactContentHash,
    generatorVersion: CROP_GENERATOR_VERSION,
    smoothingVersion: CROP_SMOOTHING_VERSION,
    target: input.layer.cropTarget,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    generatedAt: input.generatedAt
  };
}

function layerPixelAspect(layer: GenerateAutomaticCropInput["layer"]): number {
  return (layer.region.width * 1080) / (layer.region.height * 1920);
}

function unionRectangles(values: readonly Rectangle[]): Rectangle {
  const x = Math.min(...values.map((value) => value.x));
  const y = Math.min(...values.map((value) => value.y));
  const right = Math.max(...values.map((value) => value.x + value.width));
  const bottom = Math.max(...values.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

function pad(value: Rectangle, amount: number): Rectangle {
  const xPadding = value.width * amount;
  const yPadding = value.height * amount;
  return clamp({
    x: value.x - xPadding,
    y: value.y - yPadding,
    width: value.width + xPadding * 2,
    height: value.height + yPadding * 2
  });
}

function aspectCorrect(
  value: Rectangle,
  targetPixelAspect: number,
  sourceWidth: number,
  sourceHeight: number
): Rectangle {
  const normalizedAspect = targetPixelAspect * sourceHeight / sourceWidth;
  let width = value.width;
  let height = value.height;
  if (width / height < normalizedAspect) width = height * normalizedAspect;
  else height = width / normalizedAspect;
  if (width > 1) {
    width = 1;
    height = width / normalizedAspect;
  }
  if (height > 1) {
    height = 1;
    width = height * normalizedAspect;
  }
  return clamp({
    x: value.x + value.width / 2 - width / 2,
    y: value.y + value.height / 2 - height / 2,
    width,
    height
  });
}

function smoothFrames(frames: AutomaticCropFrame[]): AutomaticCropFrame[] {
  let previous = frames[0]!;
  return frames.map((frame, index) => {
    if (index === 0) return frame;
    previous = {
      atMs: frame.atMs,
      x: mix(previous.x, frame.x, SMOOTHING_ALPHA),
      y: mix(previous.y, frame.y, SMOOTHING_ALPHA),
      width: mix(previous.width, frame.width, SMOOTHING_ALPHA),
      height: mix(previous.height, frame.height, SMOOTHING_ALPHA)
    };
    return clampFrame(previous);
  });
}

function interpolate(left: Rectangle, right: Rectangle, amount: number): Rectangle {
  return clamp({
    x: mix(left.x, right.x, amount),
    y: mix(left.y, right.y, amount),
    width: mix(left.width, right.width, amount),
    height: mix(left.height, right.height, amount)
  });
}

function rectangle(value: Rectangle): Rectangle {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function clampFrame(value: AutomaticCropFrame): AutomaticCropFrame {
  return { atMs: value.atMs, ...clamp(value) };
}

function clamp(value: Rectangle): Rectangle {
  const width = Math.min(1, Math.max(Number.EPSILON, value.width));
  const height = Math.min(1, Math.max(Number.EPSILON, value.height));
  return {
    x: Math.min(1 - width, Math.max(0, value.x)),
    y: Math.min(1 - height, Math.max(0, value.y)),
    width,
    height
  };
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}
