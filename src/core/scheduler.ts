import { randomUUID } from "node:crypto";
import {
  scheduleDstPolicyId,
  type ScheduleDraftEntry,
  type ScheduleDraftResult,
  type ScheduleDstWarning,
  type ScheduleRules,
  type SchedulableShort
} from "../shared/domain.js";
import { AppError } from "../shared/errors.js";

export type { SchedulableShort };

interface ResolvedSlot {
  instant: Date;
  warning?: ScheduleDstWarning;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

export function timezoneDatabaseVersion(): string {
  return process.versions.tz ?? "unknown";
}

export function draftSchedule(
  shorts: SchedulableShort[],
  rules: ScheduleRules,
  occupiedInstants: string[] = [],
  rulesRevision = 1
): ScheduleDraftResult {
  validateTimezone(rules.timezone);
  const occupied = new Set(occupiedInstants.map((instant) => new Date(instant).toISOString()));
  const sorted = [...shorts].sort((a, b) => b.priority - a.priority || a.shortId.localeCompare(b.shortId));
  const entries: ScheduleDraftEntry[] = [];
  const warnings: ScheduleDstWarning[] = [];
  const episodeTimes = new Map<string, number[]>();
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

export function resolveZonedWallTime(
  localDate: string,
  localTime: string,
  timezone: string
): ResolvedSlot {
  validateTimezone(timezone);
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const [hour, minute] = localTime.split(":").map(Number) as [number, number];
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const desiredParts: ZonedParts = { year, month, day, hour, minute, second: 0 };

  const offsets = new Set<number>();
  for (let hours = -72; hours <= 72; hours += 6) {
    const instant = desired + hours * 3_600_000;
    offsets.add(offsetAt(instant, timezone));
  }
  const candidates = [...offsets]
    .map((offset) => new Date(desired - offset))
    .filter((instant) => sameParts(partsInZone(instant, timezone), desiredParts))
    .sort((left, right) => left.getTime() - right.getTime())
    .filter((instant, index, all) => index === 0 || instant.getTime() !== all[index - 1]!.getTime());

  if (candidates.length === 1) return { instant: candidates[0]! };
  if (candidates.length > 1) {
    const selected = candidates[0]!;
    return {
      instant: selected,
      warning: {
        kind: "ambiguous_local_time",
        localDate,
        localTime,
        timezone,
        selectedUtcInstant: selected.toISOString(),
        alternativeUtcInstant: candidates[1]!.toISOString(),
        adjustmentMinutes: 0
      }
    };
  }

  const orderedOffsets = [...offsets].sort((left, right) => left - right);
  let beforeOffset: number | undefined;
  let gapMilliseconds = 0;
  for (let index = 1; index < orderedOffsets.length; index++) {
    const gap = orderedOffsets[index]! - orderedOffsets[index - 1]!;
    if (gap > gapMilliseconds) {
      beforeOffset = orderedOffsets[index - 1]!;
      gapMilliseconds = gap;
    }
  }
  if (beforeOffset === undefined || gapMilliseconds <= 0) {
    throw new AppError(
      "INVALID_STATE",
      `Could not resolve ${localDate} ${localTime} in ${timezone}`,
      422
    );
  }
  const selected = new Date(desired - beforeOffset);
  const shifted = partsInZone(selected, timezone);
  if (
    localPartsValue(shifted) - localPartsValue(desiredParts) !== gapMilliseconds
  ) {
    throw new AppError(
      "INVALID_STATE",
      `Could not apply the timezone gap policy for ${localDate} ${localTime} in ${timezone}`,
      422
    );
  }
  return {
    instant: selected,
    warning: {
      kind: "nonexistent_local_time",
      localDate,
      localTime,
      timezone,
      selectedUtcInstant: selected.toISOString(),
      adjustmentMinutes: gapMilliseconds / 60_000
    }
  };
}

function legalSlots(rules: ScheduleRules, horizonDays: number): ResolvedSlot[] {
  const slots: ResolvedSlot[] = [];
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

function offsetAt(instant: number, timezone: string): number {
  return localPartsValue(partsInZone(new Date(instant), timezone)) - instant;
}

function localPartsValue(parts: ZonedParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function sameParts(left: ZonedParts, right: ZonedParts): boolean {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second;
}

function partsInZone(date: Date, timezone: string): ZonedParts {
  let formatter = zoneFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    zoneFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as unknown as ZonedParts;
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
