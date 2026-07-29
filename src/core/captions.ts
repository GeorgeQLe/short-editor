import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype, { type Font } from "opentype.js";
import type {
  CaptionCue,
  CaptionStyle,
  CaptionWarning,
  Composition,
  ShortProject
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";

export const CAPTION_ENGINE_VERSION = "captions-v1";
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: "Inter",
  fontWeight: 400,
  fontSizePx: 64,
  position: { x: 0.5, y: 0.78 },
  maxWidth: 0.82,
  textColor: "#ffffff",
  highlightColor: "#ffdc5e",
  textTransform: "none",
  outline: { color: "#000000", widthPx: 4 },
  background: { color: "#00000000", paddingPx: 12, cornerRadiusPx: 8 }
};

export interface CaptionLayout {
  cueId: string;
  lines: string[];
  lineWidths: number[];
  lineHeight: number;
  bounds: { left: number; top: number; right: number; bottom: number };
}

export class CaptionEngine {
  private readonly fonts = new Map<400 | 700, Font>();

  constructor(readonly fontDirectory = defaultFontDirectory()) {}

  analyze(
    cues: CaptionCue[],
    style: CaptionStyle,
    composition: Composition,
    sourceRanges: ShortProject["sourceRanges"],
    enabled = true
  ): { warnings: CaptionWarning[]; layouts: CaptionLayout[] } {
    if (!enabled) return { warnings: [], layouts: [] };
    const font = this.loadFont(style.fontWeight);
    const warnings: CaptionWarning[] = [];
    const layouts = cues.map((cue) => {
      if (cue.endMs - cue.startMs < 500) {
        warnings.push(warning("CAPTION_SHORT_CUE", cue.id, "Cue is shorter than 500 ms"));
      }
      if (!containingRange(cue, sourceRanges)) {
        warnings.push(warning(
          "CAPTION_OUTSIDE_SOURCE_RANGE",
          cue.id,
          "Cue is not wholly contained by a selected source range"
        ));
      }
      const transformedText = transformText(cue.text, style.textTransform);
      const missing = [...new Set(Array.from(normalizeLines(transformedText))
        .filter((character) => !/\s/u.test(character) && font.charToGlyph(character).index === 0))];
      if (missing.length) {
        warnings.push(warning(
          "CAPTION_MISSING_GLYPH",
          cue.id,
          `Packaged Inter font is missing: ${missing.join(" ")}`
        ));
      }
      const layout = layoutCue({ ...cue, text: transformedText }, style, composition, font);
      if (layout.lineWidths.some((width) => width > composition.width * style.maxWidth)
        || layout.bounds.left < 0
        || layout.bounds.right > composition.width
        || layout.bounds.top < 0
        || layout.bounds.bottom > composition.height) {
        warnings.push(warning(
          "CAPTION_OVERFLOW", cue.id, "Caption layout exceeds its width or canvas bounds"
        ));
      }
      const safe = composition.safeArea;
      if (
        layout.bounds.left < safe.left
        || layout.bounds.right > composition.width - safe.right
        || layout.bounds.top < safe.top
        || layout.bounds.bottom > composition.height - safe.bottom
      ) {
        warnings.push(warning(
          "CAPTION_SAFE_AREA", cue.id, "Caption layout crosses the composition safe area"
        ));
      }
      return layout;
    });
    const ordered = [...cues].sort((left, right) =>
      left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id)
    );
    let latestEnding = ordered[0];
    for (let index = 1; index < ordered.length; index++) {
      const cue = ordered[index]!;
      if (latestEnding && cue.startMs < latestEnding.endMs) {
        warnings.push(warning(
          "CAPTION_OVERLAP", cue.id, `Cue overlaps caption ${latestEnding.id}`
        ));
      }
      if (!latestEnding || cue.endMs > latestEnding.endMs) latestEnding = cue;
    }
    return { warnings: deduplicateWarnings(warnings), layouts };
  }

  private loadFont(weight: 400 | 700): Font {
    const cached = this.fonts.get(weight);
    if (cached) return cached;
    const path = join(this.fontDirectory, weight === 700 ? "Inter-Bold.otf" : "Inter-Regular.otf");
    if (!existsSync(path)) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        `Packaged Inter ${weight === 700 ? "Bold" : "Regular"} font is unavailable`,
        503
      );
    }
    try {
      const bytes = readFileSync(path);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const font = opentype.parse(buffer as ArrayBuffer);
      this.fonts.set(weight, font);
      return font;
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Packaged Inter font could not be parsed", 503);
    }
  }
}

