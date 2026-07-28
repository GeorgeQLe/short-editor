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
      "cloud_authorizations", "jobs", "relink_comparisons", "candidate_generation_runs"
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

  it("migrates legacy Candidate history and Short copy without demoting accepted data", () => {
    const path = join(mkdtempSync(join(tmpdir(), "short-editor-candidate-migration-")), "fixture.db");
    const legacy = new Database(path);
    migrateDatabase(legacy, databaseMigrations.slice(0, 6));
    const episodeId = randomUUID();
    const candidateId = randomUUID();
    const shortId = randomUUID();
    const artifactId = randomUUID();
    const now = "2026-07-27T12:00:00.000Z";
    legacy.prepare(`
      INSERT INTO episodes(
        id,source_path,canonical_path,fingerprint,file_size,modified_at_ms,status,
        missing,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,?,?)
    `).run(episodeId, "/original.mp4", "/canonical.mp4", "fingerprint", 10, 20, "ready", now, now);
    legacy.prepare(`
      INSERT INTO candidates(
        id,episode_id,start_ms,end_ms,transcript,topic,hook,reason,score,
        scores_json,duplicate_group,review_status,created_at,generation_artifact_id,
        transcript_revision,generation_version,provider_provenance_json
      ) VALUES(?,?,0,30000,'Original transcript','Original topic','Original hook',
        'Original reason',0.8,?,NULL,'approved',?,?,1,'legacy-v1',NULL)
    `).run(
      candidateId,
      episodeId,
      JSON.stringify({
        hook: .8, coherence: .8, payoff: .8, independence: .8, delivery: .8,
        visualActivity: .8
      }),
      now,
      artifactId
    );
    const legacyCopy = {
      cleanedTranscript: "User copy", rewrite: "Edited", hookVariants: ["Hook"],
      titles: ["Title"], description: "Description", hashtags: ["legacy"],
      thumbnailText: "Thumbnail"
    };
    legacy.prepare(`
      INSERT INTO short_projects(
        id,episode_id,candidate_id,title,source_ranges_json,template_id,
        composition_json,copy_json,approved,revision,created_at,updated_at
      ) VALUES(?,?,?,'Legacy Short','[]','fullscreen-speaker-v1','{}',?,1,4,?,?)
    `).run(shortId, episodeId, candidateId, JSON.stringify(legacyCopy), now, now);
    legacy.close();

    const upgraded = openDatabase(path);
    databases.push(upgraded);
    expect(upgraded.prepare(`
      SELECT review_status,generation_run_id,revision,state,updated_at
      FROM candidates WHERE id=?
    `).get(candidateId)).toEqual({
      review_status: "approved",
      generation_run_id: null,
      revision: 1,
      state: "active",
      updated_at: now
    });
    const packageRow = upgraded.prepare(`
      SELECT raw_output_json,accepted_projection_json
      FROM analysis_artifacts WHERE entity_id=? AND kind='content_package'
    `).get(candidateId) as {
      raw_output_json: string;
      accepted_projection_json: string | null;
    };
    expect(JSON.parse(packageRow.raw_output_json)).toMatchObject({
      cleanedTranscript: "Original transcript",
      hookVariants: ["Original hook"],
      titles: ["Original topic"]
    });
    expect(packageRow.accepted_projection_json).toBeNull();
    const short = upgraded.prepare(`
      SELECT copy_json,copy_state,copy_source,revision FROM short_projects WHERE id=?
    `).get(shortId) as {
      copy_json: string; copy_state: string; copy_source: string; revision: number;
    };
    expect(JSON.parse(short.copy_json)).toEqual(legacyCopy);
    expect(short).toMatchObject({
      copy_state: "accepted", copy_source: "legacy_accepted", revision: 4
    });
  });

  it("normalizes legacy Template and Short composition layers without replacing snapshots", () => {
    const path = join(mkdtempSync(join(tmpdir(), "short-editor-composition-migration-")), "fixture.db");
    const legacy = new Database(path);
    migrateDatabase(legacy, databaseMigrations.slice(0, 7));
    const episodeId = randomUUID();
    const shortId = randomUUID();
    const now = "2026-07-27T12:00:00.000Z";
    const composition = {
      width: 1080,
      height: 1920,
      background: "#000",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      layers: [{
        id: "speaker",
        type: "video",
        source: "episode",
        region: { x: 0, y: 0, width: 1, height: 1 },
        fit: "fill",
        cropTrack: [
          { atMs: 0, x: 0, y: 0, width: 1, height: 1, source: "automatic" },
          { atMs: 500, x: 0.1, y: 0.1, width: 0.8, height: 0.8, source: "manual" }
        ]
      }]
    };
    legacy.prepare(`
      UPDATE templates SET composition_json=? WHERE id='fullscreen-speaker-v1'
    `).run(JSON.stringify(composition));
    legacy.prepare(`
      INSERT INTO episodes(
        id,source_path,canonical_path,fingerprint,file_size,modified_at_ms,status,
        missing,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,?,?)
    `).run(episodeId, "/original.mp4", "/canonical.mp4", "fingerprint", 10, 20, "ready", now, now);
    legacy.prepare(`
      INSERT INTO short_projects(
        id,episode_id,candidate_id,title,source_ranges_json,template_id,
        composition_json,copy_json,approved,revision,created_at,updated_at
      ) VALUES(?,?,NULL,'Legacy Short','[{"startMs":0,"endMs":1000}]',
        'fullscreen-speaker-v1',?,'{}',0,1,?,?)
    `).run(shortId, episodeId, JSON.stringify(composition), now, now);
    legacy.close();

    const upgraded = openDatabase(path);
    databases.push(upgraded);
    const templateComposition = JSON.parse(String((upgraded.prepare(`
      SELECT composition_json FROM templates WHERE id='fullscreen-speaker-v1'
    `).get() as { composition_json: string }).composition_json));
    const short = upgraded.prepare(`
      SELECT composition_json,template_lineage_json FROM short_projects WHERE id=?
    `).get(shortId) as { composition_json: string; template_lineage_json: string };
    expect(templateComposition.layers[0]).toMatchObject({
      id: "speaker",
      assetId: null,
      cropTarget: "person",
      automaticCropTrack: {
        frames: [{ atMs: 0, x: 0, y: 0, width: 1, height: 1 }],
        provenance: null,
        fallback: { mode: "none", reason: "none" }
      },
      manualCropTrack: [{
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        mode: "crop",
        atMs: 500,
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8
      }]
    });
    expect(JSON.parse(short.composition_json).layers[0]).toMatchObject({
      id: "speaker",
      assetId: null,
      cropTarget: "person",
      automaticCropTrack: {
        frames: [{ atMs: 0, x: 0, y: 0, width: 1, height: 1 }]
      },
      manualCropTrack: [{ mode: "crop", atMs: 500 }]
    });
    expect(JSON.parse(short.template_lineage_json)).toEqual({
      templateVersion: 1,
      parentTemplateId: null,
      templateId: "fullscreen-speaker-v1"
    });
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
