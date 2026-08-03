#!/bin/sh
set -eu

: "${POSTGRES_DB:=siftcut}"
: "${MIGRATOR_PASSWORD:?MIGRATOR_PASSWORD is required}"
: "${API_PASSWORD:?API_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname postgres \
  --set=migrator_password="$MIGRATOR_PASSWORD" \
  --set=api_password="$API_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE siftcut_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  :'migrator_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftcut_migrator') \gexec
SELECT format(
  'CREATE ROLE siftcut_api LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  :'api_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siftcut_api') \gexec
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner siftcut_migrator "$POSTGRES_DB"
fi

psql --username "$POSTGRES_USER" --dbname postgres \
  --set=database_name="$POSTGRES_DB" <<'SQL'
SELECT format('ALTER DATABASE %I OWNER TO siftcut_migrator', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO siftcut_migrator, siftcut_api', :'database_name') \gexec
SQL
