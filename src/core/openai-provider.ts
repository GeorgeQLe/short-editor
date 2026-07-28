import { randomUUID } from "node:crypto";
import {
  OPENAI_ADAPTER_VERSION,
  OPENAI_ANALYSIS_PROMPT_VERSION,
  OPENAI_ANALYSIS_SCHEMA_VERSION,
  OPENAI_SPEECH_OPTIONS_VERSION,
  openAiAnalysisResultSchema,
  openAiBridgeEventSchema,
  openAiSpeechResultSchema,
  type OpenAiAnalysisOptions,
  type OpenAiAnalysisResult,
  type OpenAiBridgeEvent,
  type OpenAiBridgeRequest,
  type OpenAiSpeechOptions,
  type OpenAiSpeechResult
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";

export interface OpenAiAuthorizationContext {
  scopeType: "project" | "batch";
  scopeId: string;
  operationClass: "transcription" | "analysis";
}

export interface OpenAiProvider {
  speech(
    jobId: string,
    credentialHandle: string,
    inputPath: string,
    options: OpenAiSpeechOptions,
    authorization: OpenAiAuthorizationContext,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<OpenAiSpeechResult>;
  analyze(
    jobId: string,
    credentialHandle: string,
    inputPaths: string[],
    options: OpenAiAnalysisOptions,
    authorization: OpenAiAuthorizationContext,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<OpenAiAnalysisResult>;
  cancel(jobId: string): void | Promise<void>;
}

type Pending = {
  jobId: string;
  resolve: (value: OpenAiSpeechResult | OpenAiAnalysisResult) => void;
  reject: (error: AppError) => void;
  onProgress?: (progress: number, stage: string) => void;
};

export class ProcessOpenAiProvider implements OpenAiProvider {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly ipc: Pick<NodeJS.Process, "send" | "on"> = process
  ) {
    this.ipc.on("message", (message: unknown) => this.receive(message));
  }

  speech(
    jobId: string,
    credentialHandle: string,
    inputPath: string,
    options: OpenAiSpeechOptions,
    authorization: OpenAiAuthorizationContext,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<OpenAiSpeechResult> {
    return this.request({
      operation: "speech",
      requestId: randomUUID(),
      jobId,
      credentialHandle,
      inputPath,
      options,
      authorization
    }, onProgress).then((result) => {
      const parsed = openAiSpeechResultSchema.safeParse(result);
      if (!parsed.success || parsed.data.requestMetadata.returnedModelId !== options.modelId) {
        throw providerOutputInvalid("OpenAI returned invalid or mismatched speech output");
      }
      return parsed.data;
    });
  }

  analyze(
    jobId: string,
    credentialHandle: string,
    inputPaths: string[],
    options: OpenAiAnalysisOptions,
    authorization: OpenAiAuthorizationContext,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<OpenAiAnalysisResult> {
    return this.request({
      operation: "analysis",
      requestId: randomUUID(),
      jobId,
      credentialHandle,
      inputPaths,
      options,
      authorization
    }, onProgress).then((result) => {
      const parsed = openAiAnalysisResultSchema.safeParse(result);
      if (
        !parsed.success ||
        parsed.data.requestMetadata.returnedModelId !== options.modelId ||
        parsed.data.schemaVersion !== OPENAI_ANALYSIS_SCHEMA_VERSION
      ) {
        throw providerOutputInvalid("OpenAI returned invalid or mismatched analysis output");
      }
      return parsed.data;
    });
  }

  cancel(jobId: string): void {
    const entry = [...this.pending.entries()].find(([, value]) => value.jobId === jobId);
    if (!entry || !this.ipc.send) return;
    this.ipc.send({
      channel: "short-editor:openai",
      payload: { operation: "cancel", requestId: entry[0], jobId }
    });
  }

  private request(
    request: OpenAiBridgeRequest,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<OpenAiSpeechResult | OpenAiAnalysisResult> {
    if (!this.ipc.send) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "The Electron OpenAI bridge is unavailable",
        503
      );
    }
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        jobId: request.jobId,
        resolve,
        reject,
        ...(onProgress ? { onProgress } : {})
      });
      this.ipc.send!({ channel: "short-editor:openai", payload: request }, (error) => {
        if (!error) return;
        this.pending.delete(request.requestId);
        reject(new AppError("DEPENDENCY_UNAVAILABLE", "The Electron OpenAI bridge is unavailable", 503));
      });
    });
  }

  private receive(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const envelope = message as { channel?: unknown; payload?: unknown };
    if (envelope.channel !== "short-editor:openai") return;
    const parsed = openAiBridgeEventSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      const candidate = envelope.payload as { requestId?: unknown } | null;
      if (candidate && typeof candidate.requestId === "string") {
        const pending = this.pending.get(candidate.requestId);
        if (pending) {
          this.pending.delete(candidate.requestId);
          pending.reject(providerOutputInvalid("Electron returned malformed OpenAI output"));
        }
      }
      return;
    }
    const event: OpenAiBridgeEvent = parsed.data;
    const pending = this.pending.get(event.requestId);
    if (!pending) return;
    if (event.jobId !== pending.jobId) {
      this.pending.delete(event.requestId);
      pending.reject(providerOutputInvalid("Electron returned mismatched OpenAI job output"));
      return;
    }
    if (event.type === "progress") {
      pending.onProgress?.(event.progress, event.stage);
      return;
    }
    this.pending.delete(event.requestId);
    if (event.type === "error") {
      pending.reject(new AppError(event.code, event.message, undefined, undefined, event.retryable));
      return;
    }
    pending.resolve(event.result);
  }
}

export function openAiProvenance(
  modelId: string,
  createdAt: string,
  providerRequestId: string | null,
  operation: "speech" | "analysis"
) {
  return {
    provider: "openai",
    providerClass: "cloud" as const,
    modelId,
    providerVersion: OPENAI_ADAPTER_VERSION,
    optionsVersion: operation === "speech"
      ? OPENAI_SPEECH_OPTIONS_VERSION
      : `${OPENAI_ANALYSIS_PROMPT_VERSION}+${OPENAI_ANALYSIS_SCHEMA_VERSION}`,
    providerRequestId,
    requestedModelId: modelId,
    returnedModelId: modelId,
    adapterVersion: OPENAI_ADAPTER_VERSION,
    promptVersion: operation === "analysis" ? OPENAI_ANALYSIS_PROMPT_VERSION : null,
    schemaVersion: operation === "analysis" ? OPENAI_ANALYSIS_SCHEMA_VERSION : null,
    createdAt
  };
}

function providerOutputInvalid(message: string): AppError {
  return new AppError("PROVIDER_OUTPUT_INVALID", message, 422);
}
