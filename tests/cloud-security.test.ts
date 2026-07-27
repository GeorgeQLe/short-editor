import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import { episode } from "./factories";

const servers: Array<{ close(callback?: () => void): unknown }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

function setup() {
  const repository = new Repository(openDatabase(":memory:"));
  const project = episode({ status: "ready" });
  repository.insertEpisode(project);
  const activeHandles = new Set<string>();
  const jobs = new JobQueue(repository, (handle) => activeHandles.has(handle));
  const service = new CoreService(
    repository,
    {} as never,
    jobs,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    activeHandles
  );
  return { repository, project, service, activeHandles };
}

describe("persisted cloud authorization", () => {
  it("requires a matching grant and active protected credential handle", () => {
    const { repository, project, service, activeHandles } = setup();
    const handle = `credential:${randomUUID()}`;
    service.synchronizeCredentialHandles([handle]);

    expect(() => service.startAnalysis(project.id, "openai"))
      .toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));
    repository.grantCloudAuthorization({
      id: randomUUID(),
      scopeType: "project",
      scopeId: randomUUID(),
      provider: "openai",
      operationClasses: ["transcription"],
      credentialHandle: handle,
      grantedAt: new Date().toISOString(),
      revokedAt: null
    });
    expect(() => service.startAnalysis(project.id, "openai"))
      .toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));

    const grant = service.grantCloudAuthorization({
      scopeType: "project",
      scopeId: project.id,
      provider: "openai",
      operationClasses: ["transcription"],
      credentialHandle: handle,
      dataDescription: "Episode audio",
      networkUseConfirmed: true,
      costsConfirmed: true
    });
    expect(service.startAnalysis(project.id, "openai")).toMatchObject({
      provider: "openai",
      state: "queued"
    });

    service.revokeCloudAuthorization(grant.id);
    expect(service.jobs.claimNext()).toBeUndefined();
    expect(service.listJobs()[0]).toMatchObject({
      state: "failed",
      errorCode: "CLOUD_NOT_AUTHORIZED"
    });
    expect(() => service.startAnalysis(project.id, "openai"))
      .toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));
    activeHandles.clear();
    repository.db.close();
  });

  it("revokes every matching grant when a credential is removed", () => {
    const { repository, project, service } = setup();
    const handle = `credential:${randomUUID()}`;
    service.synchronizeCredentialHandles([handle]);
    service.grantCloudAuthorization({
      scopeType: "project",
      scopeId: project.id,
      provider: "openai",
      operationClasses: ["transcription", "analysis"],
      credentialHandle: handle,
      dataDescription: "Episode audio and analysis inputs",
      networkUseConfirmed: true,
      costsConfirmed: true
    });

    service.removeCredentialHandle(handle);

    expect(repository.hasCloudAuthorization(
      "project", project.id, "openai", "transcription"
    )).toBe(false);
    expect(() => service.startAnalysis(project.id, "openai"))
      .toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));
    repository.db.close();
  });

  it("accepts an explicitly selected authorized batch without treating its id as proof", () => {
    const { repository, project, service } = setup();
    const handle = `credential:${randomUUID()}`;
    const batchId = randomUUID();
    service.synchronizeCredentialHandles([handle]);
    service.grantCloudAuthorization({
      scopeType: "batch",
      scopeId: batchId,
      provider: "openai",
      operationClasses: ["transcription"],
      credentialHandle: handle,
      dataDescription: "Audio for the explicitly selected batch",
      networkUseConfirmed: true,
      costsConfirmed: true
    });

    expect(service.startAnalysis(project.id, "openai", {
      authorizationBatchId: batchId
    })).toMatchObject({ state: "queued" });
    expect(() => service.startAnalysis(project.id, "openai", {
      authorizationBatchId: randomUUID()
    })).toThrow(expect.objectContaining({ code: "CLOUD_NOT_AUTHORIZED" }));
    repository.db.close();
  });

  it("requires the desktop confirmation fields", () => {
    const { repository, project, service } = setup();
    const handle = `credential:${randomUUID()}`;
    service.synchronizeCredentialHandles([handle]);
    expect(() => service.grantCloudAuthorization({
      scopeType: "project",
      scopeId: project.id,
      provider: "openai",
      operationClasses: ["transcription"],
      credentialHandle: handle,
      dataDescription: "Episode audio",
      networkUseConfirmed: false,
      costsConfirmed: true
    })).toThrow(expect.objectContaining({ code: "CLOUD_CONFIRMATION_REQUIRED" }));
    repository.db.close();
  });
});

describe("desktop-only HTTP gate", () => {
  it("rejects forged authorization booleans and unauthorized grant calls", async () => {
    const { repository, project, service } = setup();
    const server = createApi(service, "desktop-secret").listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");
    const url = `http://127.0.0.1:${address.port}/v1`;

    const forged = await fetch(`${url}/analysis/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId: project.id,
        provider: "openai",
        cloudAuthorized: true
      })
    });
    expect(forged.status).toBe(422);

    const directGrant = await fetch(`${url}/desktop/cloud-authorizations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(directGrant.status).toBe(403);
    repository.db.close();
  });
});
