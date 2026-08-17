CREATE TABLE users (
  id TEXT PRIMARY KEY, clerk_user_id TEXT NOT NULL UNIQUE, primary_email TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE organizations (
  id TEXT PRIMARY KEY, clerk_organization_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'trialing' CHECK(state IN ('trialing','active','read_only','deleting')),
  deletion_requested_at TEXT, purge_after TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id),
  clerk_membership_id TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('trialing','active','past_due','canceled','read_only')),
  trial_ends_at TEXT, paid_through TEXT, member_limit INTEGER NOT NULL,
  source_minute_limit REAL NOT NULL, storage_byte_limit INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE usage_periods (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, source_minutes_used REAL NOT NULL DEFAULT 0,
  source_minutes_reserved REAL NOT NULL DEFAULT 0, storage_bytes_used INTEGER NOT NULL DEFAULT 0,
  storage_bytes_reserved INTEGER NOT NULL DEFAULT 0, UNIQUE(organization_id,starts_at)
);
CREATE TABLE usage_ledger_entries (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  usage_period_id TEXT NOT NULL REFERENCES usage_periods(id), idempotency_key TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK(dimension IN ('source_minutes','storage_bytes')),
  kind TEXT NOT NULL CHECK(kind IN ('reserve','charge','release','credit')), amount REAL NOT NULL,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organization_id,idempotency_key)
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'episode_to_shorts' CHECK(kind IN ('episode_to_shorts','screenletter_recording')),
  origin TEXT NOT NULL DEFAULT 'siftcut_web' CHECK(origin IN ('siftcut_web','screenletter_ios')),
  revision INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleting')),
  deletion_requested_at TEXT, purge_after TEXT, created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX projects_by_org ON projects(organization_id,updated_at DESC);
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id), display_name TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  multipart_upload_id TEXT NOT NULL, expected_bytes INTEGER NOT NULL, checksum_sha256 TEXT NOT NULL,
  part_size_bytes INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open'
    CHECK(state IN ('open','completing','complete','aborted','expired')),
  expires_at TEXT NOT NULL, completed_at TEXT, completed_bytes INTEGER,
  completed_checksum_sha256 TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX uploads_by_org ON upload_sessions(organization_id,id);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL, input_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','cancel_requested','succeeded','failed','canceled')),
  stage TEXT, progress REAL, attempt_count INTEGER NOT NULL DEFAULT 0, heartbeat_at TEXT,
  cancel_requested_at TEXT, result TEXT, error_code TEXT, error_message TEXT,
  error_retryable INTEGER, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organization_id,kind,input_hash)
);
CREATE INDEX jobs_by_org ON jobs(organization_id,id);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id), episode_id TEXT, kind TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL, byte_length INTEGER NOT NULL,
  media_type TEXT NOT NULL, producer_name TEXT NOT NULL, producer_version TEXT NOT NULL,
  input_hash TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(organization_id,kind,input_hash)
);
CREATE TABLE event_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT REFERENCES projects(id), type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX events_by_org_cursor ON event_records(organization_id,id);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id), queue TEXT NOT NULL CHECK(queue IN ('ingest','analysis','render')),
  payload TEXT NOT NULL, created_at TEXT NOT NULL, available_at TEXT NOT NULL,
  claimed_at TEXT, claim_token TEXT, claim_expires_at TEXT, delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, last_error_at TEXT
);
CREATE INDEX pending_outbox ON outbox(available_at,created_at) WHERE delivered_at IS NULL;
CREATE TABLE webhook_events (
  provider TEXT NOT NULL CHECK(provider IN ('clerk','stripe')), event_id TEXT NOT NULL,
  event_type TEXT NOT NULL, payload_hash TEXT NOT NULL, received_at TEXT NOT NULL,
  processed_at TEXT, PRIMARY KEY(provider,event_id)
);
CREATE TABLE screenletter_recordings (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id), owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, source_asset_id TEXT,
  proxy_asset_id TEXT, published_asset_id TEXT, share_token TEXT NOT NULL UNIQUE,
  share_revision INTEGER NOT NULL DEFAULT 1, failure_code TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX screenletter_by_org ON screenletter_recordings(organization_id,updated_at DESC,id);
CREATE TABLE screenletter_abuse_reports (
  id TEXT PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES screenletter_recordings(id),
  category TEXT NOT NULL, details TEXT, reporter_ip_hash TEXT, created_at TEXT NOT NULL
);