export function generateCaptionSidecars(
  cues: CaptionCue[],
  sourceRanges: ShortProject["sourceRanges"],
  enabled: boolean
): { srt: Uint8Array; webvtt: Uint8Array } {
  const mapped = enabled
    ? cues.flatMap((cue) => {
      const range = containingRange(cue, sourceRanges);
      if (!range) return [];
      const offset = sourceRanges
        .slice(0, range.index)
        .reduce((total, sourceRange) =>
          total + sourceRange.endMs - sourceRange.startMs, 0);
      return [{
        ...cue,
        startMs: offset + cue.startMs - range.value.startMs,
        endMs: offset + cue.endMs - range.value.startMs,
        text: normalizeLines(cue.text)
      }];
    })
    : [];
  mapped.sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id)
  );
  const srtBody = mapped.map((cue, index) =>
    `${index + 1}\n${formatTimestamp(cue.startMs, ",")} --> ${formatTimestamp(cue.endMs, ",")}\n${cue.text}\n`
  ).join("\n");
  const webvttBody = mapped.map((cue) =>
    `${formatTimestamp(cue.startMs, ".")} --> ${formatTimestamp(cue.endMs, ".")}\n${escapeWebVtt(cue.text)}\n`
  ).join("\n");
  return {
    srt: Buffer.from(srtBody, "utf8"),
    webvtt: Buffer.from(`WEBVTT\n\n${webvttBody}`, "utf8")
  };
}

function layoutCue(
  cue: CaptionCue,
  style: CaptionStyle,
  composition: Composition,
  font: Font
): CaptionLayout {
  const maximumWidth = composition.width * style.maxWidth;
  const lines = normalizeLines(cue.text).split("\n").flatMap((explicitLine) =>
    wrapLine(explicitLine, maximumWidth, style.fontSizePx, font)
  );
  const lineWidths = lines.map((line) => measureText(font, line, style.fontSizePx));
  const unitsPerEm = font.unitsPerEm;
  const lineGap = font.tables.hhea?.lineGap ?? 0;
  const lineHeight = (font.ascender - font.descender + lineGap) / unitsPerEm * style.fontSizePx;
  const contentWidth = Math.max(0, ...lineWidths);
  const extra = style.background.paddingPx + style.outline.widthPx;
  const width = contentWidth + extra * 2;
  const height = lines.length * lineHeight + extra * 2;
  const centerX = composition.width * style.position.x;
  const centerY = composition.height * style.position.y;
  return {
    cueId: cue.id,
    lines,
    lineWidths,
    lineHeight,
    bounds: {
      left: centerX - width / 2,
      top: centerY - height / 2,
      right: centerX + width / 2,
      bottom: centerY + height / 2
    }
  };
}

const renderFonts = new Map<string, Font>();

function loadInterFont(fontDirectory: string, weight: 400 | 700): Font {
  const filename = weight === 700 ? "Inter-Bold.otf" : "Inter-Regular.otf";
  const requestedPath = join(fontDirectory, filename);
  const path = existsSync(requestedPath)
    ? requestedPath
    : join(defaultFontDirectory(), filename);
  const cached = renderFonts.get(path);
  if (cached) return cached;
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const font = opentype.parse(buffer as ArrayBuffer);
  renderFonts.set(path, font);
  return font;
}

