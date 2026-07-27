import { z } from "zod";
import { providerProvenanceSchema } from "./contracts.js";
import { idSchema } from "./validators.js";

export const PYTHON_WORKER_PROTOCOL_VERSION = "v1" as const;
export const DEFAULT_WORKER_MAX_FRAME_BYTES = 8 * 1024 * 1024;

const protocolBase = <T extends string>(type: T) => ({
  protocolVersion: z.literal(PYTHON_WORKER_PROTOCOL_VERSION),
  type: z.literal(type)
});

export const workerOperationKinds = [
  "transcription",
  "diarization",
  "visual_sampling",
  "provider_call"
] as const;
export const workerOperationKindSchema = z.enum(workerOperationKinds);
export type WorkerOperationKind = z.infer<typeof workerOperationKindSchema>;

export const workerDependencySchema = z.strictObject({
  id: z.string().min(1),
  state: z.enum(["available", "missing", "downloading", "error"]),
  version: z.string().min(1).nullable(),
  detail: z.string().min(1).nullable()
});

export const workerCapabilitySchema = z.strictObject({
  operation: workerOperationKindSchema,
  available: z.boolean(),
  providers: z.array(z.string().min(1)),
  features: z.array(z.string().min(1))
});

export const workerRuntimeStatusSchema = z.strictObject({
  state: z.enum(["ready", "degraded", "unavailable"]),
  activeJobIds: z.array(idSchema),
  dependencies: z.array(workerDependencySchema)
});

const sourceInput = {
  sourcePath: z.string().min(1),
  modelId: z.string().min(1)
};
const providerInput = {
  provider: z.string().min(1),
  modelId: z.string().min(1),
  credentialHandle: z.string().min(1).nullable()
};

export const transcriptionWorkerJobSchema = z.strictObject({
  kind: z.literal("transcription"),
  ...sourceInput,
  language: z.literal("en"),
  wordTimestamps: z.boolean()
});
export const diarizationWorkerJobSchema = z.strictObject({
  kind: z.literal("diarization"),
  ...sourceInput,
  minimumSpeakers: z.number().int().positive().nullable(),
  maximumSpeakers: z.number().int().positive().nullable()
}).refine(
  (value) => value.minimumSpeakers === null || value.maximumSpeakers === null ||
    value.minimumSpeakers <= value.maximumSpeakers,
  { message: "minimumSpeakers cannot exceed maximumSpeakers" }
);
export const visualSamplingWorkerJobSchema = z.strictObject({
  kind: z.literal("visual_sampling"),
  sourcePath: z.string().min(1),
  intervalMs: z.number().int().positive(),
  maximumSamples: z.number().int().positive().max(10_000)
});
export const providerCallWorkerJobSchema = z.strictObject({
  kind: z.literal("provider_call"),
  ...providerInput,
  operation: z.enum(["analysis", "candidates", "copy"]),
  inputArtifactPaths: z.array(z.string().min(1)),
  schemaVersion: z.string().min(1),
  options: z.record(z.string(), z.json())
}).superRefine((value, context) => {
  const visit = (candidate: unknown, path: PropertyKey[] = []): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((child, index) => visit(child, [...path, index]));
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      if (/(api[-_]?key|token|secret|password|authorization|credential)/i.test(key)) {
        context.addIssue({
          code: "custom",
          message: "Provider options must reference credentials only by credentialHandle",
          path: ["options", ...path, key]
        });
      }
      visit(child, [...path, key]);
    }
  };
  visit(value.options);
});
export const pythonWorkerJobSchema = z.discriminatedUnion("kind", [
  transcriptionWorkerJobSchema,
  diarizationWorkerJobSchema,
  visualSamplingWorkerJobSchema,
  providerCallWorkerJobSchema
]);
export type PythonWorkerJob = z.infer<typeof pythonWorkerJobSchema>;

export const workerHelloCommandSchema = z.strictObject({
  ...protocolBase("hello"),
  requestId: idSchema,
  coreVersion: z.string().min(1)
});
export const workerCapabilitiesCommandSchema = z.strictObject({
  ...protocolBase("capabilities.get"),
  requestId: idSchema
});
export const workerStatusCommandSchema = z.strictObject({
  ...protocolBase("status.get"),
  requestId: idSchema
});
export const workerStartJobCommandSchema = z.strictObject({
  ...protocolBase("job.start"),
  requestId: idSchema,
  jobId: idSchema,
  job: pythonWorkerJobSchema
});
export const workerCancelJobCommandSchema = z.strictObject({
  ...protocolBase("job.cancel"),
  requestId: idSchema,
  jobId: idSchema
});
export const workerShutdownCommandSchema = z.strictObject({
  ...protocolBase("shutdown"),
  requestId: idSchema
});
export const pythonWorkerCommandSchema = z.discriminatedUnion("type", [
  workerHelloCommandSchema,
  workerCapabilitiesCommandSchema,
  workerStatusCommandSchema,
  workerStartJobCommandSchema,
  workerCancelJobCommandSchema,
  workerShutdownCommandSchema
]);
export type PythonWorkerCommand = z.infer<typeof pythonWorkerCommandSchema>;

