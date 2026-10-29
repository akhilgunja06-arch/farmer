-- ---------------------------------------------------------------------------
-- 0004 — add the 'expired' value to verification_status
--
-- guard_quality_verification() (0001_core_schema.sql) already treats 'expired'
-- as one of the official statuses that only a privileged reviewer may set, and
-- the interface labels an expired report separately from a rejected one. The
-- enum never contained the value, so the trigger's IN-list failed to cast and
-- every quality-report decision aborted with
--   22P02 invalid input value for enum verification_status: "expired"
-- which surfaced as a 500 on the administrator's verification screen.
--
-- ADD VALUE cannot run inside a transaction block on older PostgreSQL, and the
-- migration runner wraps each file in one. IF NOT EXISTS makes this safe to
-- re-run, and the value is only read by the trigger, so no other statement in
-- this migration depends on it.
-- ---------------------------------------------------------------------------

ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'expired';
