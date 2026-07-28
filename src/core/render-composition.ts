import { createHash } from "node:crypto";
import type {
  CaptionCue,
  Composition,
  ManualCropControl
} from "../shared/domain.js";
import type { RenderSnapshot } from "./render-preflight.js";

export const RENDER_GRAPH_VERSION = "ffmpeg-composition-v1";

export interface RenderGraph {
  script: string;
  inputArgs: string[];
  inputPaths: string[];
  outputArgs: string[];
  graphHash: string;
}

export function buildRenderGraph(
  snapshot: RenderSnapshot,
  filterScriptPath: string,
  outputPath: string,
  fontDirectory: string
): RenderGraph {
  const durationSeconds = seconds(snapshot.output.durationMs);
  const assets = snapshot.resources.assets;
  const inputPaths = [snapshot.resources.episode.file.path, ...assets.map(({ file }) => file.path)];
  const inputArgs = ["-i", inputPaths[0]!];
  assets.forEach(({ identity, file }) => {
    if (identity.kind === "image" || identity.kind === "logo") {
      inputArgs.push("-loop", "1", "-framerate", "30");
    } else if (identity.kind === "audio") {
      inputArgs.push("-stream_loop", "-1");
    }
    inputArgs.push("-i", file.path);
  });
  const assetInput = new Map(assets.map(({ identity }, index) => [identity.id, index + 1]));
  const lines: string[] = [];
  const assetLayerLabels = new Map<string, string[]>();
  for (const { identity } of assets) {
    const uses = snapshot.short.composition.layers.filter(
      (layer) => layer.source === "asset" && layer.assetId === identity.id &&
        (layer.type === "image" || layer.type === "logo" || layer.type === "video")
    ).length;
    if (!uses) continue;
    const input = assetInput.get(identity.id)!;
    const labels = Array.from({ length: uses }, (_, index) => `asset_${input}_layer_${index}`);
    assetLayerLabels.set(identity.id, labels);
    if (uses > 1) {
      lines.push(`[${input}:v]split=${uses}${labels.map((label) => `[${label}]`).join("")}`);
    } else {
      lines.push(`[${input}:v]null[${labels[0]}]`);
    }
  }
  const episodeLayers = snapshot.short.composition.layers.filter(
    (layer) => layer.type === "video" && layer.source === "episode"
  );
  if (episodeLayers.length) {
    const ranges = snapshot.sourceRanges;
    if (ranges.length > 1) {
      lines.push(`[0:v]split=${ranges.length}${ranges.map((_, i) => `[episode_source_${i}]`).join("")}`);
    }
    ranges.forEach((range, index) => {
      const source = ranges.length === 1 ? "[0:v]" : `[episode_source_${index}]`;
      lines.push(
        `${source}trim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},` +
        `setpts=PTS-STARTPTS[episode_segment_${index}]`
      );
    });
    const concatenated = ranges.length === 1
      ? "[episode_segment_0]"
      : `${ranges.map((_, index) => `[episode_segment_${index}]`).join("")}` +
        `concat=n=${ranges.length}:v=1:a=0[episode_timeline]`;
    if (ranges.length > 1) lines.push(concatenated);
    const timeline = ranges.length === 1 ? "[episode_segment_0]" : "[episode_timeline]";
    if (episodeLayers.length === 1) {
      lines.push(`${timeline}null[episode_layer_0]`);
    } else {
      lines.push(`${timeline}split=${episodeLayers.length}${
        episodeLayers.map((_, index) => `[episode_layer_${index}]`).join("")
      }`);
    }
  }

  lines.push(
    `color=c=${snapshot.short.composition.background}:s=1080x1920:r=30:d=${durationSeconds},` +
    "format=yuv420p[canvas_0]"
  );
  let canvasIndex = 0;
  let episodeLayerIndex = 0;
  for (const layer of snapshot.short.composition.layers) {
    if (layer.type === "captions") {
      if (snapshot.short.captions.enabled) {
        const input = `[canvas_${canvasIndex}]`;
        const filters = captionFilters(
          input,
          snapshot.short.captions.cues,
          snapshot.short.captions.style,
          snapshot.sourceRanges,
          fontDirectory
        );
        if (filters === input) continue;
        const next = `canvas_${canvasIndex + 1}`;
        lines.push(`${filters}[${next}]`);
        canvasIndex++;
      }
      continue;
    }
    if (layer.type === "shape") continue;
    let source: string | null = null;
    if (layer.type === "video" && layer.source === "episode") {
      source = `[episode_layer_${episodeLayerIndex++}]`;
    } else if (layer.source === "asset" && layer.assetId) {
      const label = assetLayerLabels.get(layer.assetId)?.shift();
      if (label) source = `[${label}]`;
    }
    if (!source) continue;
    const region = pixelRegion(layer.region, snapshot.short.composition);
    const prepared = `layer_${canvasIndex}_prepared`;
    const fitted = fitChain(
      source,
      region.width,
      region.height,
      layer.fit,
      layer.type === "video" ? cropExpressions(layer) : null,
      durationSeconds
    );
    lines.push(`${fitted}[${prepared}]`);
    lines.push(
      `[canvas_${canvasIndex}][${prepared}]overlay=x=${region.x}:y=${region.y}:` +
      `eof_action=repeat:shortest=1[canvas_${canvasIndex + 1}]`
    );
    canvasIndex++;
  }
  lines.push(`[canvas_${canvasIndex}]fps=30,format=yuv420p[vout]`);
  buildAudioGraph(snapshot, lines);
  const script = `${lines.join(";\n")}\n`;
  const graphHash = `sha256:${createHash("sha256").update(script).digest("hex")}`;
  const outputArgs = [
    "-filter_complex_script", filterScriptPath,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-map_metadata", "-1",
    "-metadata", "creation_time=1970-01-01T00:00:00Z",
    "-metadata", "encoder=short-editor",
    "-progress", "pipe:1",
    "-nostats",
    "-t", durationSeconds,
    "-f", "mp4",
    "-y",
    outputPath
  ];
  return { script, inputArgs, inputPaths, outputArgs, graphHash };
}

