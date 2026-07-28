import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import {
  shortApprovalInputSchema,
  shortTimelineUpdateInputSchema,
  type ProviderProvenance,
  type ShortProject
} from "../src/shared/domain";
import { candidate, episode, segments } from "./factories";

const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];
const now = "2026-07-27T12:00:00.000Z";
const provenance: ProviderProvenance = {
  provider: "fixture",
  providerClass: "local",
  modelId: "fixture-v1",
  providerVersion: "1",
  optionsVersion: "1",
  createdAt: now
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
});

function setup(overrides: Parameters<typeof episode>[0] = {}) {
  const repository = new Repository(openDatabase(":memory:"));
  repositories.push(repository);
  const source = episode({ durationMs: 400_000, ...overrides });
  repository.insertEpisode(source);
  repository.replaceTranscriptWithProvenance(source.id, segments(80), "en", provenance);
  const service = new CoreService(repository, {} as never, new JobQueue(repository));
  return { repository, source, service };
}

function createAcceptedShort(context: ReturnType<typeof setup>) {
  const generated = context.service.generateCandidates({
    episodeId: context.source.id,
    count: 5,
    strategy: "replace_pending",
    mode: "heuristic"
  });
  const proposal = generated.candidates[0]!;
  context.service.acceptCandidateContentPackage(
    proposal.id,
    proposal.revision,
    context.service.getCandidateContentPackage(proposal.id).proposed
  );
  context.service.reviewCandidate(proposal.id, proposal.revision + 1, "approved");
  return context.service.createShort(proposal.id);
}

function insertRenderAndSchedules(
  repository: Repository,
  project: ShortProject,
  scheduleStatuses: Array<"draft" | "planned" | "published"> = ["draft", "published"]
) {
  const renderId = randomUUID();
  repository.db.prepare(`
    INSERT INTO renders(id,short_id,project_revision,encoder_json,state,created_at,updated_at)
    VALUES(?,?,?,'{}','succeeded',?,?)
  `).run(renderId, project.id, project.revision, now, now);
  for (const [index, status] of scheduleStatuses.entries()) {
    repository.db.prepare(`
      INSERT INTO schedule_entries(id,short_id,render_id,episode_id,publish_at,timezone,status,
        priority,rationale,needs_rerender,revision,created_at,updated_at)
      VALUES(?,?,?,?,?,'UTC',?,0,'fixture',0,1,?,?)
    `).run(
      randomUUID(), project.id, renderId, project.episodeId,
      `2026-08-01T1${2 + index}:00:00.000Z`, status, now, now
    );
  }
  return renderId;
}

describe("Short mutation contracts", () => {
  it("uses strict integer-millisecond timeline and approval inputs", () => {
    expect(shortTimelineUpdateInputSchema.parse({
      expectedRevision: 1,
      sourceRanges: [{ startMs: 0, endMs: 1 }]
    })).toEqual({
      expectedRevision: 1,
      sourceRanges: [{ startMs: 0, endMs: 1 }]
    });
    for (const input of [
      { expectedRevision: 1, sourceRanges: [{ startMs: 0.5, endMs: 1 }] },
      { expectedRevision: 1, sourceRanges: [{ startMs: 0, endMs: 1.5 }] },
      { expectedRevision: 1, sourceRanges: [{ startMs: 0, endMs: 1 }], extra: true }
    ]) {
      expect(shortTimelineUpdateInputSchema.safeParse(input).success).toBe(false);
    }
    expect(shortApprovalInputSchema.safeParse({ expectedRevision: 1, extra: true }).success).toBe(false);
  });
});

