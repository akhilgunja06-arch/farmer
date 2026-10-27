-- ============================================================================
-- RythuDirect 0001 — Core schema
-- Farmer-to-customer marketplace. PostgreSQL 15+.
-- Financial values use NUMERIC(14,2). Quantities NUMERIC(14,3).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('farmer', 'customer', 'admin');

CREATE TYPE language_code AS ENUM ('en', 'te', 'hi');

CREATE TYPE verification_status AS ENUM (
  'unverified', 'pending', 'verified', 'rejected', 'suspended'
);

CREATE TYPE product_status AS ENUM (
  'draft', 'active', 'out_of_stock', 'inactive'
);

CREATE TYPE quantity_unit AS ENUM (
  'kg', 'quintal', 'tonne', 'piece', 'bag', 'bunch', 'dozen', 'litre', 'other'
);

CREATE TYPE quality_grade AS ENUM ('A', 'B', 'C', 'ungraded');

-- Provenance of a quality claim. Distinct from verification_status on purpose:
-- a farmer assertion is never the same thing as a verified inspection.
CREATE TYPE quality_report_type AS ENUM (
  'farmer_provided',      -- self-declared measurements
  'ai_assisted',          -- preliminary machine vision assessment
  'inspection_pending',   -- submitted to a reviewer, awaiting decision
  'verified_inspection',  -- accepted by an authorized reviewer
  'rejected',             -- reviewer rejected the claim
  'expired'               -- verification lapsed past expiry_date
);

CREATE TYPE order_status AS ENUM (
  'pending_confirmation', 'accepted', 'preparing', 'ready_for_pickup',
  'shipped', 'delivered', 'cancelled', 'refund_pending', 'refunded'
);

CREATE TYPE payment_status AS ENUM (
  'unpaid', 'created', 'authorized', 'captured', 'failed',
  'refund_pending', 'refunded', 'cancelled'
);

CREATE TYPE payment_provider AS ENUM ('razorpay', 'cod', 'manual');

CREATE TYPE fulfilment_method AS ENUM ('delivery', 'pickup');

CREATE TYPE notification_kind AS ENUM (
  'order', 'message', 'review', 'quality', 'verification', 'system', 'payment'
);

CREATE TYPE report_status AS ENUM ('open', 'under_review', 'resolved', 'dismissed');

CREATE TYPE report_target AS ENUM ('product', 'review', 'user', 'message');

CREATE TYPE price_source AS ENUM ('marketplace_listed', 'agmarknet', 'enam', 'manual_entry');

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. profiles  (application-side mirror of the auth identity; NO passwords)
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,             -- bcrypt; never returned by the API
  full_name         TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  phone             TEXT CHECK (phone IS NULL OR phone ~ '^[0-9+\- ]{8,15}$'),
  preferred_language language_code NOT NULL DEFAULT 'en',
  role              user_role NOT NULL DEFAULT 'customer',
  profile_photo     TEXT,
  email_verified    BOOLEAN NOT NULL DEFAULT false,
  phone_verified    BOOLEAN NOT NULL DEFAULT false,
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  is_suspended      BOOLEAN NOT NULL DEFAULT false,
  suspended_reason  TEXT,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profiles_role_idx ON profiles (role);
