FROM postgres:17.5-alpine

COPY infra/railway/postgres/10-siftcut-roles.sh /docker-entrypoint-initdb.d/10-siftcut-roles.sh

RUN chmod 0555 /docker-entrypoint-initdb.d/10-siftcut-roles.sh

HEALTHCHECK --interval=5s --timeout=3s --retries=20 \
  CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
