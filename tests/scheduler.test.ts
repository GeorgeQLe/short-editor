import { describe, expect, it } from "vitest";
import {
  draftSchedule,
  resolveZonedWallTime
} from "../src/core/scheduler";

describe("deterministic calendar", () => {
  it("shifts a spring-forward gap by its exact size and warns", () => {
    const resolved = resolveZonedWallTime(
      "2026-03-08",
      "02:30",
      "America/New_York"
    );
    expect(resolved.instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(resolved.warning).toEqual({
      kind: "nonexistent_local_time",
      localDate: "2026-03-08",
      localTime: "02:30",
      timezone: "America/New_York",
      selectedUtcInstant: "2026-03-08T07:30:00.000Z",
      adjustmentMinutes: 60
    });
  });

  it("selects the earlier fall-back instant and reports the alternative", () => {
    const resolved = resolveZonedWallTime(
      "2026-11-01",
      "01:30",
      "America/New_York"
    );
    expect(resolved.instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(resolved.warning).toEqual({
      kind: "ambiguous_local_time",
      localDate: "2026-11-01",
      localTime: "01:30",
      timezone: "America/New_York",
      selectedUtcInstant: "2026-11-01T05:30:00.000Z",
      alternativeUtcInstant: "2026-11-01T06:30:00.000Z",
      adjustmentMinutes: 0
    });
  });

  it("handles a non-one-hour transition", () => {
    const resolved = resolveZonedWallTime(
      "2026-10-04",
      "02:15",
      "Australia/Lord_Howe"
    );
    expect(resolved.instant.toISOString()).toBe("2026-10-03T15:45:00.000Z");
    expect(resolved.warning?.adjustmentMinutes).toBe(30);
  });

  it("uses explicit zones for historical and future dates regardless of host TZ", () => {
    const originalTimezone = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      const historical = resolveZonedWallTime(
        "1950-01-15",
        "09:00",
        "America/New_York"
      ).instant.toISOString();
      process.env.TZ = "Asia/Tokyo";
      const historicalUnderAnotherHostZone = resolveZonedWallTime(
        "1950-01-15",
        "09:00",
        "America/New_York"
      ).instant.toISOString();
      const future = resolveZonedWallTime(
        "2040-07-15",
        "09:00",
        "America/New_York"
      ).instant.toISOString();
      expect(historical).toBe("1950-01-15T14:00:00.000Z");
      expect(historicalUnderAnotherHostZone).toBe(historical);
      expect(future).toBe("2040-07-15T13:00:00.000Z");
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("returns warnings only for anomalous slots selected into the draft", () => {
    const result = draftSchedule([
      { shortId: "00000000-0000-4000-8000-000000000001", renderId: "00000000-0000-4000-8000-000000000002", episodeId: "00000000-0000-4000-8000-000000000003", priority: 1 }
    ], {
      startDate: "2026-03-08",
      timezone: "America/New_York",
      allowedWeekdays: [0],
      times: ["02:30"],
      maxPerDay: 1,
      blackoutDates: [],
      minimumSameEpisodeSpacingHours: 0
    });
    expect(result.entries[0]!.publishAt).toBe("2026-03-08T07:30:00.000Z");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.kind).toBe("nonexistent_local_time");
  });

  it("accounts for daylight-saving offsets in the configured timezone", () => {
    const result = draftSchedule([
      { shortId: "a", renderId: "ra", episodeId: "ea", priority: 2 },
      { shortId: "b", renderId: "rb", episodeId: "eb", priority: 1 }
    ], {
      startDate: "2026-03-07", timezone: "America/New_York",
      allowedWeekdays: [1, 6], times: ["09:00"], maxPerDay: 1,
      blackoutDates: [], minimumSameEpisodeSpacingHours: 0
    });

    expect(result.entries.map((entry) => entry.publishAt)).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-09T13:00:00.000Z"
    ]);
  });

  it("skips blackouts, occupied slots, and respects same-episode spacing", () => {
    const result = draftSchedule([
      { shortId: "a", renderId: "ra", episodeId: "same", priority: 2 },
      { shortId: "b", renderId: "rb", episodeId: "same", priority: 1 }
    ], {
      startDate: "2026-01-05", timezone: "UTC",
      allowedWeekdays: [1, 2, 3, 4, 5], times: ["09:00", "16:00"], maxPerDay: 2,
      blackoutDates: ["2026-01-06"], minimumSameEpisodeSpacingHours: 24
    }, ["2026-01-05T09:00:00.000Z"]);

    expect(result.entries[0]!.publishAt).toBe("2026-01-05T16:00:00.000Z");
    expect(result.entries[1]!.publishAt).toBe("2026-01-07T09:00:00.000Z");
  });
});
