import { createHash, randomUUID } from "node:crypto";
import {
  completeUploadInputSchema,
  createProjectInputSchema,
  createUploadInputSchema,
  deleteProjectInputSchema,
  updateProjectInputSchema,
  uploadPartsInputSchema,
  type AuthenticatedContext,
  type JobEnvelope,
  type Project,
  type UploadSession
} from "@siftcut/saas-contracts";
import type {
  ArtifactStorage,
  EntitlementRepository,
  ProjectRepository,
  StoredUploadSession,
  UploadRepository,
  UsageRepository
} from "@siftcut/infrastructure";
import { requireRole } from "./auth.js";
import { SaasError } from "./errors.js";

const PART_SIZE = 64 * 1024 ** 2;

export interface ApiDependencies {
  projects: ProjectRepository;
  uploads: UploadRepository;
  usage: UsageRepository;
  entitlements: EntitlementRepository;
  storage: ArtifactStorage;
  now?: () => Date;
}

export class ApiService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: ApiDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  listProjects(context: AuthenticatedContext): Promise<Project[]> {
    return this.dependencies.projects.list(context);
  }

  async getProject(context: AuthenticatedContext, projectId: string): Promise<Project> {
    const project = await this.dependencies.projects.get(context, projectId);
    if (!project) throw new SaasError("NOT_FOUND", "Project not found");
    return project;
  }

  createProject(context: AuthenticatedContext, raw: unknown): Promise<Project> {
    requireRole(context, ["owner", "editor"]);
    const input = createProjectInputSchema.parse(raw);
    const timestamp = this.now().toISOString();
    return this.dependencies.projects.create(context, {
      id: randomUUID(),
      name: input.name,
      kind: input.kind,
      origin: input.origin,
      revision: 1,
      state: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  updateProject(
    context: AuthenticatedContext,
    projectId: string,
    raw: unknown
  ): Promise<Project> {
    requireRole(context, ["owner", "editor"]);
    const input = updateProjectInputSchema.parse(raw);
    return this.dependencies.projects.update(context, projectId, input.expectedRevision, {
      name: input.name,
      updatedAt: this.now().toISOString()
    });
  }

  deleteProject(
    context: AuthenticatedContext,
    projectId: string,
    raw: unknown
  ): Promise<Project> {
    requireRole(context, ["owner"]);
    const input = deleteProjectInputSchema.parse(raw);
    const requestedAt = this.now();
    return this.dependencies.projects.delete(
      context,
      projectId,
      input.expectedRevision,
      requestedAt.toISOString(),
      new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
    );
  }

  async createUpload(context: AuthenticatedContext, raw: unknown): Promise<UploadSession> {
    requireRole(context, ["owner", "editor"]);
    const input = createUploadInputSchema.parse(raw);
    await this.getProject(context, input.projectId);
    const entitlement = await this.dependencies.entitlements.get(context);
    if (!entitlement.canCreateWork) {
      throw new SaasError(
        "SUBSCRIPTION_INACTIVE",
        "The organization is read-only until its subscription is active"
      );
    }
    const usage = await this.dependencies.usage.get(context);
    const storageLimit = usage.storageBytesUsed + usage.storageBytesReserved + input.expectedBytes;
    if (storageLimit > entitlement.storageByteLimit) {
      throw new SaasError("STORAGE_LIMIT", "The organization storage limit would be exceeded", {
        limitBytes: entitlement.storageByteLimit,
        usedBytes: usage.storageBytesUsed,
        reservedBytes: usage.storageBytesReserved,
        requestedBytes: input.expectedBytes
      });
    }

    const id = randomUUID();
    const objectKey = [
      "orgs", context.organizationId, "projects", input.projectId,
      "uploads", id, "source"
    ].join("/");
    await this.dependencies.usage.reserveUpload(context, id, input.expectedBytes);
    try {
      const multipartUploadId = await this.dependencies.storage.createMultipartUpload(
        objectKey,
        input.checksumSha256
      );
      const createdAt = this.now();
      const session: StoredUploadSession = {
        id,
        projectId: input.projectId,
        displayName: input.displayName,
        objectKey,
        multipartUploadId,
        expectedBytes: input.expectedBytes,
        checksumSha256: input.checksumSha256,
        partSizeBytes: PART_SIZE,
        state: "open",
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: createdAt.toISOString()
      };
      return publicUpload(await this.dependencies.uploads.create(context, session));
    } catch (error) {
      await this.dependencies.usage.releaseUpload(context, id);
      throw error;
    }
  }

  async signUploadParts(
    context: AuthenticatedContext,
    uploadId: string,
    raw: unknown
  ): Promise<Array<{ partNumber: number; url: string; expiresAt: string }>> {
    requireRole(context, ["owner", "editor"]);
    const input = uploadPartsInputSchema.parse(raw);
    const upload = await this.getOpenUpload(context, uploadId);
    const maximumPartNumber = Math.ceil(upload.expectedBytes / upload.partSizeBytes);
    if (input.partNumbers.some((partNumber) => partNumber > maximumPartNumber)) {
      throw new SaasError("VALIDATION_ERROR", "Requested part number exceeds upload size", {
        maximumPartNumber
      });
    }
    const expiresInSeconds = 15 * 60;
    const expiresAt = new Date(this.now().getTime() + expiresInSeconds * 1000).toISOString();
    return Promise.all(input.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await this.dependencies.storage.signUploadPart(
        upload.objectKey, upload.multipartUploadId, partNumber, expiresInSeconds
      ),
      expiresAt
    })));
  }

  async completeUpload(
    context: AuthenticatedContext,
    uploadId: string,
    raw: unknown
  ): Promise<UploadSession> {
    requireRole(context, ["owner", "editor"]);
    const input = completeUploadInputSchema.parse(raw);
    const upload = await this.getOpenUpload(context, uploadId);
    await this.dependencies.uploads.transition(context, uploadId, "open", "completing");
    const actual = await this.dependencies.storage.completeMultipartUpload(
      upload.objectKey,
      upload.multipartUploadId,
      [...input.parts].sort((left, right) => left.partNumber - right.partNumber)
    );
    if (actual.checksumSha256 !== upload.checksumSha256) {
      throw new SaasError("VALIDATION_ERROR", "Completed upload checksum does not match", {
        uploadId: upload.id
      });
    }
    const requestedAt = this.now().toISOString();
    const job: JobEnvelope = {
      schemaVersion: 1,
      jobId: randomUUID(),
      organizationId: context.organizationId,
      projectId: upload.projectId,
      kind: "ingest",
      inputHash: createHash("sha256")
        .update(`${upload.objectKey}:${upload.expectedBytes}`)
        .digest("hex"),
      payload: {
        uploadId: upload.id,
        objectKey: upload.objectKey,
        byteLength: actual.byteLength,
        checksumSha256: actual.checksumSha256
      },
      requestedAt
    };
    // The PostgreSQL adapter changes the session to complete and inserts this
    // outbox row in one transaction. A crash can never lose the ingest request.
    return publicUpload(
      await this.dependencies.uploads.completeWithOutbox(context, uploadId, job, actual)
    );
  }

  async abortUpload(context: AuthenticatedContext, uploadId: string): Promise<void> {
    requireRole(context, ["owner", "editor"]);
    const upload = await this.getOpenUpload(context, uploadId);
    await this.dependencies.storage.abortMultipartUpload(
      upload.objectKey, upload.multipartUploadId
    );
    await this.dependencies.uploads.transition(context, uploadId, "open", "aborted");
    await this.dependencies.usage.releaseUpload(context, uploadId);
  }

  private async getOpenUpload(
    context: AuthenticatedContext,
    uploadId: string
  ): Promise<StoredUploadSession> {
    const upload = await this.dependencies.uploads.get(context, uploadId);
    if (!upload) throw new SaasError("NOT_FOUND", "Upload session not found");
    if (new Date(upload.expiresAt).getTime() <= this.now().getTime()) {
      throw new SaasError("UPLOAD_EXPIRED", "Upload session has expired");
    }
    if (upload.state !== "open") {
      throw new SaasError("VALIDATION_ERROR", "Upload session is not open", {
        state: upload.state
      });
    }
    return upload;
  }
}

function publicUpload(upload: StoredUploadSession): UploadSession {
  return {
    id: upload.id,
    projectId: upload.projectId,
    displayName: upload.displayName,
    expectedBytes: upload.expectedBytes,
    partSizeBytes: upload.partSizeBytes,
    state: upload.state,
    expiresAt: upload.expiresAt,
    createdAt: upload.createdAt
  };
}
