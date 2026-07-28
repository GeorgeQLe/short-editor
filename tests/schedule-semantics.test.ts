import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/core/api";
import { openDatabase } from "../src/core/database";
import { JobQueue } from "../src/core/jobs";
import { Repository } from "../src/core/repository";
import { CoreService } from "../src/core/service";
import {
  scheduleEntrySchema,
  scheduleMarkPublishedInputSchema,
  scheduleMoveInputSchema
} from "../src/shared/domain";
import { AppError } from "../src/shared/errors";
import { episode } from "./factories";

const rules = {
  startDate: "2026-08-03",
  timezone: "UTC",
  allowedWeekdays: [1, 2, 3, 4, 5],
  times: ["09:00", "17:00"],
  maxPerDay: 2,
  blackoutDates: ["2026-08-05"],
  minimumSameEpisodeSpacingHours: 24
};

function setup() {
  const repository = new Repository(openDatabase(":memory:"));
  const service = new CoreService(repository, {} as never, new JobQueue(repository));
  service.updateScheduleRules(rules);
  return { repository, service };
}

function eligible(
  repository: Repository,
  episodeId: string,
  shortId = randomUUID(),
  renderId = randomUUID()
) {
  const now = new Date().toISOString();
  repository.db.prepare(`
    INSERT INTO short_projects(
      id,episode_id,title,source_ranges_json,template_id,composition_json,
      copy_json,approved,revision,created_at,updated_at
    ) VALUES(?,?,'Schedule fixture','[]','fullscreen-speaker-v1','{}','{}',1,1,?,?)
  `).run(shortId, episodeId, now, now);
  repository.db.prepare(`
    INSERT INTO renders(
      id,short_id,project_revision,encoder_json,validation_json,determinism_json,state,
      lineage_id,attempt,created_at,updated_at
    ) VALUES(?,?,1,'{}','{"valid":true}','{"comparison":"baseline"}','succeeded',?,1,?,?)
  `).run(renderId, shortId, renderId, now, now);
  return { shortId, renderId, episodeId };
}

