ALTER TABLE upload_sessions
  ADD COLUMN completed_bytes bigint,
  ADD COLUMN completed_checksum_sha256 text;

ALTER TABLE upload_sessions
  ADD CONSTRAINT completed_bytes_nonnegative CHECK (completed_bytes IS NULL OR completed_bytes >= 0),
  ADD CONSTRAINT completed_checksum_sha256_format CHECK (
    completed_checksum_sha256 IS NULL OR completed_checksum_sha256 ~ '^[a-f0-9]{64}$'
  );

ALTER TABLE jobs
  ADD COLUMN result jsonb,
  ADD COLUMN error_message text;

ALTER TABLE outbox
  ADD COLUMN claim_token uuid,
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error_at timestamptz;

DROP INDEX pending_outbox;
CREATE INDEX pending_outbox ON outbox(available_at, created_at)
  WHERE delivered_at IS NULL;

CREATE INDEX jobs_by_project_active ON jobs(project_id, state)
  WHERE state IN ('queued', 'running', 'cancel_requested');

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships','subscriptions','usage_periods','usage_ledger_entries','projects',
    'upload_sessions','episodes','jobs','artifacts','transcripts','candidates',
    'templates','shorts','renders','schedules','event_records','outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

-- Cross-tenant outbox access is available only while running a narrowly
-- granted security-definer function owned by the migration/table owner.
CREATE POLICY outbox_owner_functions ON outbox
  USING (
    current_user = pg_get_userbyid(
      (SELECT relowner FROM pg_class WHERE oid = 'outbox'::regclass)
    )
  )
  WITH CHECK (
    current_user = pg_get_userbyid(
      (SELECT relowner FROM pg_class WHERE oid = 'outbox'::regclass)
    )
  );

CREATE OR REPLACE FUNCTION publisher_claim_outbox(requested_limit integer)
RETURNS TABLE (
  outbox_id uuid,
  payload jsonb,
  attempt integer,
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF requested_limit < 1 OR requested_limit > 100 THEN
    RAISE EXCEPTION 'claim limit out of range';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM outbox o
    WHERE o.delivered_at IS NULL
      AND o.available_at <= clock_timestamp()
      AND (o.claimed_at IS NULL OR o.claimed_at < clock_timestamp() - interval '5 minutes')
    ORDER BY o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT requested_limit
  ), leased AS (
    UPDATE outbox o
    SET claimed_at = clock_timestamp(), claim_token = gen_random_uuid(), attempts = o.attempts + 1
    FROM candidates c
    WHERE o.id = c.id
    RETURNING o.id, o.payload, o.attempts, o.claim_token
  )
  SELECT leased.id, leased.payload, leased.attempts, leased.claim_token FROM leased;
END;
$$;

CREATE OR REPLACE FUNCTION publisher_mark_delivered(requested_id uuid, requested_token uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH changed AS (
    UPDATE outbox
    SET delivered_at = clock_timestamp(), claim_token = NULL
    WHERE id = requested_id AND claim_token = requested_token AND delivered_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed)
$$;

CREATE OR REPLACE FUNCTION publisher_mark_failed(
  requested_id uuid,
  requested_token uuid,
  requested_retry_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH changed AS (
    UPDATE outbox
    SET claimed_at = NULL, claim_token = NULL,
        available_at = GREATEST(requested_retry_at, clock_timestamp()),
        last_error_at = clock_timestamp()
    WHERE id = requested_id AND claim_token = requested_token AND delivered_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed)
$$;

REVOKE ALL ON FUNCTION publisher_claim_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION publisher_mark_delivered(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION publisher_mark_failed(uuid, uuid, timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftcut_publisher') THEN
    GRANT EXECUTE ON FUNCTION publisher_claim_outbox(integer) TO siftcut_publisher;
    GRANT EXECUTE ON FUNCTION publisher_mark_delivered(uuid, uuid) TO siftcut_publisher;
    GRANT EXECUTE ON FUNCTION publisher_mark_failed(uuid, uuid, timestamptz) TO siftcut_publisher;
  END IF;
END $$;
