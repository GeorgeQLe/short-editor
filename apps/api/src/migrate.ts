import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createJsonLogger } from "./logging.js";
import { runMigrations } from "./migrations.js";

export async function migrate(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try { await runMigrations(pool); }
  finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrl = process.env.MIGRATOR_DATABASE_URL;
  const logger = createJsonLogger(undefined, databaseUrl ? [databaseUrl] : []);
  if (!databaseUrl) {
    logger.error("migration_failed", { message: "MIGRATOR_DATABASE_URL is required" });
    process.exitCode = 1;
  } else {
    void migrate(databaseUrl).then(
      () => logger.info("migration_complete"),
      () => { logger.error("migration_failed", { message: "Migration failed" }); process.exitCode = 1; }
    );
  }
}
