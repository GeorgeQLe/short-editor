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

export interface TransactionalOutbox {
  append(job: JobEnvelope): Promise<void>;
  claim(limit: number): Promise<JobEnvelope[]>;
  markDelivered(jobId: string): Promise<void>;
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