describe("Short creation", () => {
  it("creates revision 1 only from an active approved Candidate and snapshots bounded captions", () => {
    const context = setup();
    const project = createAcceptedShort(context);
    const accepted = context.repository.getAcceptedTranscriptRevision(context.source.id);
    expect(project).toMatchObject({
      revision: 1,
      approved: false,
      copyState: "accepted",
      sourceRanges: [{
        startMs: expect.any(Number),
        endMs: expect.any(Number)
      }]
    });
    expect(project.captions.segments.length).toBeGreaterThan(0);
    expect(project.captions.segments.every((segment) =>
      segment.startMs >= project.sourceRanges[0]!.startMs
      && segment.endMs <= project.sourceRanges[0]!.endMs
    )).toBe(true);
    project.captions.segments[0]!.text = "independent snapshot";
    expect(accepted.segments[0]!.text).not.toBe("independent snapshot");
  });

  it("rejects pending, rejected, superseded, missing-source, unknown-duration, and invalid ranges", () => {
    const pending = setup();
    const generated = pending.service.generateCandidates({
      episodeId: pending.source.id, count: 5, strategy: "replace_pending", mode: "heuristic"
    });
    expect(() => pending.service.createShort(generated.candidates[0]!.id))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    const rejected = pending.service.reviewCandidate(generated.candidates[0]!.id, 1, "rejected");
    expect(() => pending.service.createShort(rejected.id))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    pending.repository.db.prepare("UPDATE candidates SET state='superseded',review_status='approved' WHERE id=?")
      .run(rejected.id);
    expect(() => pending.service.createShort(rejected.id))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

    const missing = setup();
    missing.repository.db.prepare(
      "UPDATE episodes SET missing=1,status='source_missing' WHERE id=?"
    ).run(missing.source.id);
    const approvedMissing = candidate(missing.source.id);
    missing.repository.replaceCandidates(missing.source.id, [approvedMissing]);
    expect(() => missing.service.createShort(approvedMissing.id))
      .toThrow(expect.objectContaining({ code: "SOURCE_MISSING" }));

    const unknown = setup({ durationMs: null });
    const approvedUnknown = candidate(unknown.source.id);
    unknown.repository.replaceCandidates(unknown.source.id, [approvedUnknown]);
    expect(() => unknown.service.createShort(approvedUnknown.id))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

    const invalid = setup();
    const outside = candidate(invalid.source.id, { endMs: 400_001 });
    invalid.repository.replaceCandidates(invalid.source.id, [outside]);
    expect(() => invalid.service.createShort(outside.id))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(invalid.repository.getEpisode(invalid.source.id)).toMatchObject({ id: invalid.source.id });
    expect(invalid.repository.getCandidate(outside.id)).toMatchObject({ id: outside.id });
  });

  it("requires an accepted transcript but preserves proposed versus accepted Candidate copy", () => {
    const absent = setup();
    absent.repository.db.prepare("UPDATE transcript_revisions SET accepted_state='superseded'").run();
    const proposal = candidate(absent.source.id);
    absent.repository.replaceCandidates(absent.source.id, [proposal]);
    expect(() => absent.service.createShort(proposal.id))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

    const proposed = setup();
    const generated = proposed.service.generateCandidates({
      episodeId: proposed.source.id, count: 5, strategy: "replace_pending", mode: "heuristic"
    });
    const reviewed = proposed.service.reviewCandidate(generated.candidates[0]!.id, 1, "approved");
    expect(proposed.service.createShort(reviewed.id)).toMatchObject({
      copyState: "proposed",
      copySource: "candidate_proposal"
    });
  });
});

