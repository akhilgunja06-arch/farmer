-- =============================================================================
-- RythuDirect — database bootstrap
--
-- Run ONCE as a PostgreSQL superuser, before any migration. Creates the two
-- roles the application expects:
--
--   rythu_app  schema owner. Runs migrations and the seed script. NOT used by
--              the API at runtime, because an owner bypasses row level security.
--   rythu_web  least-privilege runtime role. NOBYPASSRLS, so every statement the
--              API issues is filtered by the RLS policies in 0003.
--
-- Passwords come from psql variables so they never sit in this file:
--
--   psql -v ON_ERROR_STOP=1 \
--        -v owner_password="'...'" \
--        -v web_password="'...'" \
--        -v db_name=rythudirect \
--        -f server/src/db/bootstrap.sql
--
-- If a variable is omitted a development default is used and a warning is
-- printed. Never run that way against a real deployment.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?db_name}
\else
  \set db_name rythudirect
\endif

\if :{?owner_password}
\else
  \set owner_password '''rythu_dev_password'''
  \echo 'WARNING: using the development default owner password. Set -v owner_password for anything real.'
\endif

\if :{?web_password}
\else
  \set web_password '''rythu_web_password'''
  \echo 'WARNING: using the development default runtime password. Set -v web_password for anything real.'
\endif

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rythu_app') THEN
    EXECUTE format('CREATE ROLE rythu_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rythu_web') THEN
    EXECUTE format('CREATE ROLE rythu_web LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
  END IF;
END $$;

ALTER ROLE rythu_app WITH LOGIN PASSWORD :owner_password;
ALTER ROLE rythu_web WITH LOGIN PASSWORD :web_password;

-- The whole point of the second role: it can never skip a policy.
ALTER ROLE rythu_web NOBYPASSRLS NOSUPERUSER;

-- ---------------------------------------------------------------------------
-- Database
-- ---------------------------------------------------------------------------
SELECT format('CREATE DATABASE %I OWNER rythu_app', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec

-- ---------------------------------------------------------------------------
-- Inside the new database: lock down the public schema
--
-- PostgreSQL 15+ already removes CREATE on public from PUBLIC, but a database
-- restored from an older dump may still grant it. Revoking is cheap insurance
-- against a role creating an object that shadows one of ours.
-- ---------------------------------------------------------------------------
\connect :db_name

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rythu_app, rythu_web;
ALTER SCHEMA public OWNER TO rythu_app;

-- The API must not be able to create tables. Migrations run as rythu_app.
REVOKE CREATE ON SCHEMA public FROM rythu_web;

-- Extensions are installed by the owner during migration.
GRANT CREATE ON SCHEMA public TO rythu_app;

\echo ''
\echo 'Bootstrap complete:'
\echo '  database : rythudirect (owner rythu_app)'
\echo '  runtime  : rythu_web (NOBYPASSRLS)'
\echo ''
\echo 'Next: npm run db:migrate'
