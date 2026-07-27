import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  databaseMigrations,
  migrateDatabase,
  MigrationError,
  openDatabase
} from "../src/core/database";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.open && db.close()));

describe("database migrations", () => {
  it("creates and records the complete schema in order", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect((db.prepare(
      "SELECT version FROM schema_migrations ORDER BY version"
    ).all() as { version: number }[]).map((row) => row.version))
      .toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1));
    expect((db.prepare(
      "SELECT applied_at FROM schema_migrations"
    ).all() as { applied_at: string }[]).every((row) => row.applied_at.endsWith("Z"))).toBe(true);

    const tables = new Set((db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all() as { name: string }[]).map((row) => row.name));
    for (const table of [
      "watched_folders", "transcript_revisions", "analysis_artifacts", "templates",
      "assets", "artifact_records", "renders", "schedule_rule_sets", "schedule_entries",
      "cloud_authorizations", "jobs"
    ]) expect(tables.has(table), table).toBe(true);
  });

  for (let version = 1; version <= CURRENT_SCHEMA_VERSION; version++) {
    it(`upgrades a version ${version} database without losing accepted records`, () => {
      const path = join(mkdtempSync(join(tmpdir(), "short-editor-migration-")), "fixture.db");
      const legacy = new Database(path);
      migrateDatabase(legacy, databaseMigrations.slice(0, version));
      const episodeId = randomUUID();
      const segmentId = randomUUID();
      const now = "2026-07-27T12:00:00.000Z";
      legacy.prepare(`
        INSERT INTO episodes(
          id,source_path,canonical_path,fingerprint,file_size,modified_at_ms,status,
          missing,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,0,?,?)
      `).run(episodeId, "/original.mp4", "/canonical.mp4", "fingerprint", 10, 20, "ready", now, now);
      legacy.prepare(`
        INSERT INTO transcript_segments(
          id,episode_id,start_ms,end_ms,text,words_json,speaker,confidence
        ) VALUES(?,?,0,1000,'preserve me','[]','speaker',0.9)
      `).run(segmentId, episodeId);
      if (version >= 3) {
        legacy.prepare(`
          INSERT INTO transcript_revisions(
            id,episode_id,revision,language,segments_json,provenance_json,
            accepted_state,created_at,updated_at
          ) VALUES(?, ?, 1, 'en', ?, ?, 'accepted', ?, ?)
        `).run(
          randomUUID(),
          episodeId,
          JSON.stringify([{
            id: segmentId, startMs: 0, endMs: 1000, text: "preserve me",
            words: [], speaker: "speaker", confidence: 0.9
          }]),
          JSON.stringify({
            provider: "fixture", providerClass: "local", modelId: "fixture",
            providerVersion: "1", optionsVersion: "1", createdAt: now
          }),
          now,
          now
        );
      }
      if (version >= 2) {
        legacy.prepare(`
          INSERT INTO assets(
            id,source_path,kind,provenance,reusable,tags_json,created_at,updated_at
          ) VALUES(?,?,'image','fixture',1,'["tag"]',?,?)
        `).run(randomUUID(), "/asset.png", now, now);
      }
      legacy.close();

      const upgraded = openDatabase(path);
      databases.push(upgraded);
      expect(upgraded.prepare("SELECT source_path FROM episodes WHERE id=?").get(episodeId))
        .toEqual({ source_path: "/original.mp4" });
      expect(upgraded.prepare(
        "SELECT text,words_json FROM transcript_segments WHERE id=?"
      ).get(segmentId)).toEqual({ text: "preserve me", words_json: "[]" });
      expect(upgraded.prepare(`
        SELECT revision,accepted_state FROM transcript_revisions WHERE episode_id=?
      `).get(episodeId)).toEqual({ revision: 1, accepted_state: "accepted" });
      if (version >= 2) {
        expect(upgraded.prepare("SELECT source_path,tags_json FROM assets").get())
          .toEqual({ source_path: "/asset.png", tags_json: "[\"tag\"]" });
      }
    });
  }

  it("rolls an interrupted migration back completely", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    expect(() => migrateDatabase(db, [
      ...databaseMigrations,
      {
        version: CURRENT_SCHEMA_VERSION + 1,
        name: "injected interruption",
        up(database: Database.Database) {
          database.exec("CREATE TABLE migration_partial(value TEXT)");
          throw new Error("simulated power loss");
        }
      }
    ])).toThrow(MigrationError);
    expect(db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='migration_partial'
    `).get()).toBeUndefined();
    expect(db.prepare(
      "SELECT 1 FROM schema_migrations WHERE version=?"
    ).get(CURRENT_SCHEMA_VERSION + 1)).toBeUndefined();
  });

  it("keeps foreign-key enforcement active", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    expect(() => db.prepare(`
      INSERT INTO transcript_revisions(
        id,episode_id,revision,language,segments_json,provenance_json,
        accepted_state,created_at,updated_at
      ) VALUES(?, ?, 1, 'en', '[]', '{}', 'accepted', ?, ?)
    `).run(randomUUID(), randomUUID(), new Date().toISOString(), new Date().toISOString()))
      .toThrow(/FOREIGN KEY/);
  });
});
