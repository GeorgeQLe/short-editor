import type {
  AuthenticatedContext,
  DurableEvent,
  Entitlement,
  JobEnvelope,
  Project,
  UploadSession,
  Usage
} from "@siftcut/saas-contracts";

export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ProjectRepository {
  list(context: AuthenticatedContext): Promise<Project[]>;
  get(context: AuthenticatedContext, projectId: string): Promise<Project | null>;
  create(context: AuthenticatedContext, project: Project): Promise<Project>;
  update(
    context: AuthenticatedContext,
    projectId: string,
    expectedRevision: number,
    patch: Pick<Project, "name" | "updatedAt">
  ): Promise<Project>;
  delete(
    context: AuthenticatedContext,
    projectId: string,
    expectedRevision: number,
    deletionRequestedAt: string,
    purgeAfter: string
  ): Promise<Project>;
}

export interface UsageRepository {
  get(context: AuthenticatedContext): Promise<Usage>;
  reserveUpload(
    context: AuthenticatedContext,
    reservationId: string,
    bytes: number
  ): Promise<void>;
  releaseUpload(context: AuthenticatedContext, reservationId: string): Promise<void>;
}

export interface EntitlementRepository {
  get(context: AuthenticatedContext): Promise<Entitlement>;
}

export interface ArtifactStorage {
  createMultipartUpload(objectKey: string, checksumSha256: string): Promise<string>;
  signUploadPart(
    objectKey: string,
    multipartUploadId: string,
    partNumber: number,
    expiresInSeconds: number
  ): Promise<string>;
  completeMultipartUpload(
    objectKey: string,
    multipartUploadId: string,
    parts: ReadonlyArray<{ partNumber: number; etag: string; checksumSha256: string }>
  ): Promise<{ byteLength: number; checksumSha256: string }>;
  abortMultipartUpload(objectKey: string, multipartUploadId: string): Promise<void>;
  signRead(objectKey: string, expiresInSeconds: number): Promise<string>;
  promote(temporaryKey: string, finalKey: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface UploadRepository {
  create(
    context: AuthenticatedContext,
    session: StoredUploadSession
  ): Promise<StoredUploadSession>;
  get(context: AuthenticatedContext, uploadId: string): Promise<StoredUploadSession | null>;
  transition(
    context: AuthenticatedContext,
    uploadId: string,
    from: UploadSession["state"],
    to: UploadSession["state"]
  ): Promise<StoredUploadSession>;
  completeWithOutbox(
    context: AuthenticatedContext,
    uploadId: string,
    job: JobEnvelope,
    actual: { byteLength: number; checksumSha256: string }
  ): Promise<StoredUploadSession>;
}

export interface StoredUploadSession extends UploadSession {
  objectKey: string;
  multipartUploadId: string;
  checksumSha256: string;
}

export interface JobDispatcher {
  enqueue(job: JobEnvelope): Promise<void>;
}

export interface LeasedOutboxRecord {
  outboxId: string;
  envelope: JobEnvelope;
  attempt: number;
  claimToken: string;
}

export interface TransactionalOutbox {
  append(job: JobEnvelope): Promise<void>;
  claim(limit: number): Promise<LeasedOutboxRecord[]>;
  markDelivered(outboxId: string, claimToken: string): Promise<boolean>;
  markFailed(outboxId: string, claimToken: string, retryAt: Date): Promise<boolean>;
}

export interface ClassifiedJobFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobControl {
  claim(job: JobEnvelope): Promise<"claimed" | "already_complete" | "already_running">;
  assertOrganizationOwnsInputs(job: JobEnvelope): Promise<void>;
  cancellationRequested(jobId: string): Promise<boolean>;
  heartbeat(jobId: string, stage: string, progress: number): Promise<void>;
  succeed(jobId: string, output: Record<string, unknown>): Promise<void>;
  fail(jobId: string, failure: ClassifiedJobFailure): Promise<void>;
}

export interface EventRepository {
  after(context: AuthenticatedContext, lastEventId: number, limit: number): Promise<DurableEvent[]>;
  stream(
    context: AuthenticatedContext,
    afterEventId: number,
    signal: AbortSignal
  ): AsyncIterable<DurableEvent>;
  append(event: Omit<DurableEvent, "id">): Promise<DurableEvent>;
}

export interface CredentialProvider {
  getAnalysisCredential(provider: string): Promise<string>;
}

export * from "./postgres.js";
