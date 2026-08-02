import { describe, expect, it } from "vitest";
import type {
  ArtifactStorage,
  EntitlementRepository,
  ProjectRepository,
  StoredUploadSession,
  UploadRepository,
  UsageRepository
} from "../../packages/infrastructure/src/index.js";
import type {
  AuthenticatedContext,
  JobEnvelope,
  Project,
  UploadSession,
  Usage
} from "../../packages/saas-contracts/src/index.js";
import { ApiService } from "../../apps/api/src/service.js";
import { SaasError } from "../../apps/api/src/errors.js";

const OWNER: AuthenticatedContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  role: "owner",
  sessionId: "sess_owner"
};
const OTHER = { ...OWNER, organizationId: "00000000-0000-4000-8000-000000000099" };
const PROJECT: Project = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Episode",
  kind: "episode_to_shorts",
  origin: "siftcut_web",
  revision: 1,
  state: "active",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z"
};

function fixture() {
  const projectsByOrg = new Map<string, Project[]>([[OWNER.organizationId, [{ ...PROJECT }]]]);
  const uploadsByOrg = new Map<string, Map<string, StoredUploadSession>>();
  const reservations = new Map<string, number>();
  const outbox: JobEnvelope[] = [];
  const transitions: string[] = [];
  const projects: ProjectRepository = {
    async list(context) { return projectsByOrg.get(context.organizationId) ?? []; },
    async get(context, id) {
      return (projectsByOrg.get(context.organizationId) ?? []).find(
        (project) => project.id === id && project.state === "active"
      ) ?? null;
    },
    async create(context, project) {
      const current = projectsByOrg.get(context.organizationId) ?? [];
      projectsByOrg.set(context.organizationId, [...current, project]);
      return project;
    },
    async update(context, id, expectedRevision, patch) {
      const project = await this.get(context, id);
      if (!project) throw new SaasError("NOT_FOUND", "Project not found");
      if (project.revision !== expectedRevision) {
        throw new SaasError("REVISION_CONFLICT", "Project revision is stale", {
          expectedRevision, actualRevision: project.revision
        });
      }
      Object.assign(project, patch, { revision: project.revision + 1 });
      return project;
    },
    async delete(context, id, expectedRevision, deletionRequestedAt) {
      const project = await this.get(context, id);
      if (!project) throw new SaasError("NOT_FOUND", "Project not found");
      if (project.revision !== expectedRevision) {
        throw new SaasError("REVISION_CONFLICT", "Project revision is stale");
      }
      Object.assign(project, {
        revision: project.revision + 1,
        state: "deleting",
        updatedAt: deletionRequestedAt
      });
      return project;
    }
  };
  const uploads: UploadRepository = {
    async create(context, session) {
      const current = uploadsByOrg.get(context.organizationId) ?? new Map();
      current.set(session.id, session);
      uploadsByOrg.set(context.organizationId, current);
      return session;
    },
    async get(context, id) {
      return uploadsByOrg.get(context.organizationId)?.get(id) ?? null;
    },
    async transition(context, id, from, to) {
      const session = await this.get(context, id);
      if (!session || session.state !== from) throw new Error("Invalid transition");
      session.state = to;
      transitions.push(`${from}:${to}`);
      return session;
    },
    async completeWithOutbox(context, id, job) {
      const session = await this.get(context, id);
      if (!session || session.state !== "completing") throw new Error("Invalid completion");
      session.state = "complete";
      outbox.push(job);
      transitions.push("completing:complete+outbox");
      return session;
    }
  };
  const usage: UsageRepository = {
    async get(): Promise<Usage> {
      return {
        periodStartsAt: "2026-08-01T00:00:00.000Z",
        periodEndsAt: "2026-08-15T00:00:00.000Z",
        sourceMinutesUsed: 0,
        sourceMinutesReserved: 0,
        storageBytesUsed: 0,
        storageBytesReserved: [...reservations.values()].reduce((sum, value) => sum + value, 0)
      };
    },
    async reserveUpload(_context, id, bytes) { reservations.set(id, bytes); },
    async releaseUpload(_context, id) { reservations.delete(id); }
  };
  const entitlements: EntitlementRepository = {
    async get() {
      return {
        memberLimit: 5,
        sourceMinuteLimit: 120,
        storageByteLimit: 25 * 1024 ** 3,
        canCreateWork: true
      };
    }
  };
  const storage: ArtifactStorage = {
    async createMultipartUpload() { return "s3-upload-id"; },
    async signUploadPart(_key, _uploadId, partNumber) {
      return `https://uploads.invalid/part/${partNumber}`;
    },
    async completeMultipartUpload() {
      return { byteLength: 1024, checksumSha256: "a".repeat(64) };
    },
    async abortMultipartUpload() {},
    async signRead() { return "https://media.invalid/object"; },
    async promote() {},
    async deletePrefix() {}
  };
  return {
    service: new ApiService({
      projects, uploads, usage, entitlements, storage,
      now: () => new Date("2026-08-01T12:00:00.000Z")
    }),
    uploadsByOrg,
    reservations,
    outbox,
    transitions
  };
}

