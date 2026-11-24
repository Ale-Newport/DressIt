#!/usr/bin/env bash
# Prepara PostgreSQL local: bases de datos, rol de la aplicación, .env y migraciones.
# Requisitos: PostgreSQL 15+ con la extensión pgvector instalada y un superusuario local.
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL_BASE="${PG_ADMIN_URL_BASE:-postgres://localhost:5432}"
APP_PASSWORD="${DRESSIT_APP_PASSWORD:-dressit_app_dev}"

if [ ! -f .env ]; then
  cp .env.example .env
  JWT=$(openssl rand -hex 32)
  IMG=$(openssl rand -hex 32)
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|; s|^IMAGE_URL_SECRET=.*|IMAGE_URL_SECRET=${IMG}|" .env && rm -f .env.bak
  echo "→ .env creado con secretos aleatorios"
fi

for DB in dressit dressit_test; do
  if ! psql "${ADMIN_URL_BASE}/postgres" -tAc "select 1 from pg_database where datname='${DB}'" | grep -q 1; then
    psql "${ADMIN_URL_BASE}/postgres" -c "create database ${DB}" >/dev/null
    echo "→ base de datos ${DB} creada"
  fi
done

psql "${ADMIN_URL_BASE}/postgres" -v ON_ERROR_STOP=1 >/dev/null <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'dressit_app') then
    create role dressit_app login password '${APP_PASSWORD}';
  else
    alter role dressit_app login password '${APP_PASSWORD}';
  end if;
end \$\$;
SQL
for DB in dressit dressit_test; do
  psql "${ADMIN_URL_BASE}/${DB}" -c "grant connect on database ${DB} to dressit_app; grant usage on schema public to dressit_app;" >/dev/null
done
echo "→ rol dressit_app listo"

pnpm --filter @dressit/api db:migrate
DATABASE_ADMIN_URL="${ADMIN_URL_BASE}/dressit_test" pnpm --filter @dressit/api db:migrate
echo "✓ Base de datos lista"
