import { createHash } from "node:crypto";
import {
  analysisCacheIdentityInputSchema,
  type AnalysisCacheIdentityInput
} from "../shared/domain.js";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function analysisCacheIdentity(input: AnalysisCacheIdentityInput): string {
  const validated = analysisCacheIdentityInputSchema.parse(input);
  return `sha256:${createHash("sha256").update(canonicalJson(validated)).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, sortJson(child)])
  );
}