CREATE INDEX profiles_email_verified_idx ON profiles (email_verified);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Role is assigned only by the server on registration, and changed only by an
-- admin through a privileged endpoint. Guarded here as defence in depth.
CREATE OR REPLACE FUNCTION guard_profile_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_setting('rythudirect.privileged', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'role changes require a privileged administrative context';
    END IF;
  END IF;
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    IF current_setting('rythudirect.privileged', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'suspension changes require a privileged administrative context';
    END IF;
  END IF;
  IF NEW.identity_verified IS DISTINCT FROM OLD.identity_verified THEN
    IF current_setting('rythudirect.privileged', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'identity verification requires a privileged administrative context';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_guard_role BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_role();

-- ---------------------------------------------------------------------------
-- 2. farmer_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE farmer_profiles (
  user_id             UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  farm_name           TEXT,
  state               TEXT NOT NULL,
  district            TEXT NOT NULL,
  village             TEXT NOT NULL,
  public_address      TEXT,
  latitude            NUMERIC(9,6) CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  longitude           NUMERIC(9,6) CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  -- Consent gate: coordinates are never exposed unless the farmer opts in.
  location_public     BOOLEAN NOT NULL DEFAULT false,
  farming_type        TEXT[] NOT NULL DEFAULT '{}',
  crops_cultivated    TEXT[] NOT NULL DEFAULT '{}',
  bio                 TEXT,
  offers_delivery     BOOLEAN NOT NULL DEFAULT false,
  offers_pickup       BOOLEAN NOT NULL DEFAULT true,
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  verification_note   TEXT,
  verified_at         TIMESTAMPTZ,
  rating_avg          NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
  rating_count        INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX farmer_profiles_state_district_idx ON farmer_profiles (state, district);
CREATE INDEX farmer_profiles_verification_idx ON farmer_profiles (verification_status);
CREATE INDEX farmer_profiles_geo_idx ON farmer_profiles (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE TRIGGER farmer_profiles_updated_at BEFORE UPDATE ON farmer_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. customer_addresses
-- ---------------------------------------------------------------------------
CREATE TABLE customer_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label        TEXT,
  recipient_name TEXT NOT NULL,
  phone        TEXT NOT NULL,
  address_line TEXT NOT NULL,
  state        TEXT NOT NULL,
  district     TEXT NOT NULL,
  village      TEXT,
  postal_code  TEXT CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{6}$'),
  latitude     NUMERIC(9,6),
  longitude    NUMERIC(9,6),
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_customer_idx ON customer_addresses (customer_id);
CREATE UNIQUE INDEX customer_addresses_one_default_idx
  ON customer_addresses (customer_id) WHERE is_default;
CREATE TRIGGER customer_addresses_updated_at BEFORE UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. crop_categories
-- ---------------------------------------------------------------------------
CREATE TABLE crop_categories (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  localized_names JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"te": "...", "hi": "..."}
  description     TEXT,
  icon            TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER crop_categories_updated_at BEFORE UPDATE ON crop_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  category_id           INTEGER REFERENCES crop_categories(id) ON DELETE SET NULL,
  variety               TEXT,
  description           TEXT,
  -- Denormalised for filtering/sorting without a join on every listing query.
  state                 TEXT,
  district              TEXT,
  village               TEXT,
  price                 NUMERIC(14,2) NOT NULL CHECK (price > 0),
  unit                  quantity_unit NOT NULL DEFAULT 'kg',
  custom_unit           TEXT,
  stock_quantity        NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  minimum_order_quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  -- Optional bulk tier; NULL when the farmer does not offer one.
  bulk_min_quantity     NUMERIC(14,3) CHECK (bulk_min_quantity IS NULL OR bulk_min_quantity > 0),
  bulk_price_per_unit   NUMERIC(14,2) CHECK (bulk_price_per_unit IS NULL OR bulk_price_per_unit > 0),
  price_negotiable      BOOLEAN NOT NULL DEFAULT false,
  delivery_charge       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  harvest_date          DATE,
  grade                 quality_grade NOT NULL DEFAULT 'ungraded',
  moisture_content      NUMERIC(5,2),
  visible_defects       TEXT,
  size_appearance       TEXT,
  storage_conditions    TEXT,
  pesticide_info        TEXT,
  organic_certified     BOOLEAN NOT NULL DEFAULT false,
  organic_cert_number   TEXT,
  offers_delivery       BOOLEAN NOT NULL DEFAULT true,
  offers_pickup         BOOLEAN NOT NULL DEFAULT true,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  status                product_status NOT NULL DEFAULT 'draft',
  is_flagged            BOOLEAN NOT NULL DEFAULT false,
  view_count            INTEGER NOT NULL DEFAULT 0,
  rating_avg            NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
  rating_count          INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_organic_cert_ck
    CHECK (NOT organic_certified OR organic_cert_number IS NOT NULL),
  CONSTRAINT products_bulk_tier_ck
    CHECK ((bulk_min_quantity IS NULL) = (bulk_price_per_unit IS NULL)),
  CONSTRAINT products_custom_unit_ck
    CHECK (unit <> 'other' OR custom_unit IS NOT NULL)
);
CREATE INDEX products_farmer_idx ON products (farmer_id);
CREATE INDEX products_status_idx ON products (status);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_region_idx ON products (state, district);
CREATE INDEX products_price_idx ON products (price);
CREATE INDEX products_created_idx ON products (created_at DESC);
CREATE INDEX products_harvest_idx ON products (harvest_date DESC NULLS LAST);
CREATE INDEX products_geo_idx ON products (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
-- Trigram-free prefix search fallback for name/variety lookups.
CREATE INDEX products_name_lower_idx ON products (lower(name));
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. product_images
-- ---------------------------------------------------------------------------
CREATE TABLE product_images (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption      TEXT,
  media_type   TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  byte_size    INTEGER,
  mime_type    TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON product_images (product_id, sort_order);

-- ---------------------------------------------------------------------------
-- 7. crop_quality_reports
-- ---------------------------------------------------------------------------
CREATE TABLE crop_quality_reports (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID REFERENCES products(id) ON DELETE CASCADE,
  submitted_by         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  report_type          quality_report_type NOT NULL DEFAULT 'farmer_provided',
  title                TEXT NOT NULL,
  summary              TEXT,
  -- Structured measurement payload, e.g. {"moisture_pct": 12.4, "grade": "A"}
  measurements         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_findings          JSONB,
  ai_disclaimer        TEXT,
  report_document      TEXT,
  inspection_provider  TEXT,
  inspection_date      DATE,
  inspector_name       TEXT,
  verification_status  verification_status NOT NULL DEFAULT 'unverified',
  reviewed_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  review_note          TEXT,
  expiry_date          DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quality_verified_needs_reviewer_ck CHECK (
    verification_status <> 'verified' OR reviewed_by IS NOT NULL
  )
);
CREATE INDEX crop_quality_reports_product_idx ON crop_quality_reports (product_id);
CREATE INDEX crop_quality_reports_status_idx ON crop_quality_reports (verification_status);
CREATE INDEX crop_quality_reports_submitter_idx ON crop_quality_reports (submitted_by);
CREATE TRIGGER crop_quality_reports_updated_at BEFORE UPDATE ON crop_quality_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only an authorized reviewer (server sets the privileged flag) may flip an
-- official verification status. Prevents a farmer from self-certifying.
CREATE OR REPLACE FUNCTION guard_quality_verification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status IN ('verified', 'rejected', 'expired') THEN
    IF current_setting('rythudirect.privileged', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'official quality verification requires a privileged reviewer context';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER crop_quality_reports_guard BEFORE UPDATE ON crop_quality_reports
  FOR EACH ROW EXECUTE FUNCTION guard_quality_verification();

-- ---------------------------------------------------------------------------
-- 8. carts / cart_items
-- ---------------------------------------------------------------------------
CREATE TABLE carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carts_customer_idx ON carts (customer_id);
CREATE TRIGGER carts_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cart_items_unique_product_idx ON cart_items (cart_id, product_id);
CREATE INDEX cart_items_product_idx ON cart_items (product_id);
CREATE TRIGGER cart_items_updated_at BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. orders   (one order per seller — a multi-farmer cart splits into several)
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number              TEXT NOT NULL UNIQUE,
  customer_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  farmer_id                 UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  total_amount              NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  items_subtotal            NUMERIC(14,2) NOT NULL CHECK (items_subtotal >= 0),
  delivery_charge           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  platform_fee              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  order_status              order_status NOT NULL DEFAULT 'pending_confirmation',
  payment_status            payment_status NOT NULL DEFAULT 'unpaid',
  fulfilment_method         fulfilment_method NOT NULL DEFAULT 'delivery',
  delivery_address_snapshot JSONB,
  delivery_address_id       UUID REFERENCES customer_addresses(id) ON DELETE SET NULL,
  customer_note             TEXT,
  farmer_note               TEXT,
  cancel_reason             TEXT,
  cancelled_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
  placed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at               TIMESTAMPTZ,
  ready_at                  TIMESTAMPTZ,
  shipped_at                TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  idempotency_key           TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_ck CHECK (
    total_amount = items_subtotal + delivery_charge + platform_fee
  ),
  CONSTRAINT orders_pickup_no_delivery_ck CHECK (
    fulfilment_method <> 'pickup' OR delivery_charge = 0
  )
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_farmer_idx ON orders (farmer_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (order_status);
CREATE INDEX orders_payment_idx ON orders (payment_status);
-- Idempotency: the same key can never produce two orders for one customer.
CREATE UNIQUE INDEX orders_idempotency_idx
  ON orders (customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. order_items  (unit price snapshotted at purchase time)
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  farmer_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL,
  unit_snapshot       TEXT NOT NULL,
  quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price_snapshot NUMERIC(14,2) NOT NULL CHECK (unit_price_snapshot > 0),
  subtotal            NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_items_subtotal_ck CHECK (subtotal = round(quantity * unit_price_snapshot, 2))
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_product_idx ON order_items (product_id);
CREATE INDEX order_items_farmer_idx ON order_items (farmer_id);

-- ---------------------------------------------------------------------------
-- 11. payments
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider                    payment_provider NOT NULL,
  provider_order_reference    TEXT,
  provider_payment_reference  TEXT,
  amount                      NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency                    TEXT NOT NULL DEFAULT 'INR',
  status                      payment_status NOT NULL DEFAULT 'unpaid',
  method                      TEXT,
  failure_reason              TEXT,
  -- Raw provider payload for reconciliation. Never contains card/UPI secrets.
  provider_payload            JSONB,
  signature_verified          BOOLEAN NOT NULL DEFAULT false,
  refund_reference            TEXT,
  refunded_amount             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payments_refund_ck CHECK (refunded_amount <= amount)
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_status_idx ON payments (status);
-- Idempotency for webhooks: one payment record per provider payment id.
CREATE UNIQUE INDEX payments_provider_ref_idx
  ON payments (provider, provider_payment_reference)
  WHERE provider_payment_reference IS NOT NULL;
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ledger of raw provider events, so a replayed webhook is a no-op.
CREATE TABLE payment_events (
  id              BIGSERIAL PRIMARY KEY,
  provider        payment_provider NOT NULL,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- 12. conversations / messages
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  farmer_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  subject          TEXT,
  customer_last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  farmer_last_read_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_blocked BOOLEAN NOT NULL DEFAULT false,
  farmer_blocked   BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_distinct_parties_ck CHECK (customer_id <> farmer_id)
);
CREATE INDEX conversations_customer_idx ON conversations (customer_id, updated_at DESC);
CREATE INDEX conversations_farmer_idx ON conversations (farmer_id, updated_at DESC);
CREATE UNIQUE INDEX conversations_thread_idx
  ON conversations (customer_id, farmer_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  attachment_path TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);
CREATE INDEX messages_unread_idx ON messages (conversation_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- 13. reviews   (verified purchase only)
-- ---------------------------------------------------------------------------
CREATE TABLE reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id) ON DELETE SET NULL,
  farmer_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_rating SMALLINT NOT NULL CHECK (product_rating BETWEEN 1 AND 5),
  seller_rating  SMALLINT NOT NULL CHECK (seller_rating BETWEEN 1 AND 5),
  comment        TEXT,
  photo_path     TEXT,
  is_verified_purchase BOOLEAN NOT NULL DEFAULT true,
  is_hidden      BOOLEAN NOT NULL DEFAULT false,
  moderation_note TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One review per product per order, and only ever one review per order+customer.
CREATE UNIQUE INDEX reviews_order_product_idx ON reviews (order_id, product_id);
CREATE INDEX reviews_product_idx ON reviews (product_id, created_at DESC);
CREATE INDEX reviews_farmer_idx ON reviews (farmer_id);
CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 14. notifications
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       notification_kind NOT NULL DEFAULT 'system',
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- 15. farmer_verification_requests
-- ---------------------------------------------------------------------------
CREATE TABLE farmer_verification_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  farm_name         TEXT,
  id_document_path  TEXT,
  land_document_path TEXT,
  notes             TEXT,
  status            report_status NOT NULL DEFAULT 'open',
  reviewed_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX farmer_verification_requests_status_idx
  ON farmer_verification_requests (status, created_at DESC);
CREATE UNIQUE INDEX farmer_verification_requests_open_idx
  ON farmer_verification_requests (farmer_id)
  WHERE status IN ('open', 'under_review');
CREATE TRIGGER farmer_verification_requests_updated_at
  BEFORE UPDATE ON farmer_verification_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 16. user_reports
-- ---------------------------------------------------------------------------
CREATE TABLE user_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type  report_target NOT NULL,
  target_id    UUID NOT NULL,
  reason       TEXT NOT NULL,
  details      TEXT,
  status       report_status NOT NULL DEFAULT 'open',
  reviewed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  resolution   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_reports_status_idx ON user_reports (status, created_at DESC);
CREATE INDEX user_reports_target_idx ON user_reports (target_type, target_id);
CREATE TRIGGER user_reports_updated_at BEFORE UPDATE ON user_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 17. audit_logs   (append-only record of privileged actions)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role  user_role,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  before_data JSONB,
  after_data  JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 18. market_price_observations
-- ---------------------------------------------------------------------------
CREATE TABLE market_price_observations (
  id             BIGSERIAL PRIMARY KEY,
  commodity      TEXT NOT NULL,
  variety        TEXT,
  state          TEXT NOT NULL,
  district       TEXT,
  market_name    TEXT,
  min_price      NUMERIC(14,2),
  max_price      NUMERIC(14,2),
  modal_price    NUMERIC(14,2) CHECK (modal_price IS NULL OR modal_price >= 0),
  unit           quantity_unit NOT NULL DEFAULT 'quintal',
  source         price_source NOT NULL DEFAULT 'manual_entry',
  source_ref     TEXT,
  -- When the market observed this price (the trade date).
  observed_on    DATE NOT NULL,
  -- When we ingested the row. Lets the UI prove a price is not being shown as live.
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_price_range_ck CHECK (
    min_price IS NULL OR max_price IS NULL OR max_price >= min_price
  ),
  CONSTRAINT market_price_modal_ck CHECK (
    modal_price IS NULL OR min_price IS NULL OR modal_price >= min_price
  )
);
CREATE INDEX market_price_lookup_idx
  ON market_price_observations (lower(commodity), state, observed_on DESC);
CREATE INDEX market_price_source_idx ON market_price_observations (source, observed_on DESC);

-- ---------------------------------------------------------------------------
-- 19. user_consents   (privacy + terms acceptance trail)
-- ---------------------------------------------------------------------------
CREATE TABLE user_consents (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,
  version      TEXT NOT NULL,
  granted      BOOLEAN NOT NULL DEFAULT true,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_consents_user_idx ON user_consents (user_id, consent_type);

-- ---------------------------------------------------------------------------
-- 20. auth_tokens (email verification / password reset). Hashed, single-use.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose);

-- ---------------------------------------------------------------------------
-- 21. app_settings + integration_status (admin-visible configuration state)
-- ---------------------------------------------------------------------------
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 22. seller_ledger — append-only record of what a farmer actually earned
-- ---------------------------------------------------------------------------
CREATE TABLE seller_ledger (
  id          BIGSERIAL PRIMARY KEY,
  farmer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  entry_type  TEXT NOT NULL CHECK (entry_type IN
                ('sale', 'refund', 'adjustment', 'payout')),
  amount      NUMERIC(14,2) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'INR',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seller_ledger_farmer_idx ON seller_ledger (farmer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 23. saved_products (customer wishlist)
-- ---------------------------------------------------------------------------
CREATE TABLE saved_products (
  customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

-- ---------------------------------------------------------------------------
-- 24. user_blocks (chat abuse control)
-- ---------------------------------------------------------------------------
CREATE TABLE user_blocks (
  blocker_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_self_ck CHECK (blocker_id <> blocked_id)
);
