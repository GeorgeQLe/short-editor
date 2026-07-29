export const DIAGNOSTIC_EXPORT_POLICY_VERSION = "diagnostic-export-v1";

export interface DiagnosticExportOptions {
  includeSensitive?: boolean;
}

const credentialKey =
  /(?:authorization|cookie|credential|password|passphrase|secret|token|api[-_]?key|access[-_]?key|private[-_]?key)/i;
const sensitiveKey = /(?:path|source|transcript)/i;
const credentialValue =
  /(?:\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bA(?:KI|SI)A[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/gi;
const absolutePath = /(?:[A-Za-z]:\\[^\s"']+|\/(?:Users|home|private|var|tmp)\/[^\s"']+)/g;

/**
 * Produces a JSON-safe diagnostic payload. Credential-bearing fields are
 * always removed. Transcript/source/path fields require an explicit opt-in,
 * and recognizable credential strings are redacted even inside allowed text.
 */
export function filterDiagnosticExport(
  value: unknown,
  options: DiagnosticExportOptions = {}
): unknown {
  return filterValue(value, options.includeSensitive === true, new WeakSet<object>());
}

function filterValue(value: unknown, includeSensitive: boolean, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return redactText(value, includeSensitive);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const filtered = value.map((item) => filterValue(item, includeSensitive, seen));
    seen.delete(value);
    return filtered;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const filtered: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (credentialKey.test(key)) continue;
    if (!includeSensitive && sensitiveKey.test(key)) continue;
    filtered[key] = filterValue(item, includeSensitive, seen);
  }
  seen.delete(value);
  return filtered;
}

function redactText(value: string, includeSensitive: boolean): string {
  const credentialsRedacted = value.replace(credentialValue, "[credential redacted]");
  return includeSensitive
    ? credentialsRedacted
    : credentialsRedacted.replace(absolutePath, "[path redacted]");
}
