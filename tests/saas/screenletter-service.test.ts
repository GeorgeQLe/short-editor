import { describe, expect, it, vi } from "vitest";
import type {
  ScreenletterRepository,
  StoredScreenletterShare
} from "../../packages/infrastructure/src/index.js";
import type {
  AuthenticatedContext,
  Project,
  ScreenletterRecording
} from "../../packages/saas-contracts/src/index.js";
import { SaasError } from "../../apps/api/src/errors.js";
import { ScreenletterService } from "../../apps/api/src/screenletter-service.js";

const OWNER: AuthenticatedContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  role: "owner",
  sessionId: "screenletter"
};
const OTHER = {
  ...OWNER,
  organizationId: "00000000-0000-4000-8000-000000000099"
};

function fixture() {
  const records = new Map<string, {
    organizationId: string;
    recording: ScreenletterRecording;
    project: Project;
    objectKey?: string;
  }>();
  const reports: Array<{ token: string; category: string; reporterHash: string | null }> = [];
  const repository: ScreenletterRepository = {
    async list(context) {
      return [...records.values()]
        .filter((item) => item.organizationId === context.organizationId)
        .map((item) => item.recording);
    },
    async get(context, id) {
      const item = records.get(id);
      return item?.organizationId === context.organizationId ? item.recording : null;
    },
    async create(context, project, recording) {
      records.set(recording.id, { organizationId: context.organizationId, project, recording });
      return recording;
    },
    async delete(context, id, deletedAt) {
      const recording = await this.get(context, id);
      if (!recording) throw new SaasError("NOT_FOUND", "Recording not found");
      Object.assign(recording, { state: "deleted", deletedAt, updatedAt: deletedAt });
      return recording;
    },
    async retry(context, id, updatedAt) {
      const recording = await this.get(context, id);
      if (!recording) throw new SaasError("NOT_FOUND", "Recording not found");
      if (recording.state !== "failed") throw new Error("invalid state");
      Object.assign(recording, { state: "awaiting_upload", failureCode: null, updatedAt });
      return recording;
    },
    async publish(context, id, renderAssetId, expectedRevision, updatedAt) {
      const recording = await this.get(context, id);
      if (!recording) throw new SaasError("NOT_FOUND", "Recording not found");
      if (recording.shareRevision !== expectedRevision) {
        throw new SaasError("REVISION_CONFLICT", "Share revision is stale", {
          expectedRevision,
          actualRevision: recording.shareRevision
        });
      }
      Object.assign(recording, {
        publishedAssetId: renderAssetId,
        shareRevision: recording.shareRevision + 1,
        updatedAt
      });
      return recording;
    },
    async rollback(context, id, expectedRevision, updatedAt) {
      const recording = await this.get(context, id);
      if (!recording) throw new SaasError("NOT_FOUND", "Recording not found");
      if (recording.shareRevision !== expectedRevision) {
        throw new SaasError("REVISION_CONFLICT", "Share revision is stale");
      }
      Object.assign(recording, {
        publishedAssetId: null,
        shareRevision: recording.shareRevision + 1,
        updatedAt
      });
      return recording;
    },
    async resolvePublic(token): Promise<StoredScreenletterShare | null> {
      const item = [...records.values()].find(
        ({ recording }) => recording.shareToken === token
      );
      if (!item || item.recording.state !== "ready" || !item.objectKey) return null;
      return {
        recordingId: item.recording.id,
        name: item.recording.name,
        mode: item.recording.mode,
        shareRevision: item.recording.shareRevision,
        objectKey: item.objectKey,
        createdAt: item.recording.createdAt
      };
    },
    async reportAbuse(token, category, _details, reporterHash) {
      const exists = [...records.values()].some(
        ({ recording }) => recording.shareToken === token
      );
      if (exists) reports.push({ token, category, reporterHash });
      return exists;
    }
  };
  const signRead = vi.fn(async (key: string) => `https://media.invalid/${key}?signed=1`);
  const service = new ScreenletterService(repository, { signRead }, {
    editorBaseUrl: "https://app.siftcut.com",
    previewTtlSeconds: 300,
    abuseHashSalt: "test-only",
    now: () => new Date("2026-08-02T12:00:00.000Z")
  });
  return { service, records, reports, signRead };
}

