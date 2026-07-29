import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { starterTemplates } from "../shared/templates.js";

export type SqliteDatabase = Database.Database;
export type Migration = {
  version: number;
  name: string;
  up: (db: SqliteDatabase) => void;
};

const initialSchema = `
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
`;

const completePersistenceSchema = `
CREATE TABLE watched_folders (
  id TEXT PRIMARY KEY,
  canonical_path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  recursive INTEGER NOT NULL CHECK(recursive IN (0,1)),
  include_patterns_json TEXT NOT NULL,
  last_scan_status TEXT NOT NULL,
  last_scanned_at TEXT,
  last_scan_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE transcript_revisions (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  language TEXT NOT NULL,
  segments_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  accepted_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(episode_id, revision)
);
CREATE UNIQUE INDEX transcript_one_accepted_idx
  ON transcript_revisions(episode_id) WHERE accepted_state='accepted';

CREATE TABLE analysis_artifacts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  raw_output_json TEXT NOT NULL,
  accepted_projection_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX analysis_artifact_cache_idx
  ON analysis_artifacts(entity_id, kind, input_hash, state);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  revision INTEGER NOT NULL CHECK(revision > 0),
  parent_template_id TEXT REFERENCES templates(id),
  built_in INTEGER NOT NULL CHECK(built_in IN (0,1)),
  composition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE artifact_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_revision INTEGER,
  relative_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  producer_version TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE schedule_rule_sets (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision > 0),
  start_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  allowed_weekdays_json TEXT NOT NULL,
  times_json TEXT NOT NULL,
  max_per_day INTEGER NOT NULL CHECK(max_per_day > 0),
  blackout_dates_json TEXT NOT NULL,
  minimum_same_episode_spacing_hours INTEGER NOT NULL CHECK(minimum_same_episode_spacing_hours >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cloud_authorizations (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('project','batch')),
  scope_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation_classes_json TEXT NOT NULL,
  credential_handle TEXT,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(scope_type, scope_id, provider)
);
`;