export function layoutCaptionForRender(
  cue: CaptionCue,
  style: CaptionStyle,
  composition: Composition,
  fontDirectory: string
): CaptionLayout {
  const text = transformText(cue.text, style.textTransform);
  return layoutCue(
    { ...cue, text },
    style,
    composition,
    loadInterFont(fontDirectory, style.fontWeight)
  );
}

export function layoutInterTextLines(
  text: string,
  maximumWidth: number,
  fontSizePx: number,
  fontWeight: 400 | 700,
  fontDirectory: string,
  wrap: boolean
): { lines: string[]; widths: number[]; lineHeight: number } {
  const font = loadInterFont(fontDirectory, fontWeight);
  const lines = normalizeLines(text).split("\n").flatMap((line) =>
    wrap ? wrapLine(line, maximumWidth, fontSizePx, font) : [line]
  );
  const unitsPerEm = font.unitsPerEm;
  const lineGap = font.tables.hhea?.lineGap ?? 0;
  return {
    lines,
    widths: lines.map((line) => measureText(font, line, fontSizePx)),
    lineHeight: (font.ascender - font.descender + lineGap) / unitsPerEm * fontSizePx
  };
}

export function measureInterText(
  text: string,
  fontSizePx: number,
  fontWeight: 400 | 700,
  fontDirectory: string
): number {
  return measureText(loadInterFont(fontDirectory, fontWeight), text, fontSizePx);
}

function wrapLine(line: string, maximumWidth: number, fontSize: number, font: Font): string[] {
  if (line === "") return [""];
  const tokens = line.match(/\S+|\s+/gu) ?? [line];
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current + token;
    if (current && !/^\s+$/u.test(token) && measureText(font, candidate, fontSize) > maximumWidth) {
      lines.push(current.trimEnd());
      current = token.trimStart();
    } else {
      current = candidate;
    }
  }
  lines.push(current.trimEnd());
  return lines;
}

function measureText(font: Font, text: string, fontSize: number): number {
  const glyphs = Array.from(text, (character) => font.charToGlyph(character));
  let units = 0;
  glyphs.forEach((glyph, index) => {
    units += glyph.advanceWidth ?? font.unitsPerEm;
    const next = glyphs[index + 1];
    if (next) units += font.getKerningValue(glyph, next);
  });
  return units / font.unitsPerEm * fontSize;
}

function containingRange(
  cue: Pick<CaptionCue, "startMs" | "endMs">,
  ranges: ShortProject["sourceRanges"]
): { index: number; value: ShortProject["sourceRanges"][number] } | undefined {
  const index = ranges.findIndex((range) =>
    cue.startMs >= range.startMs && cue.endMs <= range.endMs
  );
  return index < 0 ? undefined : { index, value: ranges[index]! };
}

function formatTimestamp(milliseconds: number, separator: "," | "."): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1_000) % 60;
  const millis = milliseconds % 1_000;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":")
    + separator + String(millis).padStart(3, "0");
}

function normalizeLines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function transformText(text: string, transform: CaptionStyle["textTransform"]): string {
  return transform === "uppercase" ? text.toLocaleUpperCase() : text;
}

function escapeWebVtt(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function warning(
  code: CaptionWarning["code"],
  cueId: string,
  message: string
): CaptionWarning {
  return { code, cueId, message };
}

function deduplicateWarnings(warnings: CaptionWarning[]): CaptionWarning[] {
  const seen = new Set<string>();
  return warnings.filter((item) => {
    const identity = `${item.cueId}:${item.code}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function defaultFontDirectory(): string {
  const packaged = typeof process.resourcesPath === "string"
    ? join(process.resourcesPath, "fonts")
    : "";
  if (packaged && existsSync(packaged)) return packaged;
  return join(dirname(fileURLToPath(import.meta.url)), "../../resources/fonts");
}
