ALTER TABLE projects
  ADD COLUMN kind text NOT NULL DEFAULT 'episode_to_shorts'
    CHECK (kind IN ('episode_to_shorts', 'screenletter_recording')),
  ADD COLUMN origin text NOT NULL DEFAULT 'siftcut_web'
    CHECK (origin IN ('siftcut_web', 'screenletter_ios'));

CREATE TABLE screenletter_recordings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('screen_microphone', 'camera')),
  state text NOT NULL CHECK (state IN (
    'created', 'recording', 'awaiting_upload', 'uploading', 'processing',
    'ready', 'failed', 'deleted'
  )),
  source_asset_id uuid REFERENCES artifacts(id),
  proxy_asset_id uuid REFERENCES artifacts(id),
  published_asset_id uuid REFERENCES artifacts(id),
  share_token uuid NOT NULL UNIQUE,
  share_revision integer NOT NULL DEFAULT 1 CHECK (share_revision > 0),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (published_asset_id IS NULL OR proxy_asset_id IS NOT NULL)
);
CREATE INDEX screenletter_recordings_by_org
  ON screenletter_recordings(organization_id, updated_at DESC, id);

CREATE TABLE screenletter_abuse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES screenletter_recordings(id),
  category text NOT NULL CHECK (category IN (
    'spam', 'harassment', 'copyright', 'sexual_content', 'violence', 'other'
  )),
  details text,
  reporter_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE screenletter_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenletter_recordings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON screenletter_recordings
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON screenletter_recordings, screenletter_abuse_reports FROM PUBLIC;

CREATE FUNCTION screenletter_public_share(requested_token uuid)
RETURNS TABLE (
  recording_id uuid,
  name text,
  mode text,
  share_revision integer,
  object_key text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT r.id, r.name, r.mode, r.share_revision, a.object_key, r.created_at
  FROM screenletter_recordings r
  JOIN projects p ON p.id = r.project_id AND p.state = 'active'
  JOIN artifacts a
    ON a.id = COALESCE(r.published_asset_id, r.proxy_asset_id)
   AND a.project_id = r.project_id
   AND a.state = 'complete'
  WHERE r.share_token = requested_token
    AND r.state = 'ready'
    AND r.deleted_at IS NULL
  LIMIT 1
$$;

CREATE FUNCTION screenletter_report_abuse(
  requested_token uuid,
  requested_category text,
  requested_details text,
  requested_reporter_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE requested_recording_id uuid;
BEGIN
  IF requested_category NOT IN (
    'spam', 'harassment', 'copyright', 'sexual_content', 'violence', 'other'
  ) OR length(coalesce(requested_details, '')) > 2000 THEN
    RAISE EXCEPTION 'invalid abuse report';
  END IF;
  SELECT id INTO requested_recording_id
  FROM screenletter_recordings
  WHERE share_token = requested_token;
  IF requested_recording_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO screenletter_abuse_reports
    (recording_id, category, details, reporter_ip_hash)
  VALUES
    (requested_recording_id, requested_category, nullif(requested_details, ''),
     requested_reporter_hash);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION screenletter_public_share(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION screenletter_report_abuse(uuid, text, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftcut_api') THEN
    GRANT SELECT, INSERT, UPDATE ON screenletter_recordings TO siftcut_api;
    GRANT EXECUTE ON FUNCTION screenletter_public_share(uuid) TO siftcut_api;
    GRANT EXECUTE ON FUNCTION screenletter_report_abuse(uuid, text, text, text) TO siftcut_api;
  END IF;
END $$;