const migrations: readonly Migration[] = [
  { version: 1, name: "initial schema", up: (db) => db.exec(initialSchema) },
  {
    version: 2,
    name: "asset library",
    up: (db) => db.exec(`
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
      )
    `)
  },
  {
    version: 3,
    name: "complete domain persistence",
    up: (db) => {
      db.exec(completePersistenceSchema);
      db.exec(`
        ALTER TABLE candidates ADD COLUMN generation_artifact_id TEXT;
        ALTER TABLE candidates ADD COLUMN transcript_revision INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE candidates ADD COLUMN generation_version TEXT NOT NULL DEFAULT 'legacy-v1';
        ALTER TABLE candidates ADD COLUMN provider_provenance_json TEXT;

        ALTER TABLE short_projects ADD COLUMN template_lineage_json TEXT
          NOT NULL DEFAULT '{"templateVersion":1,"parentTemplateId":null}';
        ALTER TABLE short_projects ADD COLUMN captions_json TEXT
          NOT NULL DEFAULT '{"enabled":true,"segments":[],"style":{"fontFamily":"Arial","fontSize":64,"color":"#ffffff","highlightColor":"#ffdc5e"}}';
        ALTER TABLE short_projects ADD COLUMN audio_json TEXT
          NOT NULL DEFAULT '{"sourceGainDb":0,"muted":false,"fadeInMs":0,"fadeOutMs":0,"bedAssetId":null,"bedGainDb":null,"normalizeLoudness":false}';

        ALTER TABLE renders ADD COLUMN error_message TEXT;
        ALTER TABLE renders ADD COLUMN content_hash TEXT;
        ALTER TABLE renders ADD COLUMN decision_hash TEXT;
        ALTER TABLE renders ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;

        ALTER TABLE jobs ADD COLUMN provider TEXT;
        ALTER TABLE jobs ADD COLUMN payload_reference TEXT;
      `);
      db.exec(`
        CREATE TABLE assets_v3 (
          id TEXT PRIMARY KEY,
          source_path TEXT,
          owned_artifact_path TEXT,
          kind TEXT NOT NULL,
          provenance TEXT NOT NULL,
          reusable INTEGER NOT NULL CHECK(reusable IN (0,1)),
          tags_json TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          duration_ms INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK((source_path IS NULL) <> (owned_artifact_path IS NULL))
        );
        INSERT INTO assets_v3
          (id,source_path,owned_artifact_path,kind,provenance,reusable,tags_json,
           width,height,duration_ms,created_at,updated_at)
          SELECT id,source_path,NULL,kind,provenance,reusable,tags_json,
            width,height,duration_ms,created_at,updated_at FROM assets;
        DROP TABLE assets;
        ALTER TABLE assets_v3 RENAME TO assets;
      `);
      migrateLegacyTranscripts(db);
      migrateLegacyAnalysisArtifacts(db);
      const insertTemplate = db.prepare(`
        INSERT INTO templates(
          id,name,description,version,revision,parent_template_id,built_in,
          composition_json,created_at,updated_at
        ) VALUES(@id,@name,@description,@version,@revision,@parentTemplateId,1,
          @composition,@createdAt,@updatedAt)
      `);
      for (const template of starterTemplates) {
        insertTemplate.run({
          ...template,
          composition: JSON.stringify(template.composition)
        });
      }
    }
  },
  {
    version: 4,
    name: "artifact store paths",
    up: (db) => {
      db.exec(`
        UPDATE artifact_records
        SET relative_path='artifacts/' || relative_path
        WHERE relative_path NOT LIKE 'artifacts/%';
        UPDATE assets
        SET owned_artifact_path='artifacts/' || owned_artifact_path
        WHERE owned_artifact_path IS NOT NULL
          AND owned_artifact_path NOT LIKE 'artifacts/%';
        UPDATE renders
        SET output_path='artifacts/' || output_path
        WHERE output_path IS NOT NULL
          AND output_path NOT LIKE 'artifacts/%';
      `);
    }
  },
  {
    version: 5,
    name: "source reconciliation and relinking",
    up: (db) => {
      db.exec(`
        ALTER TABLE episodes ADD COLUMN relink_restore_status TEXT
          CHECK(relink_restore_status IN ('discovered','ready','indexing'));

        CREATE TABLE relink_comparisons (
          id TEXT PRIMARY KEY,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          candidate_path TEXT NOT NULL,
          canonical_path TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          modified_at_ms INTEGER NOT NULL,
          probe_json TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX relink_comparison_episode_idx
          ON relink_comparisons(episode_id, expires_at);
      `);
    }
  },
  {
    version: 6,
    name: "successful analysis cache uniqueness",
    up: (db) => {
      db.exec(`
        WITH ranked AS (
          SELECT id,ROW_NUMBER() OVER (
            PARTITION BY entity_id,kind,input_hash
            ORDER BY CASE state WHEN 'accepted' THEN 0 ELSE 1 END,created_at DESC,id
          ) cache_rank
          FROM analysis_artifacts
          WHERE kind='episode_analysis' AND state IN ('proposed','accepted')
        )
        UPDATE analysis_artifacts
        SET state='superseded'
        WHERE id IN (SELECT id FROM ranked WHERE cache_rank>1);
        CREATE UNIQUE INDEX analysis_artifact_success_cache_unique_idx
          ON analysis_artifacts(entity_id,kind,input_hash)
          WHERE kind='episode_analysis' AND state IN ('proposed','accepted');
      `);
    }
  },
  {
    version: 7,
    name: "candidate generation lineage and accepted copy",
    up: (db) => {
      db.exec(`
        CREATE TABLE candidate_generation_runs (
          id TEXT PRIMARY KEY,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          transcript_revision INTEGER NOT NULL CHECK(transcript_revision > 0),
          mode TEXT NOT NULL CHECK(mode IN ('heuristic','analysis')),
          analysis_artifact_id TEXT,
          provider_provenance_json TEXT,
          strategy TEXT NOT NULL CHECK(strategy IN ('replace_pending','append_pending')),
          generation_version TEXT NOT NULL,
          requested_count INTEGER NOT NULL,
          proposed_count INTEGER NOT NULL,
          inserted_count INTEGER NOT NULL,
          retained_decision_conflict_count INTEGER NOT NULL,
          retained_pending_conflict_count INTEGER NOT NULL,
          diagnostic_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX candidate_generation_run_episode_idx
          ON candidate_generation_runs(episode_id, created_at);

        ALTER TABLE candidates ADD COLUMN generation_run_id TEXT
          REFERENCES candidate_generation_runs(id);
        ALTER TABLE candidates ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE candidates ADD COLUMN state TEXT NOT NULL DEFAULT 'active'
          CHECK(state IN ('active','superseded'));
        ALTER TABLE candidates ADD COLUMN updated_at TEXT;
        UPDATE candidates SET updated_at=created_at WHERE updated_at IS NULL;
        CREATE INDEX candidate_episode_state_idx
          ON candidates(episode_id, state, review_status);

        ALTER TABLE short_projects ADD COLUMN copy_state TEXT NOT NULL DEFAULT 'accepted'
          CHECK(copy_state IN ('proposed','accepted'));
        ALTER TABLE short_projects ADD COLUMN copy_source TEXT NOT NULL DEFAULT 'legacy_accepted'
          CHECK(copy_source IN (
            'candidate_proposal','candidate_accepted','user_accepted','legacy_accepted'
          ));
      `);
      const legacyCandidates = db.prepare(`
        SELECT * FROM candidates
        WHERE NOT EXISTS (
          SELECT 1 FROM analysis_artifacts a
          WHERE a.entity_id=candidates.id AND a.owner_type='candidate'
            AND a.kind='content_package'
        )
      `).all() as Record<string, unknown>[];
      const insertPackage = db.prepare(`
        INSERT INTO analysis_artifacts(
          id,entity_id,owner_type,kind,state,provenance_json,input_hash,
          raw_output_json,accepted_projection_json,created_at
        ) VALUES(?,?,'candidate','content_package','proposed',?,?,?,NULL,?)
      `);
      for (const candidate of legacyCandidates) {
        const proposed = {
          cleanedTranscript: String(candidate.transcript),
          rewrite: "",
          hookVariants: [String(candidate.hook)],
          titles: [String(candidate.topic)],
          description: "",
          hashtags: [],
          thumbnailText: ""
        };
        const createdAt = String(candidate.created_at);
        const provenance = candidate.provider_provenance_json
          ? JSON.parse(String(candidate.provider_provenance_json))
          : {
            provider: "short-editor",
            providerClass: "local",
            modelId: "legacy-candidate-content-seed",
            providerVersion: String(candidate.generation_version),
            optionsVersion: "1",
            createdAt
          };
        const identity = JSON.stringify({
          transcriptRevision: Number(candidate.transcript_revision),
          generationRunId: null,
          generationVersion: String(candidate.generation_version),
          analysisArtifactId: candidate.generation_artifact_id
            ? String(candidate.generation_artifact_id)
            : null,
          provider: provenance,
          proposed: normalizeLegacyContentPackageIdentity(proposed)
        });
        insertPackage.run(
          legacyUuid(`candidate-content:${candidate.id}`),
          String(candidate.id),
          JSON.stringify(provenance),
          createHash("sha256").update(identity).digest("hex"),
          JSON.stringify(proposed),
          createdAt
        );
      }
    }
  },
  {
    version: 8,
    name: "template lineage and asset-bound composition layers",
    up: (db) => {
      normalizeCompositionLayers(db, "templates");
      normalizeCompositionLayers(db, "short_projects");
      db.prepare(`
        UPDATE short_projects
        SET template_lineage_json=json_set(
          template_lineage_json,
          '$.templateId',
          template_id
        )
        WHERE json_valid(template_lineage_json)
          AND json_extract(template_lineage_json, '$.templateId') IS NULL
      `).run();
    }
  },
  {
    version: 9,
    name: "independent automatic and manual crop tracks",
    up: (db) => {
      migrateCompositionCropTracks(db, "templates");
      migrateCompositionCropTracks(db, "short_projects");
    }
  },
  {
    version: 10,
    name: "editable captions and sidecar references",
    up: (db) => migrateCaptionState(db)
  },
  {
    version: 11,
    name: "deterministic source and bed audio",
    up: (db) => migrateAudioState(db)
  },
  {
    version: 12,
    name: "immutable render preflights",
    up: (db) => db.exec(`
      CREATE TABLE render_preflights (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL REFERENCES short_projects(id),
        project_revision INTEGER NOT NULL CHECK(project_revision > 0),
        snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
        snapshot_hash TEXT NOT NULL,
        result_json TEXT NOT NULL CHECK(json_valid(result_json)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX render_preflights_short_revision_idx
        ON render_preflights(short_id, project_revision, created_at);
      CREATE TRIGGER render_preflights_no_update
        BEFORE UPDATE ON render_preflights
        BEGIN
          SELECT RAISE(ABORT, 'render preflights are immutable');
        END;
      CREATE TRIGGER render_preflights_no_delete
        BEFORE DELETE ON render_preflights
        BEGIN
          SELECT RAISE(ABORT, 'render preflights are immutable');
        END;
    `)
  },
  {
    version: 13,
    name: "snapshot-bound render attempts",
    up: (db) => db.exec(`
      ALTER TABLE renders ADD COLUMN preflight_id TEXT REFERENCES render_preflights(id);
      ALTER TABLE renders ADD COLUMN sidecar_path TEXT;
      CREATE INDEX renders_preflight_idx ON renders(preflight_id);
    `)
  },
  {
    version: 14,
    name: "normalized render determinism evidence",
    up: (db) => db.exec(`
      ALTER TABLE renders ADD COLUMN determinism_json TEXT CHECK(
        determinism_json IS NULL OR json_valid(determinism_json)
      );
      CREATE INDEX renders_determinism_identity_idx
        ON renders(
          json_extract(determinism_json, '$.identityHash'),
          state,
          created_at,
          id
        )
        WHERE determinism_json IS NOT NULL;
      UPDATE renders
      SET state='stale',
          error_code='INVALID_STATE',
          error_message='Rerender required: this output predates normalized determinism evidence.',
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE state='succeeded';
    `)
  },
  {
    version: 15,
    name: "render retry lineage",
    up: (db) => db.exec(`
      ALTER TABLE renders ADD COLUMN lineage_id TEXT NOT NULL
        DEFAULT '00000000-0000-0000-0000-000000000000';
      ALTER TABLE renders ADD COLUMN previous_render_id TEXT REFERENCES renders(id);
      UPDATE renders SET lineage_id=id;
      CREATE UNIQUE INDEX renders_lineage_attempt_unique_idx
        ON renders(lineage_id, attempt);
      CREATE INDEX renders_previous_render_idx ON renders(previous_render_id);
      CREATE TRIGGER renders_lineage_valid_insert
        BEFORE INSERT ON renders
        WHEN NEW.attempt < 1
          OR (NEW.attempt=1 AND NEW.previous_render_id IS NOT NULL)
          OR (NEW.attempt>1 AND NEW.previous_render_id IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'render lineage is invalid');
        END;
      CREATE TRIGGER renders_lineage_immutable
        BEFORE UPDATE OF lineage_id,previous_render_id,attempt ON renders
        BEGIN
          SELECT RAISE(ABORT, 'render lineage is immutable');
        END;
    `)
  },
  {
    version: 16,
    name: "schedule timezone database diagnostics",
    up: (db) => db.exec(`
      ALTER TABLE schedule_rule_sets ADD COLUMN timezone_database_version TEXT NOT NULL
        DEFAULT 'unknown';
    `)
  },
  {
    version: 17,
    name: "news brief speaker template and caption text transforms",
    up: (db) => {
      const template = starterTemplates.find(({ id }) => id === "news-brief-speaker-v1");
      if (!template) throw new Error("News Brief + Speaker starter template is unavailable");
      db.prepare(`
        INSERT OR IGNORE INTO templates(
          id,name,description,version,revision,parent_template_id,built_in,
          composition_json,created_at,updated_at
        ) VALUES(@id,@name,@description,@version,@revision,@parentTemplateId,1,
          @composition,@createdAt,@updatedAt)
      `).run({
        ...template,
        composition: JSON.stringify(template.composition)
      });
      db.prepare(`
        UPDATE short_projects
        SET captions_json=json_set(captions_json, '$.style.textTransform', 'none')
        WHERE json_valid(captions_json)
          AND json_type(captions_json, '$.style')='object'
          AND json_type(captions_json, '$.style.textTransform') IS NULL
      `).run();
    }
  }
];

