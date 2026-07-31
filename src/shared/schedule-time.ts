import type { ScheduleDstWarning } from "./contracts.js";
import { AppError } from "./errors.js";

export interface ResolvedScheduleSlot {
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

export function resolveZonedWallTime(
  localDate: string,
  localTime: string,
  timezone: string
): ResolvedScheduleSlot {
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
    .filter((instant, index, all) =>
      index === 0 || instant.getTime() !== all[index - 1]!.getTime()
    );

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
  if (localPartsValue(shifted) - localPartsValue(desiredParts) !== gapMilliseconds) {
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

export function dateKeyInZone(instant: string | Date, timezone: string): string {
  const parts = partsInZone(typeof instant === "string" ? new Date(instant) : instant, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatInstantInZone(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(instant));
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
