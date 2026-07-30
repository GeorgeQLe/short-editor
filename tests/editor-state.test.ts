import { describe, expect, it } from "vitest";
import {
  contentFromShort,
  createHistory,
  cropControlsPastDuration,
  dirtySections,
  effectiveCrop,
  historyContent,
  mapOutputToSource,
  mergeCanonicalSave,
  pushHistory,
  redoHistory,
  undoHistory
} from "../src/ui/editor-state";
import type { ShortProject } from "../src/shared/domain";
import { starterTemplates } from "../src/shared/templates";
import { captionState } from "./factories";

function shortProject(): ShortProject {
  const now = "2026-07-30T00:00:00.000Z";
  const template = starterTemplates[1]!;
  return {
    id: "00000000-0000-4000-8000-000000000001",
    episodeId: "00000000-0000-4000-8000-000000000002",
    candidateId: "00000000-0000-4000-8000-000000000003",
    title: "Fixture Short",
    sourceRanges: [{ startMs: 0, endMs: 30_000 }],
    templateId: template.id,
    templateLineage: {
      templateId: template.id, templateVersion: template.version, parentTemplateId: null
    },
    composition: structuredClone(template.composition),
    captions: captionState(),
    audio: {
      sourceGainDb: 0, sourceMuted: false, cutFadeMs: 25,
      bedAssetId: null, bedGainDb: null, warnings: []
    },
    copy: {
      cleanedTranscript: "", rewrite: "", hookVariants: [], titles: [],
      description: "", hashtags: [], thumbnailText: ""
    },
    copyState: "accepted", copySource: "user_accepted",
    approved: false, revision: 1, createdAt: now, updatedAt: now
  };
}

describe("editor state", () => {
  it("maps one contiguous output playhead across Episode source ranges", () => {
    const ranges = [{ startMs: 10_000, endMs: 12_000 }, { startMs: 20_000, endMs: 23_000 }];
    expect(mapOutputToSource(ranges, 0)).toEqual({ sourceAtMs: 10_000, rangeIndex: 0 });
    expect(mapOutputToSource(ranges, 1_999)).toEqual({ sourceAtMs: 11_999, rangeIndex: 0 });
    expect(mapOutputToSource(ranges, 2_000)).toEqual({ sourceAtMs: 20_000, rangeIndex: 1 });
    expect(mapOutputToSource(ranges, 5_000)).toEqual({ sourceAtMs: 23_000, rangeIndex: 1 });
  });

  it("tracks cross-section history and leaves undo-after-save as a dirty draft", () => {
    const project = shortProject();
    const initial = contentFromShort(project);
    let history = createHistory(initial);
    const compositionDraft = structuredClone(initial);
    compositionDraft.composition.background = "#123456";
    history = pushHistory(history, compositionDraft);
    const audioDraft = structuredClone(compositionDraft);
    audioDraft.audio.sourceGainDb = -3;
    history = pushHistory(history, audioDraft);
    history = undoHistory(history);
    expect(historyContent(history).audio.sourceGainDb).toBe(initial.audio.sourceGainDb);
    history = redoHistory(history);
    expect(historyContent(history).audio.sourceGainDb).toBe(-3);

    const canonical = { ...project, composition: compositionDraft.composition, revision: 2 };
    const merged = mergeCanonicalSave(audioDraft, canonical, "composition", new Set([
      "composition", "audio"
    ]));
    expect(merged.draft.audio.sourceGainDb).toBe(-3);
    expect(dirtySections(merged.baseline, merged.draft)).toEqual(new Set(["audio"]));
    const savedHistory = pushHistory(history, merged.draft);
    const undone = historyContent(undoHistory(undoHistory(savedHistory)));
    expect(dirtySections(merged.baseline, undone).size).toBeGreaterThan(0);
  });

  it("interpolates automatic crops, honors manual precedence, and finds stale controls", () => {
    const project = shortProject();
    const layer = project.composition.layers.find((item) => item.type === "video");
    expect(layer?.type).toBe("video");
    if (layer?.type !== "video") return;
    layer.automaticCropTrack.frames = [
      { atMs: 0, x: 0, y: 0, width: 1, height: 1 },
      { atMs: 1_000, x: 0.2, y: 0.1, width: 0.5, height: 0.5 }
    ];
    expect(effectiveCrop(layer, 500)).toMatchObject({ x: 0.1, y: 0.05, width: 0.75 });
    layer.manualCropTrack = [{
      id: "00000000-0000-4000-8000-000000000099",
      mode: "crop", atMs: 400, x: 0.3, y: 0.2, width: 0.4, height: 0.4
    }];
    expect(effectiveCrop(layer, 500)).toMatchObject({ x: 0.3, y: 0.2 });
    expect(cropControlsPastDuration(project.composition, 399)).toEqual([{
      layerId: layer.id,
      controlId: "00000000-0000-4000-8000-000000000099",
      atMs: 400
    }]);
  });
});
