-- FORCE RLS also applies to the table owner. Permit only security-definer
-- functions running as the migration/table owner to cross the tenant boundary;
-- direct API-role access remains governed by tenant_isolation.
CREATE POLICY screenletter_owner_functions ON screenletter_recordings
  USING (
    current_user = pg_get_userbyid(
      (SELECT relowner FROM pg_class
       WHERE oid = 'screenletter_recordings'::regclass)
    )
  )
  WITH CHECK (
    current_user = pg_get_userbyid(
      (SELECT relowner FROM pg_class
       WHERE oid = 'screenletter_recordings'::regclass)
    )
  );