function expectCode(work: () => unknown, code: string) {
  try {
    work();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe("complete schedule entry semantics", () => {
  it("drafts stable ties and respects existing same-Episode spacing", () => {
    const { repository, service } = setup();
    const source = episode();
    const otherSource = episode();
    repository.insertEpisode(source);
    repository.insertEpisode(otherSource);
    const laterId = "00000000-0000-4000-8000-000000000020";
    const earlierId = "00000000-0000-4000-8000-000000000010";
    const later = eligible(repository, source.id, laterId);
    const earlier = eligible(repository, otherSource.id, earlierId);

    const first = service.draftSchedule([
      { ...later, priority: 5 },
      { ...earlier, priority: 5 }
    ], 1);
    expect(first.entries.map((entry) => entry.shortId)).toEqual([earlierId, laterId]);
    expect(first.entries.map((entry) => entry.publishAt)).toEqual([
      "2026-08-03T09:00:00.000Z",
      "2026-08-03T17:00:00.000Z"
    ]);

    const sameEpisode = eligible(repository, source.id);
    const second = service.draftSchedule([{ ...sameEpisode, priority: 1 }], 1);
    expect(second.entries[0]!.publishAt).toBe("2026-08-04T17:00:00.000Z");
    expect(service.getSchedule().every((entry) =>
      scheduleEntrySchema.safeParse(entry).success
    )).toBe(true);
  });

  it("rejects duplicate and already-scheduled Shorts without partial inserts", () => {
    const { repository, service } = setup();
    const source = episode();
    repository.insertEpisode(source);
    const item = eligible(repository, source.id);

    expectCode(() => service.draftSchedule([
      { ...item, priority: 2 },
      { ...item, priority: 1 }
    ], 1), "INVALID_STATE");
    expect(service.getSchedule()).toEqual([]);

    service.draftSchedule([{ ...item, priority: 1 }], 1);
    expectCode(() => service.draftSchedule([{ ...item, priority: 1 }], 1), "INVALID_STATE");
    expect(service.getSchedule()).toHaveLength(1);
  });

  it("validates moves against rules, collisions, spacing, and revisions", () => {
    const { repository, service } = setup();
    const firstSource = episode();
    repository.insertEpisode(firstSource);
    const first = eligible(repository, firstSource.id);
    const second = eligible(repository, firstSource.id);
    service.draftSchedule([
      { ...first, priority: 2 },
      { ...second, priority: 1 }
    ], 1);
    const [firstEntry, secondEntry] = service.getSchedule();

    expectCode(() => service.moveScheduleEntry(
      firstEntry!.id, firstEntry!.revision, "2026-08-03T10:00:00.000Z"
    ), "INVALID_STATE");
    expectCode(() => service.moveScheduleEntry(
      firstEntry!.id, firstEntry!.revision, secondEntry!.publishAt
    ), "SCHEDULE_COLLISION");
    expectCode(() => service.moveScheduleEntry(
      firstEntry!.id, firstEntry!.revision, "2026-08-04T17:00:00.000Z"
    ), "SCHEDULE_COLLISION");

    const moved = service.moveScheduleEntry(
      firstEntry!.id, firstEntry!.revision, "2026-08-06T09:00:00.000Z"
    );
    expect(moved).toMatchObject({
      status: "planned",
      revision: firstEntry!.revision + 1,
      publishAt: "2026-08-06T09:00:00.000Z"
    });
    expectCode(() => service.moveScheduleEntry(
      firstEntry!.id, firstEntry!.revision, "2026-08-06T17:00:00.000Z"
    ), "REVISION_CONFLICT");
  });

  it("publishes manually once, rejects stale renders, and locks permanently", () => {
    const { repository, service } = setup();
    const source = episode();
    repository.insertEpisode(source);
    const current = eligible(repository, source.id);
    const stale = eligible(repository, source.id);
    service.draftSchedule([
      { ...current, priority: 2 },
      { ...stale, priority: 1 }
    ], 1);
    const [currentEntry, staleEntry] = service.getSchedule();
    repository.db.prepare(
      "UPDATE schedule_entries SET needs_rerender=1 WHERE id=?"
    ).run(staleEntry!.id);
    expectCode(() => service.markPublished(
      staleEntry!.id, staleEntry!.revision
    ), "INVALID_STATE");

    const published = service.markPublished(
      currentEntry!.id,
      currentEntry!.revision,
      "https://youtu.be/example"
    );
    expect(published).toMatchObject({
      status: "published",
      locked: true,
      youtubeUrl: "https://youtu.be/example",
      revision: currentEntry!.revision + 1
    });
    expectCode(() => service.markPublished(
      published.id, published.revision, "https://youtu.be/replacement"
    ), "INVALID_STATE");
    expectCode(() => service.moveScheduleEntry(
      published.id, published.revision, "2026-08-04T09:00:00.000Z"
    ), "INVALID_STATE");
    expect(repository.getScheduleEntry(published.id)).toEqual(published);
  });

  it("uses strict move and YouTube-only publication contracts", () => {
    expect(scheduleMoveInputSchema.safeParse({
      expectedRevision: 1,
      publishAt: "2026-08-03T09:00:00.000Z",
      unknown: true
    }).success).toBe(false);
    expect(scheduleMarkPublishedInputSchema.safeParse({
      expectedRevision: 1,
      youtubeUrl: "https://example.com/video"
    }).success).toBe(false);
    expect(scheduleMarkPublishedInputSchema.safeParse({
      expectedRevision: 1,
      youtubeUrl: "http://youtu.be/example"
    }).success).toBe(false);
    expect(scheduleMarkPublishedInputSchema.safeParse({
      expectedRevision: 1,
      youtubeUrl: "https://www.youtube.com/shorts/example"
    }).success).toBe(true);
    expect(scheduleMarkPublishedInputSchema.safeParse({
      expectedRevision: 1
    }).success).toBe(true);
  });

  it("keeps strict HTTP moves and typed MCP publication in parity", async () => {
    const { repository, service } = setup();
    const source = episode();
    repository.insertEpisode(source);
    const item = eligible(repository, source.id);
    service.draftSchedule([{ ...item, priority: 1 }], 1);
    const entry = service.getSchedule()[0]!;
    const server = createApi(service).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: { ...process.env, SHORT_EDITOR_CORE_URL: base }
    });
    const client = new Client({ name: "schedule-semantics-test", version: "1.0.0" });
    try {
      const invalidUrl = await fetch(`${base}/schedule/${entry.id}/published`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: entry.revision,
          youtubeUrl: "https://example.com/not-youtube"
        })
      });
      expect(invalidUrl.status).toBe(422);

      const move = await fetch(`${base}/schedule/${entry.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: entry.revision,
          publishAt: "2026-08-04T09:00:00.000Z"
        })
      });
      expect(move.status).toBe(200);
      const moved = (await move.json() as { data: unknown }).data;
      expect(scheduleEntrySchema.parse(moved)).toMatchObject({
        status: "planned",
        revision: 2
      });

      await client.connect(transport);
      const published = await client.callTool({
        name: "schedule.mark_published",
        arguments: {
          entryId: entry.id,
          expectedRevision: 2,
          youtubeUrl: "https://www.youtube.com/shorts/example"
        }
      });
      expect(published.isError).not.toBe(true);
      expect(((published as { content: Array<{ text: string }> }).content[0]!).text)
        .toContain("\"status\": \"published\"");
      expect(service.getSchedule()[0]).toMatchObject({
        status: "published",
        locked: true,
        revision: 3
      });
    } finally {
      await client.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  });
});
