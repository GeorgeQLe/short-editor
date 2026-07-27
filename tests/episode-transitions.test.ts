import { describe, expect, it } from "vitest";
import {
  assertEpisodeTransition,
  episodeStatuses,
  episodeTransitionMatrix,
  restorableEpisodeStatuses,
  type EpisodeStatus
} from "../src/shared/domain";
import { AppError } from "../src/shared/errors";

describe("Episode transition policy", () => {
  it("accepts every listed edge and rejects every other status pair", () => {
    for (const from of episodeStatuses) {
      for (const to of episodeStatuses) {
        const allowed = (episodeTransitionMatrix[from] as readonly EpisodeStatus[]).includes(to);
        if (allowed) {
          expect(assertEpisodeTransition(from, to)).toBe(to);
        } else {
          expect(() => assertEpisodeTransition(from, to)).toThrowError(
            expect.objectContaining({ code: "INVALID_STATE", status: 409 })
          );
        }
      }
    }
  });

  it.each(restorableEpisodeStatuses)("restores exact prior safe state %s after relink", (priorSafeState) => {
    expect(assertEpisodeTransition("source_missing", priorSafeState, { priorSafeState })).toBe(priorSafeState);
    const mismatch = priorSafeState === "ready" ? "discovered" : "ready";
    expect(() => assertEpisodeTransition("source_missing", mismatch, { priorSafeState })).toThrow(AppError);
  });

  it("never uses relink context outside source_missing", () => {
    expect(() => assertEpisodeTransition("error", "ready", { priorSafeState: "ready" })).toThrow(AppError);
  });
});