describe("timeline CAS, approval, and invalidation", () => {
  it("accepts adjacent and gapped ranges while rejecting every malformed or out-of-bounds class", () => {
    const context = setup();
    let project = createAcceptedShort(context);
    project = context.service.updateTimeline(project.id, project.revision, [
      { startMs: 0, endMs: 10_000 },
      { startMs: 10_000, endMs: 20_000 },
      { startMs: 25_000, endMs: 30_000 }
    ]);
    expect(project.revision).toBe(2);
    project = context.service.updateTimeline(project.id, project.revision, [
      { startMs: 0, endMs: 10_000 },
      { startMs: 12_000, endMs: 30_000 }
    ]);
    expect(project.sourceRanges[1]!.startMs).toBe(12_000);

    const invalid = [
      [],
      [{ startMs: 10, endMs: 10 }],
      [{ startMs: 10, endMs: 9 }],
      [{ startMs: -1, endMs: 10 }],
      [{ startMs: 20, endMs: 30 }, { startMs: 0, endMs: 10 }],
      [{ startMs: 0, endMs: 20 }, { startMs: 19, endMs: 30 }],
      [{ startMs: 0, endMs: 400_001 }]
    ];
    for (const ranges of invalid) {
      const revision = context.service.getShort(project.id).revision;
      expect(() => context.service.updateTimeline(
        project.id, revision, ranges as ShortProject["sourceRanges"]
      )).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
      expect(context.service.getShort(project.id).revision).toBe(revision);
    }
  });

  it("does not mutate on stale writes and returns exact conflict details", () => {
    const context = setup();
    const project = createAcceptedShort(context);
    const updated = context.service.updateTimeline(project.id, 1, [{ startMs: 0, endMs: 20_000 }]);
    expect(() => context.service.updateTimeline(
      project.id, 1, [{ startMs: 0, endMs: 10_000 }]
    )).toThrow(expect.objectContaining({
      code: "REVISION_CONFLICT",
      details: { expectedRevision: 1, actualRevision: 2 }
    }));
    expect(context.service.getShort(project.id)).toEqual(updated);
  });

  it("timeline edits clear approval, stale successful renders, flag only unpublished schedules, and increment once", () => {
    const context = setup();
    let project = createAcceptedShort(context);
    project = context.service.approveShort(project.id, project.revision);
    const renderId = insertRenderAndSchedules(context.repository, project);
    const publishedBefore = context.repository.db.prepare(
      "SELECT * FROM schedule_entries WHERE short_id=? AND status='published'"
    ).get(project.id);

    const updated = context.service.updateTimeline(project.id, project.revision, [
      { startMs: 5_000, endMs: 25_000 }
    ]);
    expect(updated).toMatchObject({ approved: false, revision: project.revision + 1 });
    expect(context.repository.db.prepare("SELECT state FROM renders WHERE id=?").get(renderId))
      .toEqual({ state: "stale" });
    expect(context.repository.db.prepare(
      "SELECT needs_rerender,revision FROM schedule_entries WHERE short_id=? AND status='draft'"
    ).get(project.id)).toEqual({ needs_rerender: 1, revision: 2 });
    expect(context.repository.db.prepare(
      "SELECT * FROM schedule_entries WHERE short_id=? AND status='published'"
    ).get(project.id)).toEqual(publishedBefore);
  });

  it("approval requires accepted copy, valid current state and source, and increments exactly once", () => {
    const proposedContext = setup();
    const generated = proposedContext.service.generateCandidates({
      episodeId: proposedContext.source.id, count: 5, strategy: "replace_pending", mode: "heuristic"
    });
    proposedContext.service.reviewCandidate(generated.candidates[0]!.id, 1, "approved");
    let proposed = proposedContext.service.createShort(generated.candidates[0]!.id);
    expect(() => proposedContext.service.approveShort(proposed.id, proposed.revision))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    proposed = proposedContext.service.updateCopy(proposed.id, proposed.revision, proposed.copy);
    const approved = proposedContext.service.approveShort(proposed.id, proposed.revision);
    expect(approved).toMatchObject({ approved: true, revision: proposed.revision + 1 });
    expect(() => proposedContext.service.approveShort(approved.id, approved.revision))
      .toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(proposedContext.service.getShort(approved.id)).toEqual(approved);

    proposedContext.repository.db.prepare(
      "UPDATE episodes SET missing=1,status='source_missing' WHERE id=?"
    ).run(proposedContext.source.id);
    proposedContext.repository.db.prepare(
      "UPDATE short_projects SET approved=0 WHERE id=?"
    ).run(approved.id);
    expect(() => proposedContext.service.approveShort(approved.id, approved.revision))
      .toThrow(expect.objectContaining({ code: "SOURCE_MISSING" }));
  });

  it("copy-only and title-only changes preserve approval, render state, and schedule flags", () => {
    const context = setup();
    let project = createAcceptedShort(context);
    project = context.service.approveShort(project.id, project.revision);
    const renderId = insertRenderAndSchedules(context.repository, project, ["draft"]);
    const scheduleBefore = context.repository.db.prepare(
      "SELECT * FROM schedule_entries WHERE short_id=?"
    ).get(project.id);
    project = context.service.updateCopy(project.id, project.revision, {
      ...project.copy,
      titles: ["Copy-only title"]
    });
    expect(project.approved).toBe(true);
    project = context.repository.updateShort(project.id, project.revision, { title: "Display title" });
    expect(project.approved).toBe(true);
    expect(context.repository.db.prepare("SELECT state FROM renders WHERE id=?").get(renderId))
      .toEqual({ state: "succeeded" });
    expect(context.repository.db.prepare(
      "SELECT * FROM schedule_entries WHERE short_id=?"
    ).get(project.id)).toEqual(scheduleBefore);
  });
});

