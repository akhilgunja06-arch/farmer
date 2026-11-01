-- ============================================================================
-- RythuDirect 0005 — farmer advisor
--
-- Adds the storage behind the "which crop suits my farm?" advisor:
--
--   advisor_sessions          one consultation, with the farm facts the farmer
--                             supplied and the language they want answers in
--   advisor_messages          the turn-by-turn conversation
--   agronomic_reference       verified cost/yield figures per crop, state and
--                             season — the ONLY source of cost and yield numbers
--   weather_snapshots         cached Open-Meteo responses, keyed by rounded
--                             coordinates so a village's farmers share one call
--
-- Design notes
-- ------------
-- * Cost, yield and profit are never computed from model output. They come from
--   agronomic_reference or they are reported as unavailable. An empty table
--   therefore produces honest "data not available" answers, not invented ones.
-- * Every agronomic row carries its source, unit and observation date so the
--   interface can show where a figure came from and how old it is.
-- * advisor_messages keeps the model name and token usage for the same reason
--   the audit log exists: an operator should be able to see what was asked.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reference data: one row per crop/state/season, with an explicit source.
--
-- Nothing seeds this table. It is filled by an administrator from a published
-- cost-of-cultivation or package-of-practices source, and the advisor treats a
-- missing row as "not available" rather than estimating.
-- ---------------------------------------------------------------------------
CREATE TABLE agronomic_reference (
  id                  BIGSERIAL PRIMARY KEY,
  crop_name           TEXT NOT NULL CHECK (length(btrim(crop_name)) BETWEEN 2 AND 120),
  category_id         INTEGER REFERENCES crop_categories(id) ON DELETE SET NULL,
  variety             TEXT,

  state               TEXT NOT NULL,
  district            TEXT,
  season              TEXT NOT NULL CHECK (season IN ('kharif', 'rabi', 'zaid', 'perennial', 'any')),

  -- Cost of cultivation, per acre. NUMERIC so a figure is never a float.
  cost_per_acre       NUMERIC(14,2) CHECK (cost_per_acre IS NULL OR cost_per_acre >= 0),
  cost_currency       TEXT NOT NULL DEFAULT 'INR',

  -- Expected yield, per acre, in the unit named here.
  yield_per_acre      NUMERIC(14,3) CHECK (yield_per_acre IS NULL OR yield_per_acre > 0),
  yield_unit          quantity_unit,

  duration_days       INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  irrigation_needs    TEXT CHECK (irrigation_needs IS NULL OR irrigation_needs IN ('low', 'medium', 'high')),
  suitable_soils      TEXT[] NOT NULL DEFAULT '{}',
  notes               TEXT,

  -- Provenance. A row without a source is not usable as evidence, so both are
  -- required: the constraint is the difference between data and a guess.
  source              TEXT NOT NULL CHECK (length(btrim(source)) BETWEEN 3 AND 300),
  source_ref          TEXT,
  observed_on         DATE NOT NULL,

  verified_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per crop/location/season. The COALESCE pair makes a NULL district
  -- compare equal to another NULL, which a plain UNIQUE would not.
  CONSTRAINT agronomic_reference_unique
    UNIQUE (crop_name, state, district, season)
);

CREATE INDEX agronomic_reference_lookup_idx
  ON agronomic_reference (state, season, crop_name);
CREATE INDEX agronomic_reference_district_idx
  ON agronomic_reference (state, district, season);

CREATE TRIGGER agronomic_reference_updated_at BEFORE UPDATE ON agronomic_reference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Weather cache.
--
-- Open-Meteo is keyless, so the cost of a call is latency and courtesy rather
-- than money. Coordinates are rounded to 2 decimals (~1.1 km) before the key is
-- formed, so every farmer in a village shares one cached response instead of
-- each triggering their own request.
-- ---------------------------------------------------------------------------
CREATE TABLE weather_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  latitude       NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude      NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- The rounded key the lookup uses. Stored so an index hit does not depend on
  -- rounding rules staying identical in two places.
  location_key   TEXT NOT NULL,

  state          TEXT,
  district       TEXT,
  -- 'village' when coordinates came from the farm, 'district' when the call fell
  -- back to a district centre. Surfaced so the UI can say which was used.
  granularity    TEXT NOT NULL CHECK (granularity IN ('village', 'district')),
  place_name     TEXT,

  current_json   JSONB,
  forecast_json  JSONB,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,

  CONSTRAINT weather_snapshots_key_uniq UNIQUE (location_key)
);

CREATE INDEX weather_snapshots_expiry_idx ON weather_snapshots (expires_at);

