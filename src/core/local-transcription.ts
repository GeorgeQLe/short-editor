import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  timedSegmentsSchema,
  transcriptionWorkerResultSchema,
  type TranscriptSegment
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import type { PythonWorkerSupervisor } from "./python-worker-supervisor.js";

export const localTranscriptionOptionsSchema = z.strictObject({
  modelId: z.string().min(1).regex(
    /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/,
    "modelId must be a provider model identifier, not a filesystem path"
  ).default("small.en"),
  wordTimestamps: z.boolean().default(true)
});
export type LocalTranscriptionOptions = z.infer<typeof localTranscriptionOptionsSchema>;

export class LocalTranscriptionProvider {
  constructor(private readonly worker: PythonWorkerSupervisor) {}

  async status(): Promise<{
    available: boolean;
    models: Array<{ modelId: string; installed: boolean }>;
    features: string[];
  }> {
    const [capabilities, status] = await Promise.all([
      this.worker.capabilities(),
      this.worker.status()
    ]);
    const transcription = capabilities.find((item) => item.operation === "transcription");
    return {
      available: transcription?.available ?? false,
      features: transcription?.features ?? [],
      models: status.dependencies.flatMap((dependency) => {
        const prefix = "faster-whisper:model:";
        return dependency.id.startsWith(prefix)
          ? [{ modelId: dependency.id.slice(prefix.length), installed: dependency.state === "available" }]
          : [];
      })
    };
  }

  async transcribe(
    jobId: string,
    sourcePath: string,
    options: LocalTranscriptionOptions,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<{
    language: "en";
    segments: TranscriptSegment[];
    provenance: z.infer<typeof transcriptionWorkerResultSchema>["provenance"];
  }> {
    const configured = localTranscriptionOptionsSchema.parse(options);
    const raw = await this.worker.runJob(jobId, {
      kind: "transcription",
      sourcePath,
      modelId: configured.modelId,
      language: "en",
      wordTimestamps: configured.wordTimestamps
    }, onProgress);
    const result = transcriptionWorkerResultSchema.parse(raw);
    if (!result.segments.length) {
      throw new AppError(
        "PROVIDER_OUTPUT_INVALID",
        "No English speech was detected in the selected source",
        422
      );
    }
    const words = result.words ?? [];
    const segments = result.segments.map((segment): TranscriptSegment => ({
      id: randomUUID(),
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text.trim(),
      words: words
        .filter((word) => word.startMs >= segment.startMs && word.endMs <= segment.endMs)
        .map((word) => ({
          startMs: word.startMs,
          endMs: word.endMs,
          text: word.text.trim(),
          ...(word.confidence === null ? {} : { confidence: word.confidence })
        })),
      speaker: null,
      confidence: segment.confidence
    }));
    return {
      language: result.language,
      segments: timedSegmentsSchema.parse(segments),
      provenance: result.provenance
    };
  }
}
