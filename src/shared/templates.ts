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
        { id: "subject", type: "image", source: "asset", region: { x: 0, y: 0, width: 1, height: 0.5 }, fit: "fill", cropTrack: [] },
        { id: "speaker", type: "video", source: "episode", region: { x: 0, y: 0.5, width: 1, height: 0.5 }, fit: "fill", cropTrack: [] },
        { id: "captions", type: "captions", source: "none", region: { x: 0.08, y: 0.72, width: 0.84, height: 0.17 }, fit: "fit", cropTrack: [] }
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
        { id: "speaker", type: "video", source: "episode", region: { x: 0, y: 0, width: 1, height: 1 }, fit: "fill", cropTrack: [] },
        { id: "captions", type: "captions", source: "none", region: { x: 0.08, y: 0.7, width: 0.84, height: 0.18 }, fit: "fit", cropTrack: [] }
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
        { id: "screen", type: "video", source: "episode", region: { x: 0, y: 0, width: 1, height: 0.58 }, fit: "fill", cropTrack: [] },
        { id: "speaker", type: "video", source: "episode", region: { x: 0, y: 0.58, width: 1, height: 0.42 }, fit: "fill", cropTrack: [] },
        { id: "captions", type: "captions", source: "none", region: { x: 0.06, y: 0.77, width: 0.88, height: 0.14 }, fit: "fit", cropTrack: [] }
      ]
    }
  }
];

export function templateById(id: string): Template | undefined {
  return starterTemplates.find((template) => template.id === id);
}
