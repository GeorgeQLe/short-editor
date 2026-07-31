// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Render,
  ScheduleEntry,
  ScheduleRuleSet,
  ShortProject
} from "../src/shared/domain";
import {
  CalendarWorkspace,
  defaultScheduleRules,
  eligibleDraftRows,
  moveChoice
} from "../src/ui/CalendarWorkspace";
import { ApiClientError, api } from "../src/ui/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rules: ScheduleRuleSet = {
  id: "default",
  revision: 3,
  startDate: "2026-08-03",
  timezone: "America/New_York",
  allowedWeekdays: [1, 3, 5],
  times: ["01:30", "09:00"],
  maxPerDay: 2,
  blackoutDates: ["2026-08-07"],
  minimumSameEpisodeSpacingHours: 48,
  timezoneDatabaseVersion: "test",
  createdAt: "2026-07-30T12:00:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z"
};

function project(overrides: Partial<ShortProject> = {}): ShortProject {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    episodeId: "00000000-0000-4000-8000-000000000002",
    title: "Eligible Short",
    approved: true,
    revision: 5,
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...overrides
  } as ShortProject;
}

function renderAttempt(overrides: Partial<Render> = {}): Render {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    shortId: "00000000-0000-4000-8000-000000000001",
    projectRevision: 5,
    state: "succeeded",
    validation: { valid: true },
    determinism: { comparison: "baseline" },
    updatedAt: "2026-07-30T13:00:00.000Z",
    ...overrides
  } as Render;
}

function entry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    shortId: "00000000-0000-4000-8000-000000000001",
    renderId: "00000000-0000-4000-8000-000000000003",
    episodeId: "00000000-0000-4000-8000-000000000002",
    publishAt: "2026-08-03T13:00:00.000Z",
    timezone: "America/New_York",
    status: "draft",
    priority: 0,
    rationale: "test",
    locked: false,
    youtubeUrl: null,
    needsRerender: false,
    revision: 1,
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...overrides
  };
}

function mockReads(input: {
  ruleSet?: ScheduleRuleSet | null;
  entries?: ScheduleEntry[];
  shorts?: ShortProject[];
  renders?: Render[];
} = {}) {
  vi.spyOn(api, "scheduleEntries").mockResolvedValue(input.entries ?? []);
  vi.spyOn(api, "shorts").mockResolvedValue(input.shorts ?? []);
  vi.spyOn(api, "renders").mockResolvedValue(input.renders ?? []);
  if (input.ruleSet === null) {
    vi.spyOn(api, "scheduleRules").mockRejectedValue(
      new ApiClientError("NOT_FOUND", "missing", null, false, 404)
    );
  } else {
    vi.spyOn(api, "scheduleRules").mockResolvedValue(input.ruleSet ?? rules);
  }
}

