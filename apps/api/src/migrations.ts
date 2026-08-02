import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATION_LOCK = 7_341_170_043;

export interface KnownMigration {
  version: string;
  checksum: string;
  sql: string;
}

export async function loadMigrations(directory = fileURLToPath(
  new URL("../migrations/", import.meta.url)
)): Promise<KnownMigration[]> {
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(`${directory}/${name}`, "utf8");
    return {
      version: name.replace(/\.sql$/, ""),
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql
    };
  }));
}

export async function runMigrations(pool: Pool, migrations?: KnownMigration[]): Promise<void> {
  const known = migrations ?? await loadMigrations();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query("SELECT version, checksum FROM schema_migrations");
    const checksums = new Map(applied.rows.map((row) => [row.version, row.checksum]));
    for (const migration of known) {
      const previous = checksums.get(migration.version);
      if (previous && previous !== migration.checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.version}`);
      }
      if (previous) continue;
      await client.query("BEGIN");
      try {
        await client.query(unwrapMigrationTransaction(migration.sql));
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [migration.version, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

export function unwrapMigrationTransaction(sql: string): string {
  const wrapped = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/i.exec(sql);
  return wrapped?.[1] ?? sql;
}

export async function migrationReadiness(
  pool: Pool,
  migrations?: KnownMigration[]
): Promise<{ ready: boolean; reason?: string }> {
  try {
    const known = migrations ?? await loadMigrations();
    await pool.query("SELECT 1");
    const result = await pool.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
    const expected = new Map(known.map((migration) => [migration.version, migration.checksum]));
    const applied = new Map(result.rows.map((row) => [row.version, row.checksum]));
    if (result.rows.some((row) => !expected.has(row.version))) {
      return { ready: false, reason: "schema_ahead" };
    }
    if (known.some((migration) => !applied.has(migration.version))) {
      return { ready: false, reason: "schema_stale" };
    }
    if (known.some((migration) => applied.get(migration.version) !== migration.checksum)) {
      return { ready: false, reason: "schema_modified" };
    }
    return { ready: true };
  } catch {
    return { ready: false, reason: "database_not_ready" };
  }
}