export const databaseMigrations = migrations;
export const CURRENT_SCHEMA_VERSION = migrations.at(-1)!.version;

export class MigrationError extends Error {
  constructor(
    readonly version: number,
    readonly migrationName: string,
    readonly cause: unknown
  ) {
    super(`Database migration ${version} (${migrationName}) failed; no changes from this migration were applied`);
    this.name = "MigrationError";
  }
}

export function migrateDatabase(
  db: SqliteDatabase,
  availableMigrations: readonly Migration[] = migrations
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const ordered = [...availableMigrations].sort((left, right) => left.version - right.version);
  ordered.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Database migrations must be contiguous; found version ${migration.version} at position ${index + 1}`);
    }
  });
  const appliedRows = db.prepare(
    "SELECT version FROM schema_migrations ORDER BY version"
  ).all() as { version: number }[];
  const knownVersions = new Set(ordered.map((migration) => migration.version));
  const unknown = appliedRows.find((row) => !knownVersions.has(row.version));
  if (unknown) {
    throw new Error(`Database schema version ${unknown.version} is newer than this application supports`);
  }
  const applied = new Set(appliedRows.map((row) => row.version));
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    try {
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)"
        ).run(migration.version, new Date().toISOString());
      })();
    } catch (error) {
      throw new MigrationError(migration.version, migration.name, error);
    }
  }
}

export function openDatabase(path: string): SqliteDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function normalizeCompositionLayers(
  db: SqliteDatabase,
  table: "templates" | "short_projects"
): void {
  const rows = db.prepare(`SELECT id,composition_json FROM ${table}`).all() as Array<{
    id: string;
    composition_json: string;
  }>;
  const update = db.prepare(`UPDATE ${table} SET composition_json=? WHERE id=?`);
  for (const row of rows) {
    let composition: unknown;
    try {
      composition = JSON.parse(row.composition_json);
    } catch {
      continue;
    }
    if (
      typeof composition !== "object" ||
      composition === null ||
      !Array.isArray((composition as { layers?: unknown }).layers)
    ) continue;
    let changed = false;
    const layers = (composition as { layers: unknown[] }).layers.map((layer) => {
      if (
        typeof layer !== "object" ||
        layer === null ||
        Object.prototype.hasOwnProperty.call(layer, "assetId")
      ) return layer;
      changed = true;
      return { ...layer, assetId: null };
    });
    if (changed) update.run(JSON.stringify({ ...composition, layers }), row.id);
  }
}

function migrateCaptionState(db: SqliteDatabase): void {
  const rows = db.prepare(
    "SELECT id,captions_json FROM short_projects"
  ).all() as Array<{ id: string; captions_json: string }>;
  const update = db.prepare("UPDATE short_projects SET captions_json=? WHERE id=?");
  for (const row of rows) {
    let legacy: Record<string, unknown>;
    try {
      legacy = JSON.parse(row.captions_json) as Record<string, unknown>;
    } catch {
      legacy = {};
    }
    const legacyStyle = typeof legacy.style === "object" && legacy.style !== null
      ? legacy.style as Record<string, unknown>
      : {};
    const sourceCues = Array.isArray(legacy.cues)
      ? legacy.cues
      : Array.isArray(legacy.segments)
        ? legacy.segments
        : [];
    const cues = sourceCues.map((value) => {
      const cue = value as Record<string, unknown>;
      const words = Array.isArray(cue.words) ? cue.words : [];
      return {
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        words: words.map((wordValue) => {
          const word = wordValue as Record<string, unknown>;
          return { startMs: word.startMs, endMs: word.endMs, text: word.text };
        })
      };
    });
    const fontSize = Number(legacyStyle.fontSizePx ?? legacyStyle.fontSize ?? 64);
    const migrated = {
      enabled: legacy.enabled !== false,
      cues,
      style: {
        fontFamily: "Inter",
        fontWeight: legacyStyle.fontWeight === 700
          || String(legacyStyle.fontFamily ?? "").toLowerCase().includes("bold")
          ? 700
          : 400,
        fontSizePx: Number.isInteger(fontSize) && fontSize >= 12 && fontSize <= 200
          ? fontSize
          : 64,
        position: legacyStyle.position ?? { x: 0.5, y: 0.78 },
        maxWidth: legacyStyle.maxWidth ?? 0.82,
        textColor: legacyStyle.textColor ?? legacyStyle.color ?? "#ffffff",
        highlightColor: legacyStyle.highlightColor ?? "#ffdc5e",
        outline: legacyStyle.outline ?? { color: "#000000", widthPx: 4 },
        background: legacyStyle.background
          ?? { color: "#00000000", paddingPx: 12, cornerRadiusPx: 8 }
      },
      warnings: Array.isArray(legacy.warnings) ? legacy.warnings : [],
      sidecars: typeof legacy.sidecars === "object" && legacy.sidecars !== null
        ? legacy.sidecars
        : { srt: null, webvtt: null }
    };
    update.run(JSON.stringify(migrated), row.id);
  }
}

function migrateAudioState(db: SqliteDatabase): void {
  const rows = db.prepare(
    "SELECT id,audio_json FROM short_projects"
  ).all() as Array<{ id: string; audio_json: string }>;
  const assetKind = db.prepare("SELECT kind FROM assets WHERE id=?");
  const update = db.prepare("UPDATE short_projects SET audio_json=? WHERE id=?");
  for (const row of rows) {
    let legacy: Record<string, unknown>;
    try {
      legacy = JSON.parse(row.audio_json) as Record<string, unknown>;
    } catch {
      legacy = {};
    }
    const sourceGainDb = clampFinite(legacy.sourceGainDb, -60, 12, 0);
    const sourceMuted = typeof legacy.sourceMuted === "boolean"
      ? legacy.sourceMuted
      : legacy.muted === true;
    const cutFadeMs = clampInteger(
      Math.max(finiteOr(legacy.cutFadeMs, 0), finiteOr(legacy.fadeInMs, 0), finiteOr(legacy.fadeOutMs, 0)),
      0,
      500
    );
    const requestedBedId = typeof legacy.bedAssetId === "string" ? legacy.bedAssetId : null;
    const boundAsset = requestedBedId
      ? assetKind.get(requestedBedId) as { kind: string } | undefined
      : undefined;
    const bedAssetId = boundAsset?.kind === "audio" ? requestedBedId : null;
    const bedGainDb = bedAssetId === null
      ? null
      : clampFinite(legacy.bedGainDb, -60, 0, -18);
    const warnings = bedAssetId !== null && bedGainDb !== null
      && (sourceMuted || sourceGainDb - bedGainDb < 12)
      ? [{
          code: "AUDIO_SPEECH_BACKGROUND_RATIO",
          message: sourceMuted
            ? "Background audio is enabled while the Episode source is muted"
            : "Background audio is less than 12 dB below the Episode source"
        }]
      : [];
    update.run(JSON.stringify({
      sourceGainDb,
      sourceMuted,
      cutFadeMs,
      bedAssetId,
      bedGainDb,
      warnings
    }), row.id);
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampFinite(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Math.min(maximum, Math.max(minimum, finiteOr(value, fallback)));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function migrateCompositionCropTracks(
  db: SqliteDatabase,
  table: "templates" | "short_projects"
): void {
  const rows = db.prepare(
    `SELECT id,composition_json${table === "short_projects" ? ",template_id" : ""} FROM ${table}`
  ).all() as Array<{
    id: string;
    composition_json: string;
    template_id?: string;
  }>;
  const update = db.prepare(`UPDATE ${table} SET composition_json=? WHERE id=?`);
  for (const row of rows) {
    let composition: { layers?: unknown[] };
    try {
      composition = JSON.parse(row.composition_json) as { layers?: unknown[] };
    } catch {
      continue;
    }
    if (!Array.isArray(composition.layers)) continue;
    const layers = composition.layers.map((value, layerIndex) => {
      if (typeof value !== "object" || value === null) return value;
      const layer = value as Record<string, unknown>;
      const { cropTrack, ...withoutLegacyTrack } = layer;
      if (layer.type !== "video") return withoutLegacyTrack;
      if (
        Object.prototype.hasOwnProperty.call(layer, "automaticCropTrack") &&
        Object.prototype.hasOwnProperty.call(layer, "manualCropTrack") &&
        Object.prototype.hasOwnProperty.call(layer, "cropTarget")
      ) return withoutLegacyTrack;
      const legacyFrames = Array.isArray(cropTrack)
        ? cropTrack.filter((frame): frame is Record<string, unknown> =>
          typeof frame === "object" && frame !== null
        )
        : [];
      const automaticFrames = legacyFrames
        .filter((frame) => frame.source === "automatic")
        .map(({ source: _source, ...frame }) => frame)
        .sort((left, right) =>
          Number((left as Record<string, unknown>).atMs)
          - Number((right as Record<string, unknown>).atMs)
        )
        .filter((frame, index, frames) =>
          index === 0
          || (frame as Record<string, unknown>).atMs
            !== (frames[index - 1] as Record<string, unknown>).atMs
        );
      const manualCropTrack = legacyFrames
        .filter((frame) => frame.source === "manual")
        .map(({ source: _source, ...frame }, frameIndex) => ({
          ...frame,
          id: legacyUuid(
            `crop-control:${table}:${row.id}:${String(layer.id ?? layerIndex)}:${frameIndex}:${String(frame.atMs)}`
          ),
          mode: "crop"
        }))
        .sort((left, right) =>
          Number((left as Record<string, unknown>).atMs)
          - Number((right as Record<string, unknown>).atMs)
        )
        .filter((frame, index, frames) =>
          index === 0
          || (frame as Record<string, unknown>).atMs
            !== (frames[index - 1] as Record<string, unknown>).atMs
        );
      const templateId = table === "templates" ? row.id : row.template_id;
      const starter = templateId === "split-subject-speaker-v1"
        || templateId === "fullscreen-speaker-v1"
        || templateId === "screen-speaker-v1";
      const starterTarget = starter && String(layer.id) === "screen"
        ? "screen"
        : starter && String(layer.id) === "speaker"
          ? "person"
          : "auto";
      return {
        ...withoutLegacyTrack,
        cropTarget: starterTarget,
        automaticCropTrack: {
          frames: automaticFrames,
          provenance: null,
          fallback: {
            mode: automaticFrames.length ? "none" : (layer.fit === "fill" ? "fill" : "fit"),
            reason: automaticFrames.length ? "none" : "missing_samples"
          }
        },
        manualCropTrack
      };
    });
    update.run(JSON.stringify({ ...composition, layers }), row.id);
  }
}

function normalizeLegacyContentPackageIdentity(content: {
  cleanedTranscript: string;
  rewrite: string;
  hookVariants: string[];
  titles: string[];
  description: string;
  hashtags: string[];
  thumbnailText: string;
}) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  return {
    cleanedTranscript: normalize(content.cleanedTranscript),
    rewrite: normalize(content.rewrite),
    hookVariants: content.hookVariants.map(normalize),
    titles: content.titles.map(normalize),
    description: normalize(content.description),
    hashtags: content.hashtags.map(normalize),
    thumbnailText: normalize(content.thumbnailText)
  };
}

function migrateLegacyTranscripts(db: SqliteDatabase): void {
  const episodes = db.prepare(`
    SELECT DISTINCT episode_id FROM transcript_segments
    WHERE NOT EXISTS (
      SELECT 1 FROM transcript_revisions tr WHERE tr.episode_id=transcript_segments.episode_id
    )
  `).all() as { episode_id: string }[];
  const read = db.prepare(
    "SELECT * FROM transcript_segments WHERE episode_id=? ORDER BY start_ms"
  );
  const insert = db.prepare(`
    INSERT INTO transcript_revisions(
      id,episode_id,revision,language,segments_json,provenance_json,accepted_state,created_at,updated_at
    ) VALUES(?,?,?,?,?,?, 'accepted', ?,?)
  `);
  for (const episode of episodes) {
    const rows = read.all(episode.episode_id) as Record<string, unknown>[];
    const segments = rows.map((row) => ({
      id: String(row.id),
      startMs: Number(row.start_ms),
      endMs: Number(row.end_ms),
      text: String(row.text),
      words: JSON.parse(String(row.words_json)),
      speaker: row.speaker == null ? null : String(row.speaker),
      confidence: row.confidence == null ? null : Number(row.confidence)
    }));
    const timestamp = (db.prepare("SELECT updated_at FROM episodes WHERE id=?")
      .get(episode.episode_id) as { updated_at: string }).updated_at;
    insert.run(
      legacyUuid(`transcript:${episode.episode_id}`),
      episode.episode_id,
      1,
      "und",
      JSON.stringify(segments),
      JSON.stringify({
        provider: "legacy",
        providerClass: "local",
        modelId: "legacy",
        providerVersion: "1",
        optionsVersion: "1",
        createdAt: timestamp
      }),
      timestamp,
      timestamp
    );
  }
}

function migrateLegacyAnalysisArtifacts(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO analysis_artifacts(
      id,entity_id,owner_type,kind,state,provenance_json,input_hash,
      raw_output_json,accepted_projection_json,created_at
    )
    SELECT id,entity_id,'episode',kind,
      CASE WHEN accepted_json IS NULL THEN 'proposed' ELSE 'accepted' END,
      json_object(
        'provider',provider,'providerClass','local','modelId',model,
        'providerVersion','legacy','optionsVersion','legacy','createdAt',created_at
      ),
      inputs_hash,output_json,accepted_json,created_at
    FROM ai_artifacts
  `);
}

function legacyUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
