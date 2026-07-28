import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptionEngine,
  DEFAULT_CAPTION_STYLE,
  generateCaptionSidecars
} from "../src/core/captions";
import type { CaptionCue, Composition } from "../src/shared/domain";
import { captionUpdateInputSchema } from "../src/shared/domain";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) =>
  rmSync(path, { recursive: true, force: true })
));

const composition: Composition = {
  width: 1080,
  height: 1920,
  background: "#000000",
  safeArea: { top: 120, right: 80, bottom: 180, left: 80 },
  layers: []
};
const cue = (overrides: Partial<CaptionCue> = {}): CaptionCue => ({
  id: randomUUID(),
  startMs: 1_000,
  endMs: 2_000,
  text: "Readable caption text.",
  words: [],
  ...overrides
});

describe("deterministic caption layout", () => {
  it("preserves explicit lines, wraps whitespace, and uses real Inter metrics", () => {
    const engine = new CaptionEngine();
    const explicit = cue({ text: "First line\nSecond line" });
    const result = engine.analyze(
      [explicit],
      { ...DEFAULT_CAPTION_STYLE, maxWidth: 0.4 },
      composition,
      [{ startMs: 0, endMs: 3_000 }]
    );
    expect(result.layouts[0]!.lines).toEqual(["First line", "Second line"]);
    expect(result.layouts[0]!.lineHeight).toBeGreaterThan(DEFAULT_CAPTION_STYLE.fontSizePx);

    const wrapped = engine.analyze(
      [cue({ text: "one two three four five six seven" })],
      { ...DEFAULT_CAPTION_STYLE, maxWidth: 0.1 },
      composition,
      [{ startMs: 0, endMs: 3_000 }]
    );
    expect(wrapped.layouts[0]!.lines.length).toBeGreaterThan(1);
    expect(wrapped.layouts[0]!.lines.join(" ")).toBe("one two three four five six seven");
  });

  it("warns for unbreakable overflow, safe-area crossings, and missing glyphs", () => {
    const engine = new CaptionEngine();
    const result = engine.analyze(
      [
        cue({ text: "unbreakableword".repeat(20) }),
        cue({
          startMs: 2_100,
          endMs: 3_100,
          text: `Missing ${String.fromCodePoint(0x10ffff)}`
        })
      ],
      {
        ...DEFAULT_CAPTION_STYLE,
        maxWidth: 0.1,
        position: { x: 0.02, y: 0.02 }
      },
      composition,
      [{ startMs: 0, endMs: 4_000 }]
    );
    expect(result.warnings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "CAPTION_OVERFLOW",
      "CAPTION_SAFE_AREA",
      "CAPTION_MISSING_GLYPH"
    ]));
  });

  it("warns below but not at 500 ms, preserves overlaps, and checks range containment", () => {
    const first = cue({ startMs: 1_000, endMs: 1_499 });
    const overlap = cue({ startMs: 1_400, endMs: 1_900 });
    const spanning = cue({ startMs: 1_000, endMs: 2_800 });
    const nestedAfterOverlap = cue({ startMs: 2_000, endMs: 2_500 });
    const outside = cue({ startMs: 2_900, endMs: 3_500 });
    const result = new CaptionEngine().analyze(
      [first, overlap, spanning, nestedAfterOverlap, outside],
      DEFAULT_CAPTION_STYLE,
      composition,
      [{ startMs: 1_000, endMs: 3_000 }]
    );
    expect(result.warnings.filter(({ code }) => code === "CAPTION_SHORT_CUE"))
      .toEqual([expect.objectContaining({ cueId: first.id })]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CAPTION_OVERLAP", cueId: overlap.id }),
      expect.objectContaining({ code: "CAPTION_OVERLAP", cueId: nestedAfterOverlap.id }),
      expect.objectContaining({ code: "CAPTION_OUTSIDE_SOURCE_RANGE", cueId: outside.id })
    ]));
  });

  it("fails when the selected packaged font dependency is absent", () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-missing-font-"));
    directories.push(directory);
    expect(() => new CaptionEngine(directory).analyze(
      [cue()],
      DEFAULT_CAPTION_STYLE,
      composition,
      [{ startMs: 0, endMs: 3_000 }]
    )).toThrow(/font is unavailable/i);
  });

  it("does not require a packaged font when captions are disabled", () => {
    const directory = mkdtempSync(join(tmpdir(), "short-editor-disabled-font-"));
    directories.push(directory);
    expect(new CaptionEngine(directory).analyze(
      [cue()],
      DEFAULT_CAPTION_STYLE,
      composition,
      [{ startMs: 0, endMs: 3_000 }],
      false
    )).toEqual({ warnings: [], layouts: [] });
  });
});