describe("Screenletter service", () => {
  it("atomically creates a Screenletter project and stable unlisted token", async () => {
    const built = fixture();
    const recording = await built.service.createRecording(OWNER, {
      name: "Product walkthrough",
      mode: "screen_microphone"
    });
    const stored = built.records.get(recording.id)!;
    expect(stored.project).toMatchObject({
      id: recording.projectId,
      kind: "screenletter_recording",
      origin: "screenletter_ios"
    });
    expect(recording).toMatchObject({
      ownerId: OWNER.userId,
      state: "created",
      shareRevision: 1
    });
    expect(recording.shareToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not expose another organization's recording", async () => {
    const built = fixture();
    const recording = await built.service.createRecording(OWNER, {
      name: "Private",
      mode: "camera"
    });
    await expect(built.service.getRecording(OTHER, recording.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });

  it("returns only ready shares and signs the selected canonical object briefly", async () => {
    const built = fixture();
    const recording = await built.service.createRecording(OWNER, {
      name: "Ready",
      mode: "screen_microphone"
    });
    await expect(built.service.resolveShare(recording.shareToken)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    const stored = built.records.get(recording.id)!;
    Object.assign(recording, {
      state: "ready",
      sourceAssetId: "00000000-0000-4000-8000-000000000010",
      proxyAssetId: "00000000-0000-4000-8000-000000000011"
    });
    stored.objectKey = `orgs/${OWNER.organizationId}/proxy.mp4`;
    await expect(built.service.resolveShare(recording.shareToken)).resolves.toMatchObject({
      name: "Ready",
      shareRevision: 1,
      previewExpiresAt: "2026-08-02T12:05:00.000Z"
    });
    expect(built.signRead).toHaveBeenCalledWith(stored.objectKey, 300);
  });

  it("launches a candidate-free manual edit capped at 180 seconds", async () => {
    const built = fixture();
    const recording = await built.service.createRecording(OWNER, {
      name: "Edit me",
      mode: "camera"
    });
    Object.assign(recording, {
      state: "ready",
      sourceAssetId: "00000000-0000-4000-8000-000000000010"
    });
    const launch = await built.service.startEdit(OWNER, recording.id, { transcribe: true });
    expect(launch).toMatchObject({
      candidateId: null,
      maximumDurationMs: 180_000,
      transcribe: true
    });
    expect(launch.editorUrl).toContain("candidateId=null");
    expect(launch.editorUrl).toContain("transcribe=1");
  });

  it("increments once for publish and rejects a stale second writer", async () => {
    const built = fixture();
    const recording = await built.service.createRecording(OWNER, {
      name: "Publish",
      mode: "camera"
    });
    Object.assign(recording, {
      state: "ready",
      proxyAssetId: "00000000-0000-4000-8000-000000000011"
    });
    const renderAssetId = "00000000-0000-4000-8000-000000000012";
    await expect(built.service.publish(OWNER, recording.id, {
      renderAssetId,
      expectedRevision: 1
    })).resolves.toMatchObject({ publishedAssetId: renderAssetId, shareRevision: 2 });
    await expect(built.service.publish(OWNER, recording.id, {
      renderAssetId,
      expectedRevision: 1
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(recording.shareRevision).toBe(2);
    await expect(built.service.rollback(OWNER, recording.id, {
      expectedRevision: 2
    })).resolves.toMatchObject({ publishedAssetId: null, shareRevision: 3 });
  });

  it("stores abuse reports without retaining the reporter fingerprint", async () => {
    const built = fixture();
    const recording = await built.service.createRecording(OWNER, {
      name: "Reportable",
      mode: "camera"
    });
    await built.service.reportAbuse(
      recording.shareToken,
      { category: "spam", details: "Unwanted" },
      "203.0.113.8"
    );
    expect(built.reports).toHaveLength(1);
    expect(built.reports[0]?.reporterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(built.reports[0]?.reporterHash).not.toContain("203.0.113.8");
  });
});