describe("Short HTTP and MCP parity", () => {
  it("exposes successful timeline/approval mutations and structured failures through both surfaces", async () => {
    const context = setup();
    let project = createAcceptedShort(context);
    const server = createApi(context.service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/v1`;

    const invalidResponse = await fetch(`${base}/shorts/${project.id}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: project.revision,
        sourceRanges: [{ startMs: 0, endMs: 500_000 }]
      })
    });
    expect(invalidResponse.status).toBe(422);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", retryable: false }
    });
    const unknownResponse = await fetch(`${base}/shorts/${project.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: project.revision, unknown: true })
    });
    expect(unknownResponse.status).toBe(422);
    expect(await unknownResponse.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "short-lifecycle-test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    const timeline = await client.callTool({
      name: "shorts.update_timeline",
      arguments: {
        shortId: project.id,
        expectedRevision: project.revision,
        sourceRanges: [{ startMs: 5_000, endMs: 25_000 }]
      }
    });
    expect(timeline.isError).not.toBe(true);
    project = context.service.getShort(project.id);
    const approved = await client.callTool({
      name: "shorts.approve",
      arguments: { shortId: project.id, expectedRevision: project.revision }
    });
    expect(approved.isError).not.toBe(true);

    const conflict = await client.callTool({
      name: "shorts.update_timeline",
      arguments: {
        shortId: project.id,
        expectedRevision: project.revision,
        sourceRanges: [{ startMs: 0, endMs: 20_000 }]
      }
    });
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict.content)).toContain("REVISION_CONFLICT");
    expect(JSON.stringify(conflict.content)).toContain('\\"actualRevision\\":3');

    const alreadyApproved = await client.callTool({
      name: "shorts.approve",
      arguments: { shortId: project.id, expectedRevision: 3 }
    });
    expect(alreadyApproved.isError).toBe(true);
    expect(JSON.stringify(alreadyApproved.content)).toContain("INVALID_STATE");

    context.repository.db.prepare(
      "UPDATE episodes SET missing=1,status='source_missing' WHERE id=?"
    ).run(context.source.id);
    const missingResponse = await fetch(`${base}/shorts/${project.id}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 3,
        sourceRanges: [{ startMs: 0, endMs: 20_000 }]
      })
    });
    expect(missingResponse.status).toBe(409);
    expect(await missingResponse.json()).toMatchObject({ error: { code: "SOURCE_MISSING" } });

    context.repository.db.prepare(
      "UPDATE episodes SET missing=0,status='ready',duration_ms=NULL WHERE id=?"
    ).run(context.source.id);
    const unknownDurationResponse = await fetch(`${base}/shorts/${project.id}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 3,
        sourceRanges: [{ startMs: 0, endMs: 20_000 }]
      })
    });
    expect(unknownDurationResponse.status).toBe(409);
    expect(await unknownDurationResponse.json()).toMatchObject({
      error: { code: "INVALID_STATE" }
    });
  });
});
