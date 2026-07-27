import { randomUUID } from "node:crypto";
import type { ScheduleRules } from "../shared/domain.js";
import { AppError } from "../shared/errors.js";

export interface SchedulableShort {
  shortId: string;
  renderId: string;
  episodeId: string;
  priority: number;
  topic?: string;
}

export interface DraftScheduleEntry {
  id: string;
  shortId: string;
  renderId: string;
  episodeId: string;
  publishAt: string;
  timezone: string;
  priority: number;
  rationale: string;
}

export function draftSchedule(
  shorts: SchedulableShort[],
  rules: ScheduleRules,
  occupiedInstants: string[] = []
): DraftScheduleEntry[] {
  validateTimezone(rules.timezone);
  const occupied = new Set(occupiedInstants.map((instant) => new Date(instant).toISOString()));
  const sorted = [...shorts].sort((a, b) => b.priority - a.priority || a.shortId.localeCompare(b.shortId));
  const result: DraftScheduleEntry[] = [];
  const episodeTimes = new Map<string, number[]>();
  const slots = legalSlots(rules, 730);

  for (const item of sorted) {
    const slot = slots.find((instant) => {
      const iso = instant.toISOString();
      if (occupied.has(iso) || result.some((entry) => entry.publishAt === iso)) return false;
      const prior = episodeTimes.get(item.episodeId) ?? [];
      const spacingMs = rules.minimumSameEpisodeSpacingHours * 3_600_000;
      return prior.every((time) => Math.abs(instant.getTime() - time) >= spacingMs);
    });
    if (!slot) throw new AppError("INVALID_STATE", `No legal slot found for Short ${item.shortId}`, 422);
    episodeTimes.set(item.episodeId, [...(episodeTimes.get(item.episodeId) ?? []), slot.getTime()]);
    result.push({
      id: randomUUID(), ...item, publishAt: slot.toISOString(), timezone: rules.timezone,
      rationale: `Priority ${item.priority}; earliest legal slot respecting cadence and episode spacing.`
    });
  }
  return result;
}

function legalSlots(rules: ScheduleRules, horizonDays: number): Date[] {
  const slots: Date[] = [];
  const start = parseDate(rules.startDate);
  for (let day = 0; day < horizonDays; day++) {
    const date = addUtcDays(start, day);
    const dateKey = formatDate(date);
    if (rules.blackoutDates.includes(dateKey) || !rules.allowedWeekdays.includes(date.getUTCDay())) continue;
    for (const time of rules.times.slice(0, rules.maxPerDay)) {
      const [hour, minute] = time.split(":").map(Number) as [number, number];
      slots.push(zonedLocalToUtc(dateKey, hour, minute, rules.timezone));
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

function zonedLocalToUtc(date: string, hour: number, minute: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = partsInZone(new Date(guess), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += desired - represented;
  }
  return new Date(guess);
}

function partsInZone(date: Date, timezone: string): Record<"year" | "month" | "day" | "hour" | "minute", number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as ReturnType<typeof partsInZone>;
}

function validateTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
  catch { throw new AppError("VALIDATION_ERROR", `Unknown timezone: ${timezone}`, 422); }
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new AppError("VALIDATION_ERROR", "Invalid start date", 422);
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
