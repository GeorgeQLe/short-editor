export interface StructuredLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const REDACTED_KEYS = /authorization|cookie|password|secret|token|databaseurl|connectionstring/i;

export function createJsonLogger(
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  configuredSecrets: ReadonlyArray<string> = []
): StructuredLogger {
  const write = (level: "info" | "error", event: string, fields = {}) => {
    sink(JSON.stringify(redact({
      timestamp: new Date().toISOString(), level, event, ...fields
    }, configuredSecrets)));
  };
  return {
    info: (event, fields) => write("info", event, fields),
    error: (event, fields) => write("error", event, fields)
  };
}

function redact(value: unknown, secrets: ReadonlyArray<string>): unknown {
  if (typeof value === "string") {
    return secrets.filter(Boolean).reduce(
      (result, secret) => result.split(secret).join("[redacted]"), value
    );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      REDACTED_KEYS.test(key) ? "[redacted]" : redact(item, secrets)
    ]));
  }
  return value;
}
