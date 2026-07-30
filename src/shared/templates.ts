import type { Template } from "./domain.js";

const safeArea = { top: 120, right: 60, bottom: 260, left: 60 };
const builtInAt = "2026-07-27T00:00:00.000Z";

export const starterTemplates: Template[] = [
  {
    id: "split-subject-speaker-v1",
    name: "Subject + Speaker",
    version: 1,
    revision: 1,
    parentTemplateId: null,
    builtIn: true,
    createdAt: builtInAt,
    updatedAt: builtInAt,
    description: "Subject media on top with a tracked speaker below.",
    composition: {
      width: 1080, height: 1920, background: "#090b10", safeArea,
      layers: [
        { id: "subject", visible: true, type: "image", source: "asset", assetId: null, region: { x: 0, y: 0, width: 1, height: 0.5 }, fit: "fill" },
        { id: "speaker", visible: true, type: "video", source: "episode", assetId: null, region: { x: 0, y: 0.5, width: 1, height: 0.5 }, fit: "fill", cropTarget: "person", automaticCropTrack: { frames: [], provenance: null, fallback: { mode: "fill", reason: "missing_samples" } }, manualCropTrack: [] },
        { id: "captions", visible: true, type: "captions", source: "none", assetId: null, region: { x: 0.08, y: 0.72, width: 0.84, height: 0.17 }, fit: "fit" }
      ]
    }
  },
  {
    id: "fullscreen-speaker-v1",
    name: "Tracked Speaker",
    version: 1,
    revision: 1,
    parentTemplateId: null,
    builtIn: true,
    createdAt: builtInAt,
    updatedAt: builtInAt,
    description: "Full-screen tracked speaker with highlighted captions.",
    composition: {
      width: 1080, height: 1920, background: "#000000", safeArea,
      layers: [
        { id: "speaker", visible: true, type: "video", source: "episode", assetId: null, region: { x: 0, y: 0, width: 1, height: 1 }, fit: "fill", cropTarget: "person", automaticCropTrack: { frames: [], provenance: null, fallback: { mode: "fill", reason: "missing_samples" } }, manualCropTrack: [] },
        { id: "captions", visible: true, type: "captions", source: "none", assetId: null, region: { x: 0.08, y: 0.7, width: 0.84, height: 0.18 }, fit: "fit" }
      ]
    }
  },
  {
    id: "screen-speaker-v1",
    name: "Screen + Speaker",
    version: 1,
    revision: 1,
    parentTemplateId: null,
    builtIn: true,
    createdAt: builtInAt,
    updatedAt: builtInAt,
    description: "Two independent crops from one source: screen above, speaker below.",
    composition: {
      width: 1080, height: 1920, background: "#090b10", safeArea,
      layers: [
        { id: "screen", visible: true, type: "video", source: "episode", assetId: null, region: { x: 0, y: 0, width: 1, height: 0.58 }, fit: "fill", cropTarget: "screen", automaticCropTrack: { frames: [], provenance: null, fallback: { mode: "fill", reason: "missing_samples" } }, manualCropTrack: [] },
        { id: "speaker", visible: true, type: "video", source: "episode", assetId: null, region: { x: 0, y: 0.58, width: 1, height: 0.42 }, fit: "fill", cropTarget: "person", automaticCropTrack: { frames: [], provenance: null, fallback: { mode: "fill", reason: "missing_samples" } }, manualCropTrack: [] },
        { id: "captions", visible: true, type: "captions", source: "none", assetId: null, region: { x: 0.06, y: 0.77, width: 0.88, height: 0.14 }, fit: "fit" }
      ]
    }
  },
  {
    id: "news-brief-speaker-v1",
    name: "News Brief + Speaker",
    version: 1,
    revision: 1,
    parentTemplateId: null,
    builtIn: true,
    createdAt: builtInAt,
    updatedAt: builtInAt,
    description: "Related media above a tracked speaker with a topic, logo, and split-centered captions.",
    composition: {
      width: 1080,
      height: 1920,
      background: "#090b10",
      safeArea,
      captionStylePreset: {
        fontFamily: "Inter",
        fontWeight: 700,
        fontSizePx: 72,
        position: { x: 0.5, y: 0.5 },
        maxWidth: 0.88,
        textColor: "#ffffff",
        highlightColor: "#49c7f2",
        textTransform: "uppercase",
        outline: { color: "#111111", widthPx: 6 },
        background: { color: "#00000000", paddingPx: 12, cornerRadiusPx: 8 }
      },
      layers: [
        {
          id: "related-media",
          visible: true,
          type: "media",
          source: "asset",
          assetId: null,
          region: { x: 0, y: 0, width: 1, height: 0.52 },
          fit: "fill"
        },
        {
          id: "speaker",
          visible: true,
          type: "video",
          source: "episode",
          assetId: null,
          region: { x: 0, y: 0.52, width: 1, height: 0.48 },
          fit: "fill",
          cropTarget: "person",
          automaticCropTrack: {
            frames: [],
            provenance: null,
            fallback: { mode: "fill", reason: "missing_samples" }
          },
          manualCropTrack: []
        },
        {
          id: "topic",
          visible: true,
          type: "text",
          source: "none",
          assetId: null,
          content: { binding: "short_title" },
          region: { x: 0.056, y: 0.063, width: 0.66, height: 0.13 },
          fit: "fit",
          style: {
            fontFamily: "Inter",
            fontWeight: 700,
            fontSizePx: 54,
            color: "#ffffff",
            backgroundColor: "#00000099",
            backgroundPaddingPx: 14,
            align: "left",
            verticalAlign: "top",
            wrap: true,
            maxLines: 2,
            overflow: "ellipsis",
            textTransform: "uppercase"
          }
        },
        {
          id: "logo",
          visible: true,
          type: "logo",
          source: "asset",
          assetId: null,
          region: { x: 0.784, y: 0.063, width: 0.16, height: 0.1 },
          fit: "fit"
        },
        {
          id: "captions",
          visible: true,
          type: "captions",
          source: "none",
          assetId: null,
          region: { x: 0.06, y: 0.42, width: 0.88, height: 0.16 },
          fit: "fit"
        }
      ]
    }
  }
];

export function templateById(id: string): Template | undefined {
  return starterTemplates.find((template) => template.id === id);
}
