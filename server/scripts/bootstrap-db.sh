#!/usr/bin/env bash
# =============================================================================
# Provision the RythuDirect database.
#
# Creates the schema-owner role, the least-privilege runtime role, and the
# database itself. Must run as a PostgreSQL superuser. Idempotent: safe to
# re-run, and re-running rotates the two role passwords.
#
#   PGHOST / PGPORT / PGUSER / PGPASSWORD  — connection to the admin database
#   DB_NAME                                — default: rythudirect
#   DB_OWNER_PASSWORD                      — schema owner password
#   DB_WEB_PASSWORD                        — runtime role password
#
# The passwords are passed to psql as variables, so they are never written to
# a file or embedded in the SQL. When they are omitted the script generates
# strong random ones and prints the DATABASE_URL / APP_DATABASE_URL lines to
# paste into .env.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/../src/db/bootstrap.sql"

DB_NAME="${DB_NAME:-rythudirect}"
# Empty PGHOST means "use the local Unix socket", which is how a superuser
# connects on a stock Debian install (peer authentication). Set PGHOST to a
# hostname to connect over TCP instead.
PGHOST="${PGHOST-}"
PGPORT="${PGPORT:-5432}"

PSQL_ARGS=(--set ON_ERROR_STOP=1)
[ -n "$PGHOST" ] && PSQL_ARGS+=(--host="$PGHOST")
[ -n "$PGPORT" ] && PSQL_ARGS+=(--port="$PGPORT")
[ -n "${PGUSER:-}" ] && PSQL_ARGS+=(--username="$PGUSER")

# Random, URL-safe, no shell metacharacters.
gen_password() {
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
}

GENERATED=0
if [ -z "${DB_OWNER_PASSWORD:-}" ]; then
  DB_OWNER_PASSWORD="$(gen_password)"
  GENERATED=1
fi
if [ -z "${DB_WEB_PASSWORD:-}" ]; then
  DB_WEB_PASSWORD="$(gen_password)"
  GENERATED=1
fi

echo "Provisioning database '${DB_NAME}' on ${PGHOST:-<local socket>}:${PGPORT}..."

psql "${PSQL_ARGS[@]}" \
  --set db_name="$DB_NAME" \
  --set owner_password="'${DB_OWNER_PASSWORD//\'/\'\'}'" \
  --set web_password="'${DB_WEB_PASSWORD//\'/\'\'}'" \
  --file "$SQL_FILE"

status=$?
if [ $status -ne 0 ]; then
  echo "" >&2
  echo "Bootstrap failed (exit ${status})." >&2
  echo "If this is a permission error, run it as a superuser, for example:" >&2
  echo "  sudo -u postgres bash scripts/bootstrap-db.sh" >&2
  exit $status
fi

echo ""
echo "Roles and database are ready."
echo ""

if [ "$GENERATED" -eq 1 ]; then
  echo "Generated passwords. Add these to .env (they are shown once):"
  echo ""
  echo "DATABASE_URL=postgresql://rythu_app:${DB_OWNER_PASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"
  echo "APP_DATABASE_URL=postgresql://rythu_web:${DB_WEB_PASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"
  echo ""
fi

echo "Next: npm run db:migrate && npm run db:seed"
