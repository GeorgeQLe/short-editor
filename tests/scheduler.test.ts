import { describe, expect, it } from "vitest";
import { draftSchedule } from "../src/core/scheduler";

describe("deterministic calendar", () => {
  it("accounts for daylight-saving offsets in the configured timezone", () => {
    const entries = draftSchedule([
      { shortId: "a", renderId: "ra", episodeId: "ea", priority: 2 },
      { shortId: "b", renderId: "rb", episodeId: "eb", priority: 1 }
    ], {
      startDate: "2026-03-07", timezone: "America/New_York",
      allowedWeekdays: [1, 6], times: ["09:00"], maxPerDay: 1,
      blackoutDates: [], minimumSameEpisodeSpacingHours: 0
    });

    expect(entries.map((entry) => entry.publishAt)).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-09T13:00:00.000Z"
    ]);
  });

  it("skips blackouts, occupied slots, and respects same-episode spacing", () => {
    const entries = draftSchedule([
      { shortId: "a", renderId: "ra", episodeId: "same", priority: 2 },
      { shortId: "b", renderId: "rb", episodeId: "same", priority: 1 }
    ], {
      startDate: "2026-01-05", timezone: "UTC",
      allowedWeekdays: [1, 2, 3, 4, 5], times: ["09:00", "16:00"], maxPerDay: 2,
      blackoutDates: ["2026-01-06"], minimumSameEpisodeSpacingHours: 24
    }, ["2026-01-05T09:00:00.000Z"]);

    expect(entries[0]!.publishAt).toBe("2026-01-05T16:00:00.000Z");
    expect(entries[1]!.publishAt).toBe("2026-01-07T09:00:00.000Z");
  });
});