describe("caption mutation contracts", () => {
  it("rejects structural errors, unapproved fonts, and derived fields", () => {
    const valid = {
      expectedRevision: 1,
      enabled: true,
      cues: [cue()],
      style: DEFAULT_CAPTION_STYLE
    };
    expect(captionUpdateInputSchema.parse(valid)).toEqual(valid);
    const duplicate = cue();
    const invalidInputs = [
      { ...valid, cues: [{ ...cue(), text: "   " }] },
      { ...valid, cues: [{ ...cue(), startMs: 1.5 }] },
      { ...valid, cues: [{ ...cue(), startMs: 2_000, endMs: 1_000 }] },
      { ...valid, cues: [duplicate, { ...duplicate, text: "same ID" }] },
      {
        ...valid,
        cues: [{ ...cue(), words: [{ startMs: 0, endMs: 1_100, text: "bad" }] }]
      },
      { ...valid, style: { ...DEFAULT_CAPTION_STYLE, fontFamily: "Arial" } },
      { ...valid, style: { ...DEFAULT_CAPTION_STYLE, textColor: "white" } },
      { ...valid, style: { ...DEFAULT_CAPTION_STYLE, fontSizePx: 500 } },
      { ...valid, warnings: [] },
      { ...valid, sidecars: { srt: null, webvtt: null } }
    ];
    for (const input of invalidInputs) {
      expect(captionUpdateInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("caption sidecars", () => {
  it("remaps disjoint Episode ranges to contiguous output time and omits outside cues", () => {
    const first = cue({
      startMs: 1_000,
      endMs: 2_000,
      text: "Unicode café\r\nline two"
    });
    const second = cue({
      startMs: 5_500,
      endMs: 6_000,
      text: "Literal <tag> & text"
    });
    const outside = cue({ startMs: 3_000, endMs: 3_500, text: "omit" });
    const result = generateCaptionSidecars(
      [second, outside, first],
      [{ startMs: 1_000, endMs: 2_000 }, { startMs: 5_000, endMs: 7_000 }],
      true
    );
    const srt = Buffer.from(result.srt).toString("utf8");
    const webvtt = Buffer.from(result.webvtt).toString("utf8");
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nUnicode café\nline two\n\n"
      + "2\n00:00:01,500 --> 00:00:02,000\nLiteral <tag> & text\n"
    );
    expect(webvtt).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nUnicode café\nline two\n\n"
      + "00:00:01.500 --> 00:00:02.000\nLiteral &lt;tag&gt; &amp; text\n"
    );
    expect(srt.includes("\r")).toBe(false);
    expect(Buffer.from(result.srt).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
      .toBe(false);
    expect(srt).not.toContain("omit");
  });

  it("emits valid empty documents when captions are disabled", () => {
    const result = generateCaptionSidecars([cue()], [{ startMs: 0, endMs: 3_000 }], false);
    expect(Buffer.from(result.srt).toString("utf8")).toBe("");
    expect(Buffer.from(result.webvtt).toString("utf8")).toBe("WEBVTT\n\n");
  });
});
