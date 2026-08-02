BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE organization_state AS ENUM ('trialing', 'active', 'read_only', 'deleting');
CREATE TYPE organization_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE membership_state AS ENUM ('active', 'revoked');
CREATE TYPE upload_state AS ENUM ('open', 'completing', 'complete', 'aborted', 'expired');
CREATE TYPE job_state AS ENUM ('queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'canceled');
CREATE TYPE artifact_state AS ENUM ('temporary', 'complete', 'corrupt', 'superseded', 'deleting');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  primary_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_organization_id text NOT NULL UNIQUE,
  name text NOT NULL,
  state organization_state NOT NULL DEFAULT 'trialing',
  deletion_requested_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'deleting') = (deletion_requested_at IS NOT NULL))
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  clerk_membership_id text NOT NULL UNIQUE,
  role organization_role NOT NULL,
  state membership_state NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE UNIQUE INDEX one_active_owner_per_user_org
  ON memberships(organization_id, user_id) WHERE state = 'active';

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  state text NOT NULL CHECK (state IN ('trialing','active','past_due','canceled','read_only')),
  trial_ends_at timestamptz,
  paid_through timestamptz,
  member_limit integer NOT NULL CHECK (member_limit > 0),
  source_minute_limit numeric(12,3) NOT NULL CHECK (source_minute_limit > 0),
  storage_byte_limit bigint NOT NULL CHECK (storage_byte_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source_minutes_used numeric(12,3) NOT NULL DEFAULT 0,
  source_minutes_reserved numeric(12,3) NOT NULL DEFAULT 0,
  storage_bytes_used bigint NOT NULL DEFAULT 0,
  storage_bytes_reserved bigint NOT NULL DEFAULT 0,
  UNIQUE (organization_id, starts_at),
  CHECK (ends_at > starts_at),
  CHECK (
    source_minutes_used >= 0 AND source_minutes_reserved >= 0 AND
    storage_bytes_used >= 0 AND storage_bytes_reserved >= 0
  )
);

CREATE TABLE usage_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  usage_period_id uuid NOT NULL REFERENCES usage_periods(id),
  idempotency_key text NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('source_minutes','storage_bytes')),
  kind text NOT NULL CHECK (kind IN ('reserve','charge','release','credit')),
  amount numeric(20,3) NOT NULL CHECK (amount > 0),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','deleting')),
  deletion_requested_at timestamptz,
  purge_after timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_by_org ON projects(organization_id, updated_at DESC);

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  display_name text NOT NULL,
  object_key text NOT NULL UNIQUE,
  multipart_upload_id text NOT NULL,
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  part_size_bytes integer NOT NULL CHECK (part_size_bytes >= 5242880),
  state upload_state NOT NULL DEFAULT 'open',
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX open_uploads_by_expiry ON upload_sessions(expires_at) WHERE state = 'open';

CREATE TABLE episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  upload_session_id uuid NOT NULL UNIQUE REFERENCES upload_sessions(id),
  display_name text NOT NULL,
  source_object_key text NOT NULL UNIQUE,
  content_hash text NOT NULL,
  duration_ms bigint NOT NULL CHECK (duration_ms > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  video_codec text NOT NULL,
  audio_codec text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, content_hash)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('ingest','transcribe','analyze','render','delete')),
  schema_version integer NOT NULL,
  input_hash text NOT NULL,
  state job_state NOT NULL DEFAULT 'queued',
  stage text,
  progress numeric(5,4) CHECK (progress BETWEEN 0 AND 1),
  attempt_count integer NOT NULL DEFAULT 0,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  error_code text,
  error_retryable boolean,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, input_hash)
);
CREATE INDEX queued_jobs ON jobs(kind, created_at) WHERE state = 'queued';

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  episode_id uuid REFERENCES episodes(id),
  kind text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_hash text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  media_type text NOT NULL,
  producer_name text NOT NULL,
  producer_version text NOT NULL,
  input_hash text NOT NULL,
  state artifact_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, kind, input_hash)
);

CREATE TABLE transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  episode_id uuid NOT NULL REFERENCES episodes(id),
  revision integer NOT NULL CHECK (revision > 0),
  artifact_id uuid NOT NULL REFERENCES artifacts(id),
  accepted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, revision)
);

CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  episode_id uuid NOT NULL REFERENCES episodes(id),
  transcript_id uuid NOT NULL REFERENCES transcripts(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('proposed','approved','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  composition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  episode_id uuid NOT NULL REFERENCES episodes(id),
  candidate_id uuid REFERENCES candidates(id),
  template_id uuid REFERENCES templates(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  edit jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  short_id uuid NOT NULL REFERENCES shorts(id),
  short_revision integer NOT NULL CHECK (short_revision > 0),
  artifact_id uuid REFERENCES artifacts(id),
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
  state text NOT NULL CHECK (state IN ('queued','running','succeeded','failed','canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  short_id uuid NOT NULL REFERENCES shorts(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  publish_at timestamptz NOT NULL,
  timezone text NOT NULL,
  state text NOT NULL CHECK (state IN ('planned','published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, publish_at)
);

CREATE TABLE event_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid REFERENCES projects(id),
  type text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_by_org_cursor ON event_records(organization_id, id);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  queue text NOT NULL CHECK (queue IN ('ingest','analysis','render')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX pending_outbox ON outbox(created_at) WHERE delivered_at IS NULL;

CREATE TABLE webhook_events (
  provider text NOT NULL CHECK (provider IN ('clerk','stripe')),
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (provider, event_id)
);

-- The API sets this transaction-local value only from a verified Clerk session.
CREATE FUNCTION current_organization_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships','subscriptions','usage_periods','usage_ledger_entries','projects',
    'upload_sessions','episodes','jobs','artifacts','transcripts','candidates',
    'templates','shorts','renders','schedules','event_records','outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_organization_id()) WITH CHECK (organization_id = current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
