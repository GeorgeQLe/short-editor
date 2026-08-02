CREATE ROLE siftcut_migrator LOGIN PASSWORD 'local-migrator';
CREATE ROLE siftcut_api LOGIN PASSWORD 'local-api' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE siftcut_publisher LOGIN PASSWORD 'local-publisher' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE siftcut OWNER siftcut_migrator;
CREATE DATABASE siftcut_test OWNER siftcut_migrator;

GRANT CONNECT ON DATABASE siftcut TO siftcut_api, siftcut_publisher;
GRANT CONNECT ON DATABASE siftcut_test TO siftcut_api, siftcut_publisher;

\connect siftcut
GRANT USAGE ON SCHEMA public TO siftcut_api, siftcut_publisher;
ALTER DEFAULT PRIVILEGES FOR ROLE siftcut_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siftcut_api;
ALTER DEFAULT PRIVILEGES FOR ROLE siftcut_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO siftcut_api;

\connect siftcut_test
GRANT USAGE ON SCHEMA public TO siftcut_api, siftcut_publisher;
ALTER DEFAULT PRIVILEGES FOR ROLE siftcut_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siftcut_api;
ALTER DEFAULT PRIVILEGES FOR ROLE siftcut_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO siftcut_api;