describe("Calendar workspace", () => {
  it("provides system-zone first-run defaults", () => {
    const defaults = defaultScheduleRules();
    expect(defaults.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    expect(defaults.allowedWeekdays).toEqual([1, 3, 5]);
    expect(defaults.times).toEqual(["09:00"]);
    expect(defaults.maxPerDay).toBe(1);
    expect(defaults.blackoutDates).toEqual([]);
    expect(defaults.minimumSameEpisodeSpacingHours).toBe(48);
  });

  it("filters to the newest eligible current-revision render with stable ordering", () => {
    const short = project();
    const old = renderAttempt({ id: "00000000-0000-4000-8000-000000000010" });
    const newest = renderAttempt({
      id: "00000000-0000-4000-8000-000000000011",
      determinism: { ...old.determinism!, comparison: "matched" },
      updatedAt: "2026-07-30T14:00:00.000Z"
    });
    const stale = renderAttempt({
      id: "00000000-0000-4000-8000-000000000012",
      projectRevision: 4,
      updatedAt: "2026-07-30T15:00:00.000Z"
    });
    expect(eligibleDraftRows([short], [old, newest, stale], [])[0]?.render.id).toBe(newest.id);
    expect(eligibleDraftRows([short], [newest], [entry()])).toEqual([]);
    expect(eligibleDraftRows([{ ...short, approved: false }], [newest], [])).toEqual([]);
  });

  it("creates first-run rules and preserves edits while reloading a conflict revision", async () => {
    mockReads({ ruleSet: null });
    const update = vi.spyOn(api, "updateScheduleRules")
      .mockRejectedValueOnce(new ApiClientError(
        "REVISION_CONFLICT", "created elsewhere",
        { expectedRevision: null, actualRevision: 1 }, false, 409
      ))
      .mockResolvedValueOnce(rules);
    render(<CalendarWorkspace announce={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByText("First-run defaults");
    const timezone = screen.getByLabelText("IANA timezone");
    await userEvent.clear(timezone);
    await userEvent.type(timezone, "UTC");
    await userEvent.click(screen.getByRole("button", { name: "Create rules" }));
    await screen.findByText("Revision conflict");
    expect(timezone).toHaveValue("UTC");
    await userEvent.click(screen.getByRole("button", { name: "Reload revision" }));
    await waitFor(() => expect(api.scheduleRules).toHaveBeenCalledTimes(2));
    expect(timezone).toHaveValue("UTC");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ timezone: "UTC" }), undefined);
  });

  it("saves only editable fields for an existing exact rule revision", async () => {
    mockReads();
    let resolveUpdate!: (value: ScheduleRuleSet) => void;
    const update = vi.spyOn(api, "updateScheduleRules").mockImplementation(() =>
      new Promise((resolve) => {
        resolveUpdate = resolve;
      })
    );
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<CalendarWorkspace announce={vi.fn()} onChanged={onChanged} />);
    await screen.findByText("Revision 3");
    const save = screen.getByRole("button", { name: "Save exact revision" });
    const form = save.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(update).toHaveBeenCalledTimes(1);
    resolveUpdate({
      ...rules,
      revision: 4
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({
      startDate: rules.startDate,
      timezone: rules.timezone,
      allowedWeekdays: rules.allowedWeekdays,
      times: rules.times,
      maxPerDay: rules.maxPerDay,
      blackoutDates: rules.blackoutDates,
      minimumSameEpisodeSpacingHours: rules.minimumSameEpisodeSpacingHours
    }, 3);
  });

  it("drafts selected eligible Shorts with integer priorities and renders DST warnings", async () => {
    mockReads({ shorts: [project()], renders: [renderAttempt()] });
    vi.spyOn(api, "draftSchedule").mockResolvedValue({
      entries: [],
      warnings: [{
        kind: "ambiguous_local_time",
        localDate: "2026-11-01",
        localTime: "01:30",
        timezone: "America/New_York",
        selectedUtcInstant: "2026-11-01T05:30:00.000Z",
        alternativeUtcInstant: "2026-11-01T06:30:00.000Z",
        adjustmentMinutes: 0
      }],
      rulesRevision: 3,
      dstPolicy: "shift-forward-gap-earlier-overlap-v1",
      resolverTimezoneDatabaseVersion: "test"
    });
    render(<CalendarWorkspace announce={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.click(await screen.findByRole("tab", { name: /Draft Queue/ }));
    await userEvent.click(screen.getByLabelText("Select Eligible Short"));
    fireEvent.change(screen.getByLabelText("Priority for Eligible Short"), { target: { value: "8" } });
    await userEvent.click(screen.getByRole("button", { name: "Draft selected atomically" }));
    await screen.findByText("DST resolution warnings");
    expect(api.draftSchedule).toHaveBeenCalledWith([expect.objectContaining({
      priority: 8, renderId: renderAttempt().id
    })], 3);
    expect(screen.getByText(/Alternative 2026-11-01T06:30/)).toBeInTheDocument();
  });

  it("explains illegal, occupied, spacing, and DST move choices locally", () => {
    const current = entry();
    expect(moveChoice(current, rules, [], "2026-08-01", "09:00").reason).toMatch(/before/);
    expect(moveChoice(current, rules, [], "2026-08-04", "09:00").reason).toMatch(/not an allowed/);
    expect(moveChoice(current, rules, [], "2026-08-07", "09:00").reason).toMatch(/blacked out/);
    expect(moveChoice(current, rules, [], "2026-08-03", "12:00").reason).toMatch(/outside/);
    const occupied = entry({
      id: "00000000-0000-4000-8000-000000000099",
      publishAt: "2026-08-05T13:00:00.000Z",
      episodeId: "different"
    });
    expect(moveChoice(current, rules, [occupied], "2026-08-05", "09:00").reason).toMatch(/occupies/);
    const sameEpisode = { ...occupied, episodeId: current.episodeId, publishAt: "2026-08-06T13:00:00.000Z" };
    expect(moveChoice(current, rules, [sameEpisode], "2026-08-05", "09:00").reason).toMatch(/spacing/);
    const overlapRules = { ...rules, startDate: "2026-11-01", allowedWeekdays: [0], blackoutDates: [] };
    expect(moveChoice(current, overlapRules, [], "2026-11-01", "01:30")).toMatchObject({
      publishAt: "2026-11-01T05:30:00.000Z",
      warning: { kind: "ambiguous_local_time" }
    });
  });

  it("validates publication URLs and refreshes to a permanently locked returned state", async () => {
    const planned = entry();
    mockReads({ entries: [planned] });
    vi.spyOn(api, "markSchedulePublished").mockImplementation(async () => {
      (api.scheduleEntries as ReturnType<typeof vi.fn>).mockResolvedValue([
        entry({ status: "published", locked: true, revision: 2 })
      ]);
      return entry({ status: "published", locked: true, revision: 2 });
    });
    render(<CalendarWorkspace announce={vi.fn()} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.click(await screen.findByRole("tab", { name: "Schedule" }));
    await userEvent.click(screen.getByRole("button", { name: "Record publication" }));
    const url = screen.getByLabelText("Optional HTTPS YouTube URL");
    await userEvent.type(url, "http://youtube.com/watch?v=x");
    expect(screen.getByRole("button", { name: "Confirm permanent lock" })).toBeDisabled();
    await userEvent.clear(url);
    await userEvent.type(url, "https://youtu.be/example");
    await userEvent.click(screen.getByRole("button", { name: "Confirm permanent lock" }));
    await waitFor(() => expect(screen.getByText("locked")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    expect(api.markSchedulePublished).toHaveBeenCalledWith(
      planned.id, planned.revision, "https://youtu.be/example"
    );
  });
});
