import type { EpisodeStatus } from "./contracts.js";
import { AppError } from "./errors.js";

export const episodeTransitionMatrix = {
  discovered: ["indexing", "error", "source_missing"],
  indexing: ["analyzing", "error", "source_missing"],
  analyzing: ["ready", "error", "source_missing"],
  ready: ["analyzing", "source_missing"],
  error: ["indexing", "source_missing"],
  source_missing: ["indexing"]
} as const satisfies Record<EpisodeStatus, readonly EpisodeStatus[]>;

export const restorableEpisodeStatuses = ["discovered", "ready"] as const;
export type RelinkContext = { priorSafeState: typeof restorableEpisodeStatuses[number] };

export function assertEpisodeTransition(
  from: EpisodeStatus,
  to: EpisodeStatus,
  relinkContext?: RelinkContext
): EpisodeStatus {
  const ordinaryTargets = episodeTransitionMatrix[from] as readonly EpisodeStatus[];
  const restoresSafeState = from === "source_missing"
    && relinkContext?.priorSafeState === to
    && restorableEpisodeStatuses.includes(to as RelinkContext["priorSafeState"]);
  if (from === to || (!ordinaryTargets.includes(to) && !restoresSafeState)) {
    throw new AppError("INVALID_STATE", `Episode cannot transition from ${from} to ${to}`);
  }
  return to;
}
