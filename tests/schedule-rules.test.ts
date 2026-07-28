import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import {
  scheduleDraftResultSchema,
  scheduleRuleSetSchema
} from "../src/shared/domain";
import { AppError } from "../src/shared/errors";
import { episode } from "./factories";

const repositories: Repository[] = [];
const servers: Server[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )));
  repositories.splice(0).forEach((repository) => repository.db.open && repository.db.close());
});

function setup() {
  const repository = new Repository(openDatabase(":memory:"));
  repositories.push(repository);
  const service = new CoreService(repository, {} as never, new JobQueue(repository));
  return { repository, service };
}

const rules = {
  startDate: "2026-03-08",
  timezone: "America/New_York",
  allowedWeekdays: [5, 1, 3],
  times: ["17:00", "09:30"],
  maxPerDay: 2,
  blackoutDates: ["2026-12-25", "2026-07-04"],
  minimumSameEpisodeSpacingHours: 48
};

function expectErrorCode(work: () => unknown, code: string) {
  try {
    work();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe("revisioned schedule rules", () => {
  it("creates revision one, canonicalizes snapshots, and requires exact later CAS", () => {
    const { repository, service } = setup();
    expectErrorCode(() => service.getScheduleRules(), "NOT_FOUND");

    const created = service.updateScheduleRules(rules);
    expect(created).toMatchObject({
      id: "default",
      revision: 1,
      allowedWeekdays: [1, 3, 5],
      times: ["09:30", "17:00"],
      blackoutDates: ["2026-07-04", "2026-12-25"]
    });
    expect(created.timezoneDatabaseVersion.length).toBeGreaterThan(0);

    expectErrorCode(() => service.updateScheduleRules(rules), "VALIDATION_ERROR");
    expectErrorCode(
      () => service.updateScheduleRules({ ...rules, expectedRevision: 9 }),
      "REVISION_CONFLICT"
    );

    const updated = service.updateScheduleRules({
      ...rules,
      expectedRevision: 1,
      timezone: "Europe/Paris"
    });
    expect(updated).toMatchObject({
      revision: 2,
      timezone: "Europe/Paris",
      times: ["09:30", "17:00"]
    });

    const beforeInvalid = repository.getScheduleRuleSet("default");
    expectErrorCode(() => service.updateScheduleRules({
      ...rules,
      expectedRevision: 2,
      times: ["09:30", "09:30"]
    }), "VALIDATION_ERROR");
    expect(repository.getScheduleRuleSet("default")).toEqual(beforeInvalid);
  });

  it("drafts only against an exact persisted revision and returns policy diagnostics", () => {
    const { service } = setup();
    expectErrorCode(() => service.draftSchedule([], 1), "NOT_FOUND");
    service.updateScheduleRules(rules);
    const result = service.draftSchedule([], 1);
    expect(scheduleDraftResultSchema.parse(result)).toMatchObject({
      entries: [],
      warnings: [],
      rulesRevision: 1,
      dstPolicy: "shift-forward-gap-earlier-overlap-v1"
    });
    service.updateScheduleRules({ ...rules, expectedRevision: 1 });
    expectErrorCode(() => service.draftSchedule([], 1), "REVISION_CONFLICT");
  });

  it("rejects a caller-supplied Episode that does not own the Short", () => {
    const { repository, service } = setup();
    const owner = episode();
    const unrelated = episode();
    repository.insertEpisode(owner);
    repository.insertEpisode(unrelated);
    const shortId = randomUUID();
    const renderId = randomUUID();
    const now = new Date().toISOString();
    repository.db.prepare(`
      INSERT INTO short_projects(
        id,episode_id,title,source_ranges_json,template_id,composition_json,
        copy_json,approved,revision,created_at,updated_at
      ) VALUES(?,?,'Schedule fixture','[]','fullscreen-speaker-v1','{}','{}',1,1,?,?)
    `).run(shortId, owner.id, now, now);
    repository.db.prepare(`
      INSERT INTO renders(
        id,short_id,project_revision,encoder_json,determinism_json,state,created_at,updated_at
      ) VALUES(?,?,1,'{}','{"comparison":"baseline"}','succeeded',?,?)
    `).run(renderId, shortId, now, now);
    service.updateScheduleRules(rules);

    expectErrorCode(() => service.draftSchedule([{
      shortId,
      renderId,
      episodeId: unrelated.id,
      priority: 1
    }], 1), "INVALID_STATE");
    expect(repository.db.prepare(
      "SELECT COUNT(*) AS count FROM schedule_entries"
    ).get()).toEqual({ count: 0 });
  });

  it("keeps HTTP and typed MCP rule reads and updates identical", async () => {
    const { service } = setup();
    const server = createApi(service).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/v1`;

    const createResponse = await fetch(`${base}/schedule/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rules)
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json() as { data: unknown }).data;
    scheduleRuleSetSchema.parse(created);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "schedule-parity-test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);

    const read = await client.callTool({ name: "schedule.get_rules", arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(((read as { content: Array<{ text: string }> }).content[0]!).text)
      .toContain("\"revision\": 1");

    const updated = await client.callTool({
      name: "schedule.update_rules",
      arguments: { ...rules, expectedRevision: 1, timezone: "Europe/Paris" }
    });
    expect(updated.isError).not.toBe(true);
    expect(((updated as { content: Array<{ text: string }> }).content[0]!).text)
      .toContain("\"revision\": 2");

    const httpRead = await fetch(`${base}/schedule/rules`);
    expect((await httpRead.json() as { data: unknown }).data)
      .toEqual(service.getScheduleRules());

    const unknown = await fetch(`${base}/schedule/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rules, expectedRevision: 2, unknown: true })
    });
    expect(unknown.status).toBe(422);
  });
});
