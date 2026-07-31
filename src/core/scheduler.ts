import { randomUUID } from "node:crypto";
import {
  scheduleDstPolicyId,
  type ScheduleDraftEntry,
  type ScheduleDraftResult,
  type ScheduleRules,
  type SchedulableShort
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";
import {
  resolveZonedWallTime,
  type ResolvedScheduleSlot
} from "../shared/schedule-time.js";

export { resolveZonedWallTime } from "../shared/schedule-time.js";

export type { SchedulableShort };

export interface OccupiedScheduleEntry {
  publishAt: string;
  episodeId: string;
}

export function timezoneDatabaseVersion(): string {
  return process.versions.tz ?? "unknown";
}

export function draftSchedule(
  shorts: SchedulableShort[],
  rules: ScheduleRules,
  occupiedInstants: string[] = [],
  rulesRevision = 1,
  occupiedEntries: OccupiedScheduleEntry[] = []
): ScheduleDraftResult {
  validateTimezone(rules.timezone);
  const occupied = new Set(occupiedInstants.map((instant) => new Date(instant).toISOString()));
  const sorted = [...shorts].sort((a, b) => b.priority - a.priority || a.shortId.localeCompare(b.shortId));
  const entries: ScheduleDraftEntry[] = [];
  const warnings: ScheduleDraftResult["warnings"] = [];
  const episodeTimes = new Map<string, number[]>();
  for (const entry of occupiedEntries) {
    const time = new Date(entry.publishAt).getTime();
    if (!Number.isNaN(time)) {
      episodeTimes.set(entry.episodeId, [...(episodeTimes.get(entry.episodeId) ?? []), time]);
    }
  }
  const slots = legalSlots(rules, 730);

  for (const item of sorted) {
    const slot = slots.find(({ instant }) => {
      const iso = instant.toISOString();
      if (occupied.has(iso) || entries.some((entry) => entry.publishAt === iso)) return false;
      const prior = episodeTimes.get(item.episodeId) ?? [];
      const spacingMs = rules.minimumSameEpisodeSpacingHours * 3_600_000;
      return prior.every((time) => Math.abs(instant.getTime() - time) >= spacingMs);
    });
    if (!slot) throw new AppError("INVALID_STATE", `No legal slot found for Short ${item.shortId}`, 422);
    episodeTimes.set(item.episodeId, [
      ...(episodeTimes.get(item.episodeId) ?? []),
      slot.instant.getTime()
    ]);
    entries.push({
      id: randomUUID(),
      shortId: item.shortId,
      renderId: item.renderId,
      episodeId: item.episodeId,
      priority: item.priority,
      publishAt: slot.instant.toISOString(),
      timezone: rules.timezone,
      rationale: `Priority ${item.priority}; earliest legal slot respecting cadence and episode spacing.`
    });
    if (slot.warning) warnings.push(slot.warning);
  }
  return {
    entries,
    warnings,
    rulesRevision,
    dstPolicy: scheduleDstPolicyId,
    resolverTimezoneDatabaseVersion: timezoneDatabaseVersion()
  };
}

export function isLegalScheduleInstant(publishAt: string, rules: ScheduleRules): boolean {
  const instant = new Date(publishAt);
  if (Number.isNaN(instant.getTime())) return false;
  const nearbyDate = new Date(Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate()
  ));
  for (const dayOffset of [-1, 0, 1]) {
    const candidateDate = addUtcDays(nearbyDate, dayOffset);
    const dateKey = formatDate(candidateDate);
    if (
      dateKey < rules.startDate ||
      rules.blackoutDates.includes(dateKey) ||
      !rules.allowedWeekdays.includes(candidateDate.getUTCDay())
    ) continue;
    for (const time of rules.times.slice(0, rules.maxPerDay)) {
      if (resolveZonedWallTime(dateKey, time, rules.timezone).instant.getTime() === instant.getTime()) {
        return true;
      }
    }
  }
  return false;
}

function legalSlots(rules: ScheduleRules, horizonDays: number): ResolvedScheduleSlot[] {
  const slots: ResolvedScheduleSlot[] = [];
  const start = parseDate(rules.startDate);
  for (let day = 0; day < horizonDays; day++) {
    const date = addUtcDays(start, day);
    const dateKey = formatDate(date);
    if (rules.blackoutDates.includes(dateKey) || !rules.allowedWeekdays.includes(date.getUTCDay())) continue;
    for (const time of rules.times.slice(0, rules.maxPerDay)) {
      slots.push(resolveZonedWallTime(dateKey, time, rules.timezone));
    }
  }
  return slots.sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new AppError("VALIDATION_ERROR", `Unknown timezone: ${timezone}`, 422);
  }
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError("VALIDATION_ERROR", "Invalid start date", 422);
  }
  return parsed;
}

function addUtcDays(date: Date, count: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + count);
  return copy;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
