DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['projects', 'artifacts'] LOOP
    EXECUTE format(
      'CREATE POLICY owner_security_definer_lookup ON %I
       USING (
         current_user = pg_get_userbyid(
           (SELECT relowner FROM pg_class WHERE oid = %L::regclass)
         )
       )',
      table_name,
      table_name
    );
  END LOOP;
END $$;
