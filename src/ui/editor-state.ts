import type {
  AudioState,
  CaptionState,
  Composition,
  ShortProject
} from "../shared/domain";

export type EditorSection = "timeline" | "composition" | "captions" | "audio";

export interface EditorContent {
  sourceRanges: ShortProject["sourceRanges"];
  composition: Composition;
  captions: CaptionState;
  audio: AudioState;
}

export interface EditorHistory {
  entries: EditorContent[];
  index: number;
}

export function contentFromShort(short: ShortProject): EditorContent {
  return clone({
    sourceRanges: short.sourceRanges,
    composition: short.composition,
    captions: short.captions,
    audio: short.audio
  });
}

export function createHistory(content: EditorContent): EditorHistory {
  return { entries: [clone(content)], index: 0 };
}

export function pushHistory(
  history: EditorHistory,
  content: EditorContent,
  coalesce = false
): EditorHistory {
  if (equal(history.entries[history.index], content)) return history;
  const entries = history.entries.slice(0, history.index + 1);
  if (coalesce && entries.length > 1) entries[entries.length - 1] = clone(content);
  else entries.push(clone(content));
  return { entries, index: entries.length - 1 };
}

export function undoHistory(history: EditorHistory): EditorHistory {
  return { ...history, index: Math.max(0, history.index - 1) };
}

export function redoHistory(history: EditorHistory): EditorHistory {
  return { ...history, index: Math.min(history.entries.length - 1, history.index + 1) };
}

export function historyContent(history: EditorHistory): EditorContent {
  return clone(history.entries[history.index]!);
}

export function dirtySections(
  baseline: EditorContent,
  draft: EditorContent
): Set<EditorSection> {
  const dirty = new Set<EditorSection>();
  if (!equal(baseline.sourceRanges, draft.sourceRanges)) dirty.add("timeline");
  if (!equal(baseline.composition, draft.composition)) dirty.add("composition");
  if (!equal(baseline.captions, draft.captions)) dirty.add("captions");
  if (!equal(baseline.audio, draft.audio)) dirty.add("audio");
  return dirty;
}

export function mergeCanonicalSave(
  priorDraft: EditorContent,
  canonical: ShortProject,
  savedSection: EditorSection,
  dirtyBeforeSave: ReadonlySet<EditorSection>
): { baseline: EditorContent; draft: EditorContent } {
  const baseline = contentFromShort(canonical);
  const draft = clone(baseline);
  for (const section of dirtyBeforeSave) {
    if (section === savedSection) continue;
    if (section === "timeline") draft.sourceRanges = clone(priorDraft.sourceRanges);
    else if (section === "composition") draft.composition = clone(priorDraft.composition);
    else if (section === "captions") draft.captions = clone(priorDraft.captions);
    else draft.audio = clone(priorDraft.audio);
  }
  if (savedSection === "timeline") {
    // Caption diagnostics and sidecars are source-map dependent.
    draft.captions = clone(priorDraft.captions);
    if (!dirtyBeforeSave.has("captions")) {
      draft.captions.sidecars = { srt: null, webvtt: null };
    }
  }
  return { baseline, draft };
}

export function mapOutputToSource(
  ranges: ShortProject["sourceRanges"],
  outputAtMs: number
): { sourceAtMs: number; rangeIndex: number } {
  let offset = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    const duration = range.endMs - range.startMs;
    if (outputAtMs < offset + duration || index === ranges.length - 1) {
      return {
        sourceAtMs: range.startMs + Math.max(0, Math.min(duration, outputAtMs - offset)),
        rangeIndex: index
      };
    }
    offset += duration;
  }
  return { sourceAtMs: 0, rangeIndex: 0 };
}

export function outputDuration(ranges: ShortProject["sourceRanges"]): number {
  return ranges.reduce((total, range) => total + range.endMs - range.startMs, 0);
}

export function cropControlsPastDuration(
  composition: Composition,
  durationMs: number
): Array<{ layerId: string; controlId: string; atMs: number }> {
  return composition.layers.flatMap((layer) => layer.type !== "video"
    ? []
    : layer.manualCropTrack
      .filter((control) => control.atMs > durationMs)
      .map((control) => ({ layerId: layer.id, controlId: control.id, atMs: control.atMs })));
}

export function effectiveCrop(
  layer: Extract<Composition["layers"][number], { type: "video" }>,
  atMs: number
): { x: number; y: number; width: number; height: number } | null {
  const prior = [...layer.manualCropTrack].reverse().find((control) => control.atMs <= atMs);
  if (prior?.mode === "crop") return rectangle(prior);
  const frames = layer.automaticCropTrack.frames;
  if (!frames.length) return null;
  const rightIndex = frames.findIndex((frame) => frame.atMs >= atMs);
  if (rightIndex <= 0) return rectangle(frames[Math.max(0, rightIndex)] ?? frames[0]!);
  if (rightIndex < 0) return rectangle(frames[frames.length - 1]!);
  const left = frames[rightIndex - 1]!;
  const right = frames[rightIndex]!;
  const ratio = (atMs - left.atMs) / Math.max(1, right.atMs - left.atMs);
  return {
    x: mix(left.x, right.x, ratio),
    y: mix(left.y, right.y, ratio),
    width: mix(left.width, right.width, ratio),
    height: mix(left.height, right.height, ratio)
  };
}

function rectangle(value: { x: number; y: number; width: number; height: number }) {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function mix(left: number, right: number, ratio: number) {
  return left + (right - left) * ratio;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
