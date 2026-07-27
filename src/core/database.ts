import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const migrations = [
  `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    canonical_path TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    content_hash TEXT,
    file_size INTEGER NOT NULL,
    modified_at_ms INTEGER NOT NULL,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    video_codec TEXT,
    audio_codec TEXT,
    status TEXT NOT NULL,
    missing INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS episodes_fingerprint_idx ON episodes(fingerprint);
  CREATE INDEX IF NOT EXISTS episodes_content_hash_idx ON episodes(content_hash);

  CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    words_json TEXT NOT NULL,
    speaker TEXT,
    confidence REAL
  );
  CREATE INDEX IF NOT EXISTS transcript_episode_time_idx
    ON transcript_segments(episode_id, start_ms);

  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    transcript TEXT NOT NULL,
    topic TEXT NOT NULL,
    hook TEXT NOT NULL,
    reason TEXT NOT NULL,
    score REAL NOT NULL,
    scores_json TEXT NOT NULL,
    duplicate_group TEXT,
    review_status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS short_projects (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    candidate_id TEXT REFERENCES candidates(id),
    title TEXT NOT NULL,
    source_ranges_json TEXT NOT NULL,
    template_id TEXT NOT NULL,
    composition_json TEXT NOT NULL,
    copy_json TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS renders (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL REFERENCES short_projects(id),
    project_revision INTEGER NOT NULL,
    output_path TEXT,
    encoder_json TEXT NOT NULL,
    validation_json TEXT,
    state TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_entries (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL REFERENCES short_projects(id),
    render_id TEXT NOT NULL REFERENCES renders(id),
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    publish_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    rationale TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    youtube_url TEXT,
    needs_rerender INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS schedule_publish_slot_idx ON schedule_entries(publish_at);

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entity_id TEXT,
    state TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS jobs_state_created_idx ON jobs(state, created_at);

  CREATE TABLE IF NOT EXISTS ai_artifacts (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    inputs_hash TEXT NOT NULL,
    output_json TEXT NOT NULL,
    accepted_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    provenance TEXT NOT NULL,
    reusable INTEGER NOT NULL DEFAULT 1,
    tags_json TEXT NOT NULL DEFAULT '[]',
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `
];

export type SqliteDatabase = Database.Database;

export function openDatabase(path: string): SqliteDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all()
      .map((row) => (row as { version: number }).version)
  );
  migrations.forEach((sql, index) => {
    const version = index + 1;
    if (applied.has(version)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
    })();
  });
  return db;
}
