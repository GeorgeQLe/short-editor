import { createHash, randomUUID } from "node:crypto";
import {
  createScreenletterRecordingInputSchema,
  publishScreenletterRecordingInputSchema,
  reportScreenletterAbuseInputSchema,
  rollbackScreenletterRecordingInputSchema,
  startScreenletterEditInputSchema,
  type AuthenticatedContext,
  type Project,
  type PublicScreenletterShare,
  type ScreenletterEditLaunch,
  type ScreenletterRecording
} from "@siftcut/saas-contracts";
import type {
  ArtifactStorage,
  ScreenletterRepository
} from "@siftcut/infrastructure";
import { requireRole } from "./auth.js";
import { SaasError } from "./errors.js";

export interface ScreenletterServiceOptions {
  now?: () => Date;
  editorBaseUrl: string;
  previewTtlSeconds?: number;
  abuseHashSalt?: string;
}

export class ScreenletterService {
  private readonly now: () => Date;
  private readonly previewTtlSeconds: number;

  constructor(
    private readonly recordings: ScreenletterRepository,
    private readonly storage: Pick<ArtifactStorage, "signRead">,
    private readonly options: ScreenletterServiceOptions
  ) {
    this.now = options.now ?? (() => new Date());
    this.previewTtlSeconds = options.previewTtlSeconds ?? 300;
  }

  listRecordings(context: AuthenticatedContext): Promise<ScreenletterRecording[]> {
    return this.recordings.list(context);
  }

  async getRecording(
    context: AuthenticatedContext,
    recordingId: string
  ): Promise<ScreenletterRecording> {
    const recording = await this.recordings.get(context, recordingId);
    if (!recording) throw new SaasError("NOT_FOUND", "Recording not found");
    return recording;
  }

  createRecording(
    context: AuthenticatedContext,
    raw: unknown
  ): Promise<ScreenletterRecording> {
    requireRole(context, ["owner", "editor"]);
    const input = createScreenletterRecordingInputSchema.parse(raw);
    const timestamp = this.now().toISOString();
    const projectId = randomUUID();
    const project: Project = {
      id: projectId,
      name: input.name,
      kind: "screenletter_recording",
      origin: "screenletter_ios",
      revision: 1,
      state: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const recording: ScreenletterRecording = {
      id: randomUUID(),
      projectId,
      ownerId: context.userId,
      name: input.name,
      mode: input.mode,
      state: "created",
      sourceAssetId: null,
      proxyAssetId: null,
      publishedAssetId: null,
      shareToken: randomUUID(),
      shareRevision: 1,
      failureCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    };
    return this.recordings.create(context, project, recording);
  }

  deleteRecording(
    context: AuthenticatedContext,
    recordingId: string
  ): Promise<ScreenletterRecording> {
    requireRole(context, ["owner", "editor"]);
    return this.recordings.delete(context, recordingId, this.now().toISOString());
  }

  retryRecording(
    context: AuthenticatedContext,
    recordingId: string
  ): Promise<ScreenletterRecording> {
    requireRole(context, ["owner", "editor"]);
    return this.recordings.retry(context, recordingId, this.now().toISOString());
  }

  async startEdit(
    context: AuthenticatedContext,
    recordingId: string,
    raw: unknown
  ): Promise<ScreenletterEditLaunch> {
    requireRole(context, ["owner", "editor"]);
    const input = startScreenletterEditInputSchema.parse(raw);
    const recording = await this.getRecording(context, recordingId);
    if (!recording.sourceAssetId || recording.state !== "ready") {
      throw new SaasError("OBJECT_UNAVAILABLE", "Recording source is not ready to edit");
    }
    const editorUrl = new URL(
      `/projects/${recording.projectId}/shorts/new`,
      this.options.editorBaseUrl
    );
    editorUrl.searchParams.set("source", recording.sourceAssetId);
    editorUrl.searchParams.set("candidateId", "null");
    editorUrl.searchParams.set("maxDurationMs", "180000");
    if (input.transcribe) editorUrl.searchParams.set("transcribe", "1");
    return {
      recordingId: recording.id,
      projectId: recording.projectId,
      sourceAssetId: recording.sourceAssetId,
      candidateId: null,
      transcribe: input.transcribe,
      maximumDurationMs: 180_000,
      editorUrl: editorUrl.toString()
    };
  }

  publish(
    context: AuthenticatedContext,
    recordingId: string,
    raw: unknown
  ): Promise<ScreenletterRecording> {
    requireRole(context, ["owner", "editor"]);
    const input = publishScreenletterRecordingInputSchema.parse(raw);
    return this.recordings.publish(
      context,
      recordingId,
      input.renderAssetId,
      input.expectedRevision,
      this.now().toISOString()
    );
  }

  rollback(
    context: AuthenticatedContext,
    recordingId: string,
    raw: unknown
  ): Promise<ScreenletterRecording> {
    requireRole(context, ["owner", "editor"]);
    const input = rollbackScreenletterRecordingInputSchema.parse(raw);
    return this.recordings.rollback(
      context,
      recordingId,
      input.expectedRevision,
      this.now().toISOString()
    );
  }

  async resolveShare(shareToken: string): Promise<PublicScreenletterShare> {
    const share = await this.recordings.resolvePublic(shareToken);
    if (!share) throw new SaasError("NOT_FOUND", "Shared recording not found");
    const previewUrl = await this.storage.signRead(share.objectKey, this.previewTtlSeconds);
    return {
      name: share.name,
      mode: share.mode,
      shareRevision: share.shareRevision,
      previewUrl,
      previewExpiresAt: new Date(
        this.now().getTime() + this.previewTtlSeconds * 1000
      ).toISOString(),
      createdAt: share.createdAt
    };
  }

  async reportAbuse(
    shareToken: string,
    raw: unknown,
    reporterFingerprint?: string
  ): Promise<void> {
    const input = reportScreenletterAbuseInputSchema.parse(raw);
    const reporterHash = reporterFingerprint && this.options.abuseHashSalt
      ? createHash("sha256")
        .update(`${this.options.abuseHashSalt}:${reporterFingerprint}`)
        .digest("hex")
      : null;
    const accepted = await this.recordings.reportAbuse(
      shareToken,
      input.category,
      input.details ?? null,
      reporterHash
    );
    if (!accepted) throw new SaasError("NOT_FOUND", "Shared recording not found");
  }
}