const timedTextSchema = z.strictObject({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
  confidence: z.number().min(0).max(1).nullable()
}).refine((value) => value.endMs > value.startMs, { message: "endMs must follow startMs" });

export const transcriptionWorkerResultSchema = z.strictObject({
  kind: z.literal("transcription"),
  language: z.literal("en"),
  segments: z.array(timedTextSchema),
  words: z.array(timedTextSchema).nullable(),
  diarization: z.literal("absent"),
  provenance: providerProvenanceSchema
});
export const diarizationWorkerResultSchema = z.strictObject({
  kind: z.literal("diarization"),
  turns: z.array(z.strictObject({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    speaker: z.string().min(1),
    confidence: z.number().min(0).max(1).nullable()
  })),
  provenance: providerProvenanceSchema
});
export const visualSamplingWorkerResultSchema = z.strictObject({
  kind: z.literal("visual_sampling"),
  samples: z.array(z.strictObject({
    atMs: z.number().int().nonnegative(),
    activity: z.number().min(0).max(1),
    speakerFraming: z.number().min(0).max(1).nullable()
  })),
  provenance: providerProvenanceSchema
});
export const providerCallWorkerResultSchema = z.strictObject({
  kind: z.literal("provider_call"),
  schemaVersion: z.string().min(1),
  output: z.json(),
  provenance: providerProvenanceSchema
});
export const pythonWorkerResultDataSchema = z.discriminatedUnion("kind", [
  transcriptionWorkerResultSchema,
  diarizationWorkerResultSchema,
  visualSamplingWorkerResultSchema,
  providerCallWorkerResultSchema
]);
export type PythonWorkerResultData = z.infer<typeof pythonWorkerResultDataSchema>;

export const workerReadyEventSchema = z.strictObject({
  ...protocolBase("ready"),
  requestId: idSchema,
  workerVersion: z.string().min(1),
  capabilities: z.array(workerCapabilitySchema),
  status: workerRuntimeStatusSchema
});
export const workerCapabilitiesEventSchema = z.strictObject({
  ...protocolBase("capabilities"),
  requestId: idSchema,
  capabilities: z.array(workerCapabilitySchema)
});
export const workerStatusEventSchema = z.strictObject({
  ...protocolBase("status"),
  requestId: idSchema,
  status: workerRuntimeStatusSchema
});
export const workerHeartbeatEventSchema = z.strictObject({
  ...protocolBase("heartbeat"),
  sequence: z.number().int().nonnegative(),
  sentAt: z.string().datetime({ offset: true })
});
export const workerProgressEventSchema = z.strictObject({
  ...protocolBase("job.progress"),
  jobId: idSchema,
  progress: z.number().min(0).max(1),
  stage: z.string().min(1)
});
export const workerResultEventSchema = z.strictObject({
  ...protocolBase("job.result"),
  jobId: idSchema,
  result: pythonWorkerResultDataSchema
});
export const workerCancelledEventSchema = z.strictObject({
  ...protocolBase("job.cancelled"),
  jobId: idSchema
});
export const workerErrorEventSchema = z.strictObject({
  ...protocolBase("error"),
  requestId: idSchema.nullable(),
  jobId: idSchema.nullable(),
  code: z.enum([
    "DEPENDENCY_UNAVAILABLE",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_OUTPUT_INVALID",
    "JOB_CANCELLED",
    "INTERNAL_ERROR"
  ]),
  message: z.string().min(1),
  retryable: z.boolean()
});
export const workerShutdownEventSchema = z.strictObject({
  ...protocolBase("shutdown.complete"),
  requestId: idSchema
});
export const pythonWorkerEventSchema = z.discriminatedUnion("type", [
  workerReadyEventSchema,
  workerCapabilitiesEventSchema,
  workerStatusEventSchema,
  workerHeartbeatEventSchema,
  workerProgressEventSchema,
  workerResultEventSchema,
  workerCancelledEventSchema,
  workerErrorEventSchema,
  workerShutdownEventSchema
]);
export type PythonWorkerEvent = z.infer<typeof pythonWorkerEventSchema>;

export function encodeWorkerFrame(message: PythonWorkerCommand | PythonWorkerEvent): Buffer {
  return Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
}