describe("multi-tenant API service", () => {
  it("does not reveal another organization's project UUID", async () => {
    const { service } = fixture();
    await expect(service.getProject(OTHER, PROJECT.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });

  it("denies viewer mutations", async () => {
    const { service } = fixture();
    expect(() => service.createProject({ ...OWNER, role: "viewer" }, {
      name: "Forbidden"
    })).toThrow(expect.objectContaining({ code: "FORBIDDEN_ROLE" }));
  });

  it("allows only owners to revision-check project deletion", async () => {
    const { service } = fixture();
    expect(() => service.deleteProject({ ...OWNER, role: "editor" }, PROJECT.id, {
      expectedRevision: 1
    })).toThrow(expect.objectContaining({ code: "FORBIDDEN_ROLE" }));
    await expect(service.deleteProject(OWNER, PROJECT.id, { expectedRevision: 1 }))
      .resolves.toMatchObject({ state: "deleting", revision: 2 });
    await expect(service.getProject(OWNER, PROJECT.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns structured optimistic revision conflicts", async () => {
    const { service } = fixture();
    await expect(service.updateProject(OWNER, PROJECT.id, {
      expectedRevision: 9,
      name: "Stale edit"
    })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 9, actualRevision: 1 }
    });
  });

  it("reserves quota, uses a tenant key, and atomically records ingest", async () => {
    const { service, uploadsByOrg, reservations, outbox, transitions } = fixture();
    const upload = await service.createUpload(OWNER, {
      projectId: PROJECT.id,
      displayName: "episode.mp4",
      expectedBytes: 20 * 1024 ** 3,
      checksumSha256: "a".repeat(64)
    });
    const storedUpload = uploadsByOrg.get(OWNER.organizationId)?.get(upload.id);
    expect(storedUpload?.objectKey).toMatch(
      new RegExp(`^orgs/${OWNER.organizationId}/projects/${PROJECT.id}/uploads/`)
    );
    expect(upload).not.toHaveProperty("objectKey");
    expect(upload).not.toHaveProperty("multipartUploadId");
    expect(upload).not.toHaveProperty("checksumSha256");
    expect(reservations.get(upload.id)).toBe(20 * 1024 ** 3);

    const completed = await service.completeUpload(OWNER, upload.id, {
      parts: [{
        partNumber: 1,
        etag: "etag",
        checksumSha256: `${"A".repeat(43)}=`
      }]
    });
    expect(completed.state).toBe("complete");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      schemaVersion: 1,
      organizationId: OWNER.organizationId,
      projectId: PROJECT.id,
      kind: "ingest"
    });
    expect(transitions).toEqual(["open:completing", "completing:complete+outbox"]);
  });

  it("releases reservations when multipart creation fails", async () => {
    const built = fixture();
    const dependencies = (built.service as unknown as {
      dependencies: { storage: ArtifactStorage }
    }).dependencies;
    dependencies.storage.createMultipartUpload = async () => { throw new Error("S3 unavailable"); };
    await expect(built.service.createUpload(OWNER, {
      projectId: PROJECT.id,
      displayName: "episode.mp4",
      expectedBytes: 1024,
      checksumSha256: "a".repeat(64)
    })).rejects.toThrow("S3 unavailable");
    expect(built.reservations.size).toBe(0);
  });
});