function buildAudioGraph(snapshot: RenderSnapshot, lines: string[]): void {
  const decision = snapshot.decisions.audio;
  const audible: string[] = [];
  if (decision && decision.source.some((segment) => !segment.muted)) {
    const sourceSegments = decision.source.filter((segment) => !segment.muted);
    if (sourceSegments.length > 1) {
      lines.push(`[0:a]asplit=${sourceSegments.length}${
        sourceSegments.map((_, index) => `[audio_source_${index}]`).join("")
      }`);
    }
    sourceSegments.forEach((segment, index) => {
      const source = sourceSegments.length === 1 ? "[0:a]" : `[audio_source_${index}]`;
      const duration = (segment.sourceEndMs - segment.sourceStartMs) / 1000;
      const fades = [
        segment.fadeInMs
          ? `afade=t=in:st=0:d=${seconds(segment.fadeInMs)}`
          : null,
        segment.fadeOutMs
          ? `afade=t=out:st=${Math.max(0, duration - segment.fadeOutMs / 1000).toFixed(6)}:` +
            `d=${seconds(segment.fadeOutMs)}`
          : null
      ].filter(Boolean).join(",");
      lines.push(
        `${source}atrim=start=${seconds(segment.sourceStartMs)}:end=${seconds(segment.sourceEndMs)},` +
        `asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,` +
        `volume=${db(segment.gainDb)}${fades ? `,${fades}` : ""}[source_audio_${index}]`
      );
    });
    if (sourceSegments.length === 1) {
      lines.push("[source_audio_0]anull[source_audio]");
    } else {
      lines.push(
        `${sourceSegments.map((_, index) => `[source_audio_${index}]`).join("")}` +
        `concat=n=${sourceSegments.length}:v=0:a=1[source_audio]`
      );
    }
    audible.push("[source_audio]");
  }
  if (decision?.bed) {
    const assetIndex = snapshot.resources.assets.findIndex(
      ({ identity }) => identity.id === decision.bed!.assetId
    );
    if (assetIndex >= 0) {
      lines.push(
        `[${assetIndex + 1}:a]atrim=start=0:end=${seconds(snapshot.output.durationMs)},` +
        "asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo," +
        `volume=${db(decision.bed.gainDb)}[bed_audio]`
      );
      audible.push("[bed_audio]");
    }
  }
  if (!audible.length) {
    lines.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(snapshot.output.durationMs)}[aout]`
    );
  } else if (audible.length === 1) {
    lines.push(`${audible[0]}atrim=duration=${seconds(snapshot.output.durationMs)}[aout]`);
  } else {
    lines.push(
      `${audible.join("")}amix=inputs=${audible.length}:duration=longest:normalize=0,` +
      `atrim=duration=${seconds(snapshot.output.durationMs)}[aout]`
    );
  }
}

function fitChain(
  source: string,
  width: number,
  height: number,
  fit: "fit" | "fill",
  crop: CropExpressions | null,
  duration: string
): string {
  const prefix = crop
    ? `${source}crop=w='iw*(${crop.width})':h='ih*(${crop.height})':` +
      `x='iw*(${crop.x})':y='ih*(${crop.y})',`
    : source;
  const scale = fit === "fill"
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
  return `${prefix}${scale},format=rgba,trim=duration=${duration},setpts=PTS-STARTPTS`;
}

type Crop = { atMs: number; x: number; y: number; width: number; height: number };
type CropExpressions = { x: string; y: string; width: string; height: string };

function cropExpressions(layer: Extract<Composition["layers"][number], { type: "video" }>): CropExpressions | null {
  const automatic = layer.automaticCropTrack.frames;
  if (!automatic.length && !layer.manualCropTrack.some((control) => control.mode === "crop")) {
    return null;
  }
  const times = [...new Set([
    0,
    ...automatic.map((frame) => frame.atMs),
    ...layer.manualCropTrack.map((control) => control.atMs)
  ])].sort((a, b) => a - b);
  return {
    x: effectiveExpression(automatic, layer.manualCropTrack, times, "x"),
    y: effectiveExpression(automatic, layer.manualCropTrack, times, "y"),
    width: effectiveExpression(automatic, layer.manualCropTrack, times, "width"),
    height: effectiveExpression(automatic, layer.manualCropTrack, times, "height")
  };
}

function latestManual(controls: ManualCropControl[], atMs: number): ManualCropControl | undefined {
  return [...controls].reverse().find((control) => control.atMs <= atMs);
}

function interpolateCrop(frames: Crop[], atMs: number): Omit<Crop, "atMs"> {
  if (!frames.length) return { x: 0, y: 0, width: 1, height: 1 };
  const rightIndex = frames.findIndex((frame) => frame.atMs >= atMs);
  if (rightIndex <= 0) {
    const frame = frames[Math.max(0, rightIndex)]!;
    return pickCrop(frame);
  }
  if (rightIndex < 0) return pickCrop(frames.at(-1)!);
  const left = frames[rightIndex - 1]!;
  const right = frames[rightIndex]!;
  const ratio = (atMs - left.atMs) / (right.atMs - left.atMs);
  return {
    x: left.x + (right.x - left.x) * ratio,
    y: left.y + (right.y - left.y) * ratio,
    width: left.width + (right.width - left.width) * ratio,
    height: left.height + (right.height - left.height) * ratio
  };
}

function pickCrop(crop: Crop): Omit<Crop, "atMs"> {
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function effectiveExpression(
  automatic: Crop[],
  manual: ManualCropControl[],
  times: number[],
  key: keyof Omit<Crop, "atMs">
): string {
  const valueAt = (atMs: number) => {
    const laterIndex = manual.findIndex((control) => control.atMs > atMs);
    const activeIndex = laterIndex < 0 ? manual.length - 1 : laterIndex - 1;
    const active = manual[activeIndex];
    if (active?.mode !== "crop") return interpolateCrop(automatic, atMs)[key];
    const next = manual[activeIndex + 1];
    if (next?.mode === "crop" && atMs < next.atMs) {
      const ratio = (atMs - active.atMs) / (next.atMs - active.atMs);
      return active[key] + (next[key] - active[key]) * ratio;
    }
    return active[key];
  };
  let expression = number(valueAt(times.at(-1)!));
  for (let index = times.length - 2; index >= 0; index--) {
    const startMs = times[index]!;
    const endMs = times[index + 1]!;
    const active = latestManual(manual, startMs);
    const nextManual = manual.find((control) => control.atMs > startMs);
    const shouldInterpolateManual = active?.mode === "crop" && nextManual?.mode === "crop";
    const shouldInterpolateAutomatic = active?.mode !== "crop";
    const left = valueAt(startMs);
    const right = shouldInterpolateManual || shouldInterpolateAutomatic
      ? valueAt(endMs)
      : left;
    const start = startMs / 1000;
    const span = Math.max(0.001, (endMs - startMs) / 1000);
    const value = left === right
      ? number(left)
      : `${number(left)}+(${number(right)}-${number(left)})*` +
        `(t-${number(start)})/${number(span)}`;
    expression = `if(lt(t\\,${number(endMs / 1000)})\\,${value}\\,${expression})`;
  }
  return expression;
}

function captionFilters(
  input: string,
  cues: CaptionCue[],
  style: RenderSnapshot["short"]["captions"]["style"],
  ranges: RenderSnapshot["sourceRanges"],
  fontDirectory: string
): string {
  let chain = input;
  const mapped = cues.flatMap((cue) => {
    const index = ranges.findIndex((range) => cue.startMs >= range.startMs && cue.endMs <= range.endMs);
    if (index < 0) return [];
    const offset = ranges.slice(0, index).reduce(
      (total, range) => total + range.endMs - range.startMs,
      0
    );
    const mapTime = (atMs: number) => offset + atMs - ranges[index]!.startMs;
    return [{ ...cue, startMs: mapTime(cue.startMs), endMs: mapTime(cue.endMs),
      words: cue.words.map((word) => ({
        ...word, startMs: mapTime(word.startMs), endMs: mapTime(word.endMs)
      })) }];
  });
  for (const cue of mapped) {
    chain += drawText(cue.text, cue.startMs, cue.endMs, style.textColor, style, fontDirectory, true);
    for (const word of cue.words) {
      chain += drawText(word.text, word.startMs, word.endMs, style.highlightColor, style, fontDirectory, false);
    }
  }
  return chain.endsWith(",") ? chain.slice(0, -1) : chain;
}

function drawText(
  text: string,
  startMs: number,
  endMs: number,
  color: string,
  style: RenderSnapshot["short"]["captions"]["style"],
  fontDirectory: string,
  box: boolean
): string {
  const font = `${fontDirectory}/${style.fontWeight === 700 ? "Inter-Bold.otf" : "Inter-Regular.otf"}`;
  return `drawtext=fontfile='${escapeFilter(font)}':text='${escapeText(text)}':` +
    `expansion=none:fontsize=${style.fontSizePx}:fontcolor=${ffColor(color)}:` +
    `borderw=${style.outline.widthPx}:bordercolor=${ffColor(style.outline.color)}:` +
    `x=w*${number(style.position.x)}-text_w/2:y=h*${number(style.position.y)}-text_h/2:` +
    `box=${box && style.background.color !== "#00000000" ? 1 : 0}:` +
    `boxcolor=${ffColor(style.background.color)}:boxborderw=${style.background.paddingPx}:` +
    `enable='between(t\\,${seconds(startMs)}\\,${seconds(endMs)})',`;
}

function pixelRegion(region: Composition["layers"][number]["region"], composition: Composition) {
  return {
    x: Math.round(region.x * composition.width),
    y: Math.round(region.y * composition.height),
    width: Math.round(region.width * composition.width),
    height: Math.round(region.height * composition.height)
  };
}

function escapeFilter(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function escapeText(value: string): string {
  return escapeFilter(value)
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function ffColor(value: string): string {
  if (/^#[0-9a-fA-F]{8}$/.test(value)) {
    return `0x${value.slice(1, 7)}@${number(parseInt(value.slice(7), 16) / 255)}`;
  }
  return `0x${value.slice(1)}`;
}

function db(value: number): string {
  return `${number(value)}dB`;
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(6);
}

function number(value: number): string {
  return Number(value.toFixed(6)).toString();
}
