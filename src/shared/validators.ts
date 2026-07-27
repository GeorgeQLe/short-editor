import { z } from "zod";

export const idSchema = z.string().uuid();
export const uuidSchema = idSchema;
export type Id = z.infer<typeof idSchema>;

export const utcInstantSchema = z.string().datetime({ offset: false }).refine(
  (value) => value.endsWith("Z"),
  "Timestamp must be a UTC Z instant"
);

export const ianaTimezoneSchema = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}, "Unknown IANA timezone");

export const positiveRevisionSchema = z.number().int().positive();
export const revisionSchema = positiveRevisionSchema;
export const dateSchema = z.string().date();
export const wallTimeSchema = z.string().regex(
  /^(?:[01]\d|2[0-3]):[0-5]\d$/,
  "Wall time must be HH:mm"
);

export const normalizedRectangleSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1)
}).superRefine((rectangle, context) => {
  if (rectangle.x + rectangle.width > 1) {
    context.addIssue({ code: "custom", path: ["width"], message: "Rectangle exceeds horizontal bounds" });
  }
  if (rectangle.y + rectangle.height > 1) {
    context.addIssue({ code: "custom", path: ["height"], message: "Rectangle exceeds vertical bounds" });
  }
});
export const normalizedRectSchema = normalizedRectangleSchema;
export type NormalizedRectangle = z.infer<typeof normalizedRectangleSchema>;

export const timeRangeSchema = z.strictObject({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive()
}).refine((range) => range.endMs > range.startMs, {
  path: ["endMs"],
  message: "Range end must be after its start"
});
export type TimeRange = z.infer<typeof timeRangeSchema>;

export function orderedNonOverlappingRangesSchema<T extends z.ZodType<TimeRange>>(rangeSchema: T) {
  return z.array(rangeSchema).min(1).superRefine((ranges, context) => {
    for (let index = 1; index < ranges.length; index++) {
      if (ranges[index]!.startMs < ranges[index - 1]!.endMs) {
        context.addIssue({
          code: "custom",
          path: [index, "startMs"],
          message: "Ranges must be ordered and non-overlapping"
        });
      }
    }
  });
}

export const sourceRangeSchema = timeRangeSchema;
export const sourceRangesSchema = orderedNonOverlappingRangesSchema(sourceRangeSchema);
