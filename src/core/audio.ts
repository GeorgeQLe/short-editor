import {
  audioDecisionSchema,
  type AudioDecision,
  type AudioState,
  type AudioWarning,
  type ShortProject
} from "../shared/domain.js";

export const AUDIO_ENGINE_VERSION = "audio-decisions-v1" as const;
export const MINIMUM_SPEECH_BACKGROUND_SEPARATION_DB = 12;

export interface BuildAudioDecisionInput {
  episodeId: string;
  sourceRanges: ShortProject["sourceRanges"];
  audio: AudioState;
  bedDurationMs: number | null;
}

export function deriveAudioWarnings(
  audio: Pick<AudioState, "sourceGainDb" | "sourceMuted" | "bedAssetId" | "bedGainDb">
): AudioWarning[] {
  if (audio.bedAssetId === null || audio.bedGainDb === null) return [];
  if (
    audio.sourceMuted
    || audio.sourceGainDb - audio.bedGainDb < MINIMUM_SPEECH_BACKGROUND_SEPARATION_DB
  ) {
    return [{
      code: "AUDIO_SPEECH_BACKGROUND_RATIO",
      message: audio.sourceMuted
        ? "Background audio is enabled while the Episode source is muted"
        : "Background audio is less than 12 dB below the Episode source"
    }];
  }
  return [];
}

export function buildAudioDecision(input: BuildAudioDecisionInput): AudioDecision {
  let outputOffsetMs = 0;
  const source = input.sourceRanges.map((range) => {
    const durationMs = range.endMs - range.startMs;
    const fadeMs = Math.min(input.audio.cutFadeMs, Math.floor(durationMs / 2));
    const decision = {
      source: "episode" as const,
      episodeId: input.episodeId,
      sourceStartMs: range.startMs,
      sourceEndMs: range.endMs,
      outputStartMs: outputOffsetMs,
      outputEndMs: outputOffsetMs + durationMs,
      gainDb: input.audio.sourceGainDb,
      muted: input.audio.sourceMuted,
      fadeInMs: fadeMs,
      fadeOutMs: fadeMs
    };
    outputOffsetMs += durationMs;
    return decision;
  });
  const outputDurationMs = outputOffsetMs;
  const warnings = deriveAudioWarnings(input.audio);
  const bed = input.audio.bedAssetId === null || input.audio.bedGainDb === null
    ? null
    : {
        assetId: input.audio.bedAssetId,
        gainDb: input.audio.bedGainDb,
        startsAtAssetTimeMs: 0 as const,
        loops: input.bedDurationMs !== null && input.bedDurationMs < outputDurationMs,
        playback: buildBedPlayback(outputDurationMs, input.bedDurationMs)
      };
  return audioDecisionSchema.parse({
    version: AUDIO_ENGINE_VERSION,
    outputDurationMs,
    source,
    bed,
    warnings
  });
}

function buildBedPlayback(outputDurationMs: number, bedDurationMs: number | null) {
  if (bedDurationMs === null || bedDurationMs <= 0) return [];
  const playback = [];
  for (let outputStartMs = 0; outputStartMs < outputDurationMs; outputStartMs += bedDurationMs) {
    const durationMs = Math.min(bedDurationMs, outputDurationMs - outputStartMs);
    playback.push({
      outputStartMs,
      outputEndMs: outputStartMs + durationMs,
      assetStartMs: 0,
      assetEndMs: durationMs
    });
  }
  return playback;
}
