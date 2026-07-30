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
import { starterTemplates } from "../src/shared/templates";

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
      "cloud_authorizations", "jobs", "relink_comparisons", "candidate_generation_runs",
      "render_preflights"
    ]) expect(tables.has(table), table).toBe(true);
  });

  for (let version = 1; version <= CURRENT_SCHEMA_VERSION; version++) {
    it(`upgrades a version ${version} database without losing accepted records`, () => {
      const path = join(mkdtempSync(join(tmpdir(), "short-editor-migration-")), "fixture.db");
      const legacy = new Database(path);
      migrateDatabase(legacy, databaseMigrations.slice(0, version));
      const episodeId = randomUUID();
      const segmentId = randomUUID();
      const scheduleEntryId = randomUUID();
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
      legacy.pragma("foreign_keys = OFF");
      legacy.prepare(`
        INSERT INTO schedule_entries(
          id,short_id,render_id,episode_id,publish_at,timezone,status,priority,
          rationale,locked,youtube_url,needs_rerender,revision,created_at,updated_at
        ) VALUES(?,?,?,?,?,'America/New_York','draft',7,'preserve schedule',0,
          NULL,0,1,?,?)
      `).run(
        scheduleEntryId,
        randomUUID(),
        randomUUID(),
        episodeId,
        "2026-08-01T13:30:00.000Z",
        now,
        now
      );
      legacy.pragma("foreign_keys = ON");
      if (version >= 3) {
        legacy.prepare(`
          INSERT INTO schedule_rule_sets(
            id,revision,start_date,timezone,allowed_weekdays_json,times_json,
            max_per_day,blackout_dates_json,minimum_same_episode_spacing_hours,
            created_at,updated_at
          ) VALUES('default',3,'2026-07-27','America/New_York','[1,3,5]',
            '["09:30"]',1,'[]',48,?,?)
        `).run(now, now);
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
      expect(upgraded.prepare(`
        SELECT publish_at,rationale FROM schedule_entries WHERE id=?
      `).get(scheduleEntryId)).toEqual({
        publish_at: "2026-08-01T13:30:00.000Z",
        rationale: "preserve schedule"
      });
      if (version >= 3) {
        expect(upgraded.prepare(`
          SELECT revision,times_json,timezone_database_version
          FROM schedule_rule_sets WHERE id='default'
        `).get()).toEqual({
          revision: 3,
          times_json: "[\"09:30\"]",
          timezone_database_version: "unknown"
        });
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

  it("preserves legacy schedule rules with unknown timezone database diagnostics", () => {
    const db = new Database(":memory:");
    databases.push(db);
    migrateDatabase(db, databaseMigrations.slice(0, 15));
    const now = "2026-07-27T12:00:00.000Z";
    db.prepare(`
      INSERT INTO schedule_rule_sets(
        id,revision,start_date,timezone,allowed_weekdays_json,times_json,max_per_day,
        blackout_dates_json,minimum_same_episode_spacing_hours,created_at,updated_at
      ) VALUES('default',4,'2026-07-27','America/New_York','[1,3,5]',
        '["09:30","17:00"]',2,'["2026-12-25"]',48,?,?)
    `).run(now, now);
    migrateDatabase(db);
    expect(db.prepare(`
      SELECT revision,times_json,timezone_database_version
      FROM schedule_rule_sets WHERE id='default'
    `).get()).toEqual({
      revision: 4,
      times_json: "[\"09:30\",\"17:00\"]",
      timezone_database_version: "unknown"
    });
  });

  it("adds exactly one news built-in without replacing user templates", () => {
    const db = new Database(":memory:");
    databases.push(db);
    migrateDatabase(db, databaseMigrations.slice(0, 16));
    db.prepare("DELETE FROM templates WHERE id='news-brief-speaker-v1'").run();
    const now = "2026-07-29T12:00:00.000Z";
    db.prepare(`
      INSERT INTO templates(
        id,name,description,version,revision,parent_template_id,built_in,
        composition_json,created_at,updated_at
      ) VALUES('user-news','My News','keep me',3,4,'fullscreen-speaker-v1',0,?,?,?)
    `).run(JSON.stringify(starterTemplates[0]!.composition), now, now);
    migrateDatabase(db);
    expect(db.prepare(`
      SELECT id,name,built_in FROM templates WHERE id='news-brief-speaker-v1'
    `).get()).toEqual({
      id: "news-brief-speaker-v1",
      name: "News Brief + Speaker",
      built_in: 1
    });
    expect(db.prepare(`
      SELECT name,description,version,revision,built_in FROM templates WHERE id='user-news'
    `).get()).toEqual({
      name: "My News", description: "keep me", version: 3, revision: 4, built_in: 0
    });
    expect((db.prepare(`
      SELECT count(*) AS count FROM templates WHERE id='news-brief-speaker-v1'
    `).get() as { count: number }).count).toBe(1);
  });

  it("defaults every legacy template and Short composition layer to visible", () => {
    const db = new Database(":memory:");
    databases.push(db);
    migrateDatabase(db, databaseMigrations.slice(0, 17));
    const rows = db.prepare("SELECT id,composition_json FROM templates").all() as Array<{
      id: string;
      composition_json: string;
    }>;
    const update = db.prepare("UPDATE templates SET composition_json=? WHERE id=?");
    for (const row of rows) {
      const composition = JSON.parse(row.composition_json) as { layers: Record<string, unknown>[] };
      update.run(JSON.stringify({
        ...composition,
        layers: composition.layers.map(({ visible: _visible, ...layer }) => layer)
      }), row.id);
    }
    migrateDatabase(db);
    const migrated = db.prepare("SELECT composition_json FROM templates").all() as Array<{
      composition_json: string;
    }>;
    expect(migrated.length).toBeGreaterThan(0);
    expect(migrated.every((row) => {
      const composition = JSON.parse(row.composition_json) as { layers: Array<{ visible?: unknown }> };
      return composition.layers.every((layer) => layer.visible === true);
    })).toBe(true);
  });

  it("demotes pre-RND-03 successes while preserving their legacy outputs", () => {
    const path = join(mkdtempSync(join(tmpdir(), "short-editor-determinism-migration-")), "fixture.db");
    const legacy = new Database(path);
    migrateDatabase(legacy, databaseMigrations.slice(0, 13));
    const episodeId = randomUUID();
    const shortId = randomUUID();
    const renderId = randomUUID();
    const now = "2026-07-27T12:00:00.000Z";
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
        'fullscreen-speaker-v1','{}','{}',1,1,?,?)
    `).run(shortId, episodeId, now, now);
    legacy.prepare(`
      INSERT INTO renders(
        id,short_id,project_revision,output_path,sidecar_path,encoder_json,
        validation_json,state,content_hash,decision_hash,created_at,updated_at
      ) VALUES(?,?,1,'artifacts/renders/legacy/final.mp4',
        'artifacts/renders/legacy/captions.srt','{}','{}','succeeded',
        'sha256:legacy','sha256:decision',?,?)
    `).run(renderId, shortId, now, now);
    legacy.close();

    const upgraded = openDatabase(path);
    databases.push(upgraded);
    expect(upgraded.prepare(`
      SELECT state,output_path,sidecar_path,determinism_json,error_code,error_message,
        lineage_id,previous_render_id,attempt
      FROM renders WHERE id=?
    `).get(renderId)).toEqual({
      state: "stale",
      output_path: "artifacts/renders/legacy/final.mp4",
      sidecar_path: "artifacts/renders/legacy/captions.srt",
      determinism_json: null,
      error_code: "INVALID_STATE",
      error_message: "Rerender required: this output predates normalized determinism evidence.",
      lineage_id: renderId,
      previous_render_id: null,
      attempt: 1
    });
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

  it("migrates legacy caption segments and Arial/Inter styles without losing cue data", () => {
    const path = join(mkdtempSync(join(tmpdir(), "short-editor-caption-migration-")), "fixture.db");
    const legacy = new Database(path);
    migrateDatabase(legacy, databaseMigrations.slice(0, 9));
    const episodeId = randomUUID();
    const shortId = randomUUID();
    const cueId = randomUUID();
    const now = "2026-07-28T12:00:00.000Z";
    legacy.prepare(`
      INSERT INTO episodes(
        id,source_path,canonical_path,fingerprint,file_size,modified_at_ms,status,
        missing,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,?,?)
    `).run(episodeId, "/original.mp4", "/canonical.mp4", "fingerprint", 10, 20, "ready", now, now);
    const legacyCaptions = {
      enabled: true,
      segments: [{
        id: cueId,
        startMs: 100,
        endMs: 1_000,
        text: "Preserve\nthis",
        words: [{
          startMs: 100,
          endMs: 500,
          text: "Preserve",
          confidence: 0.9,
          speaker: "speaker"
        }],
        speaker: "speaker",
        confidence: 0.9
      }],
      style: {
        fontFamily: "Arial",
        fontSize: 72,
        color: "#eeeeee",
        highlightColor: "#ff0000"
      }
    };
    legacy.prepare(`
      INSERT INTO short_projects(
        id,episode_id,candidate_id,title,source_ranges_json,template_id,
        composition_json,copy_json,approved,revision,created_at,updated_at,
        template_lineage_json,captions_json,audio_json,copy_state,copy_source
      ) VALUES(?,?,NULL,'Legacy captions','[{"startMs":0,"endMs":2000}]',
        'fullscreen-speaker-v1',?,'{}',0,3,?,?,?,?,?,'accepted','legacy_accepted')
    `).run(
      shortId,
      episodeId,
      JSON.stringify(starterTemplates[0]!.composition),
      now,
      now,
      JSON.stringify({ templateVersion: 1, parentTemplateId: null }),
      JSON.stringify(legacyCaptions),
      JSON.stringify({
        sourceGainDb: 0,
        muted: false,
        fadeInMs: 0,
        fadeOutMs: 0,
        bedAssetId: null,
        bedGainDb: null,
        normalizeLoudness: false
      })
    );
    legacy.close();

    const upgraded = openDatabase(path);
    databases.push(upgraded);
    const row = upgraded.prepare(
      "SELECT captions_json,revision FROM short_projects WHERE id=?"
    ).get(shortId) as { captions_json: string; revision: number };
    expect(JSON.parse(row.captions_json)).toEqual({
      enabled: true,
      cues: [{
        id: cueId,
        startMs: 100,
        endMs: 1_000,
        text: "Preserve\nthis",
        words: [{ startMs: 100, endMs: 500, text: "Preserve" }]
      }],
      style: {
        fontFamily: "Inter",
        fontWeight: 400,
        fontSizePx: 72,
        position: { x: 0.5, y: 0.78 },
        maxWidth: 0.82,
        textColor: "#eeeeee",
        highlightColor: "#ff0000",
        textTransform: "none",
        outline: { color: "#000000", widthPx: 4 },
        background: { color: "#00000000", paddingPx: 12, cornerRadiusPx: 8 }
      },
      warnings: [],
      sidecars: { srt: null, webvtt: null }
    });
    expect(row.revision).toBe(3);
  });

  it("migrates legacy audio settings, bindings, bounds, and warnings deterministically", () => {
    const path = join(mkdtempSync(join(tmpdir(), "short-editor-audio-migration-")), "fixture.db");
    const legacy = new Database(path);
    migrateDatabase(legacy, databaseMigrations.slice(0, 10));
    const episodeId = randomUUID();
    const audioId = randomUUID();
    const imageId = randomUUID();
    const now = "2026-07-28T12:00:00.000Z";
    legacy.prepare(`
      INSERT INTO episodes(
        id,source_path,canonical_path,fingerprint,file_size,modified_at_ms,status,
        missing,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,?,?)
    `).run(episodeId, "/original.mp4", "/canonical.mp4", "fingerprint", 10, 20, "ready", now, now);
    const insertAsset = legacy.prepare(`
      INSERT INTO assets(
        id,source_path,owned_artifact_path,kind,provenance,reusable,tags_json,
        width,height,duration_ms,created_at,updated_at
      ) VALUES(?, ?, NULL, ?, 'fixture', 1, '[]', ?, ?, ?, ?, ?)
    `);
    insertAsset.run(audioId, "/bed.mp3", "audio", null, null, 1_000, now, now);
    insertAsset.run(imageId, "/still.png", "image", 100, 100, null, now, now);
    const insertShort = legacy.prepare(`
      INSERT INTO short_projects(
        id,episode_id,candidate_id,title,source_ranges_json,template_id,
        composition_json,copy_json,approved,revision,created_at,updated_at,
        template_lineage_json,captions_json,audio_json,copy_state,copy_source
      ) VALUES(?,?,NULL,?,'[{"startMs":0,"endMs":2000}]',
        'fullscreen-speaker-v1',?,'{}',0,7,?,?,?,?,?,'accepted','legacy_accepted')
    `);
    const cases = [
      {
        title: "defaults",
        legacy: {},
        expected: {
          sourceGainDb: 0, sourceMuted: false, cutFadeMs: 0,
          bedAssetId: null, bedGainDb: null, warnings: []
        }
      },
      {
        title: "valid missing gain",
        legacy: {
          sourceGainDb: 99,
          muted: true,
          fadeInMs: 20,
          fadeOutMs: 900,
          bedAssetId: audioId,
          normalizeLoudness: true
        },
        expected: {
          sourceGainDb: 12, sourceMuted: true, cutFadeMs: 500,
          bedAssetId: audioId, bedGainDb: -18,
          warnings: [{
            code: "AUDIO_SPEECH_BACKGROUND_RATIO",
            message: "Background audio is enabled while the Episode source is muted"
          }]
        }
      },
      {
        title: "clamped gain",
        legacy: {
          sourceGainDb: -100,
          muted: false,
          fadeInMs: 101,
          fadeOutMs: 202,
          bedAssetId: audioId,
          bedGainDb: -100
        },
        expected: {
          sourceGainDb: -60, sourceMuted: false, cutFadeMs: 202,
          bedAssetId: audioId, bedGainDb: -60,
          warnings: [{
            code: "AUDIO_SPEECH_BACKGROUND_RATIO",
            message: "Background audio is less than 12 dB below the Episode source"
          }]
        }
      },
      {
        title: "invalid binding",
        legacy: {
          sourceGainDb: 0,
          muted: false,
          bedAssetId: imageId,
          bedGainDb: -3
        },
        expected: {
          sourceGainDb: 0, sourceMuted: false, cutFadeMs: 0,
          bedAssetId: null, bedGainDb: null, warnings: []
        }
      }
    ];
    const ids = new Map<string, string>();
    for (const value of cases) {
      const shortId = randomUUID();
      ids.set(value.title, shortId);
      insertShort.run(
        shortId,
        episodeId,
        value.title,
        JSON.stringify(starterTemplates[0]!.composition),
        now,
        now,
        JSON.stringify({
          templateId: "fullscreen-speaker-v1",
          templateVersion: 1,
          parentTemplateId: null
        }),
        JSON.stringify({
          enabled: true,
          cues: [],
          style: {
            fontFamily: "Inter", fontWeight: 400, fontSizePx: 64,
            position: { x: 0.5, y: 0.78 }, maxWidth: 0.82,
            textColor: "#ffffff", highlightColor: "#ffdc5e",
            outline: { color: "#000000", widthPx: 4 },
            background: { color: "#00000000", paddingPx: 12, cornerRadiusPx: 8 }
          },
          warnings: [],
          sidecars: { srt: null, webvtt: null }
        }),
        JSON.stringify(value.legacy)
      );
    }
    legacy.close();

    const upgraded = openDatabase(path);
    databases.push(upgraded);
    for (const value of cases) {
      const row = upgraded.prepare(
        "SELECT audio_json,revision FROM short_projects WHERE id=?"
      ).get(ids.get(value.title)) as { audio_json: string; revision: number };
      expect(JSON.parse(row.audio_json), value.title).toEqual(value.expected);
      expect(row.revision, value.title).toBe(7);
      expect(row.audio_json, value.title).not.toContain("normalizeLoudness");
    }
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