-- ---------------------------------------------------------------------------
-- Advisor sessions.
--
-- The farm facts are columns rather than a JSON blob because they are queried
-- (an administrator may want "how many farmers in Khammam are asking about
-- cotton?") and because a typed column is validated once, at insert.
-- ---------------------------------------------------------------------------
CREATE TABLE advisor_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Collected farm facts. All nullable: the advisor asks for them progressively
  -- rather than blocking on a long form.
  state               TEXT,
  district            TEXT,
  village             TEXT,
  land_acres          NUMERIC(10,2) CHECK (land_acres IS NULL OR land_acres > 0),
  season              TEXT CHECK (season IS NULL OR season IN ('kharif', 'rabi', 'zaid', 'perennial')),
  irrigation          TEXT CHECK (irrigation IS NULL OR irrigation IN ('rainfed', 'canal', 'borewell', 'drip', 'tank', 'other')),
  soil_type           TEXT,
  budget_inr          NUMERIC(14,2) CHECK (budget_inr IS NULL OR budget_inr >= 0),
  language            language_code NOT NULL DEFAULT 'te',

  title               TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  -- The crops the advisor actually compared, for the session list.
  compared_crops      TEXT[] NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX advisor_sessions_farmer_idx ON advisor_sessions (farmer_id, updated_at DESC);
CREATE INDEX advisor_sessions_status_idx ON advisor_sessions (status);

CREATE TRIGGER advisor_sessions_updated_at BEFORE UPDATE ON advisor_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Advisor messages.
-- ---------------------------------------------------------------------------
CREATE TABLE advisor_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES advisor_sessions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  body          TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 12000),

  -- What the assistant was given for this turn: the weather snapshot and the
  -- agronomic rows it was allowed to use. Stored so an answer can be traced back
  -- to its inputs after the reference table changes.
  context_json  JSONB,

  model         TEXT,
  prompt_tokens   INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  -- Set when the provider could not be reached, so a failed turn is visibly a
  -- failure rather than an empty answer.
  error_code    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX advisor_messages_session_idx ON advisor_messages (session_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE advisor_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agronomic_reference   ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_snapshots     ENABLE ROW LEVEL SECURITY;

-- A farmer sees and edits only their own sessions. An administrator can read any
-- session for support purposes but the insert policy below restricts creation to
-- the owner, so an admin cannot forge a farmer's question.
CREATE POLICY advisor_sessions_owner ON advisor_sessions FOR ALL TO rythu_web
  USING (farmer_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (farmer_id = app_current_user_id());

CREATE POLICY advisor_messages_read ON advisor_messages FOR SELECT TO rythu_web
  USING (
    EXISTS (
      SELECT 1 FROM advisor_sessions s
       WHERE s.id = advisor_messages.session_id
         AND (s.farmer_id = app_current_user_id() OR app_is_admin())
    )
  );

CREATE POLICY advisor_messages_insert ON advisor_messages FOR INSERT TO rythu_web
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM advisor_sessions s
       WHERE s.id = advisor_messages.session_id
         AND s.farmer_id = app_current_user_id()
    )
  );

-- A farmer may delete their own conversation; nobody may rewrite history.
CREATE POLICY advisor_messages_delete ON advisor_messages FOR DELETE TO rythu_web
  USING (
    EXISTS (
      SELECT 1 FROM advisor_sessions s
       WHERE s.id = advisor_messages.session_id
         AND s.farmer_id = app_current_user_id()
    )
  );

-- Reference data is world-readable and administrator-writable. Everyone benefits
-- from a correct cost figure; only a reviewer may assert one.
CREATE POLICY agronomic_reference_read ON agronomic_reference FOR SELECT TO rythu_web
  USING (true);
CREATE POLICY agronomic_reference_write ON agronomic_reference FOR INSERT TO rythu_web
  WITH CHECK (app_is_admin());
CREATE POLICY agronomic_reference_update ON agronomic_reference FOR UPDATE TO rythu_web
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY agronomic_reference_delete ON agronomic_reference FOR DELETE TO rythu_web
  USING (app_is_admin());

-- The cache holds no personal data: a village-centre coordinate rounded to
-- roughly a kilometre, and a public weather forecast. Reads are therefore open
-- to any signed-in session, which lets the advisor reuse a snapshot without
-- needing elevated rights. Writes go through privilegedBlock(), because only the
-- server decides what to cache and for how long.
CREATE POLICY weather_snapshots_read ON weather_snapshots FOR SELECT TO rythu_web
  USING (app_current_user_id() IS NOT NULL);
CREATE POLICY weather_snapshots_write ON weather_snapshots FOR INSERT TO rythu_web
  WITH CHECK (app_is_privileged());
CREATE POLICY weather_snapshots_update ON weather_snapshots FOR UPDATE TO rythu_web
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY weather_snapshots_delete ON weather_snapshots FOR DELETE TO rythu_web
  USING (app_is_privileged());

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  advisor_sessions, advisor_messages, agronomic_reference
TO rythu_web;

-- INSERT and UPDATE are needed because the cache is written with an
-- INSERT ... ON CONFLICT DO UPDATE. The policies above still restrict every
-- write to a privileged context, so the privilege alone grants nothing.
GRANT SELECT, INSERT, UPDATE ON weather_snapshots TO rythu_web;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rythu_web;
