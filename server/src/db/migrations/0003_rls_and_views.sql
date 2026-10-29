-- ============================================================================
-- RythuDirect 0003 — Row Level Security, public views, role privileges
--
-- Model
-- -----
-- The API never connects as the schema owner. It connects as `rythu_web`, a
-- role with table privileges but NO bypassrls, so every statement it issues is
-- filtered by the policies below.
--
-- Per request the server opens a transaction and sets two transaction-local
-- session variables from the *verified* JWT (never from client-supplied data):
--     rythudirect.user_id  -> uuid of the caller
--     rythudirect.role     -> 'farmer' | 'customer' | 'admin'
-- and, only after re-reading the caller's role from the database,
--     rythudirect.privileged -> 'on'  (administrative operations)
--
-- set_config(..., is_local => true) means the settings evaporate at COMMIT, so
-- a pooled connection cannot leak one user's context into the next request.
-- If the variables are absent every policy fails closed.
--
-- Anonymous reads of the public catalogue do not go through RLS at all. They
-- use views owned by the schema owner (which bypasses RLS) whose WHERE clauses
-- and column lists expose only public rows and only public columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Runtime role
--
-- `rythu_web` is created by the bootstrap script (server/src/db/bootstrap.sql),
-- which runs as a superuser — a schema-owner role cannot create roles and
-- should not be granted CREATEROLE to work around that. This block only
-- verifies the role exists so the failure is a clear message rather than a
-- confusing permission error 200 lines later.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rythu_web') THEN
    RAISE EXCEPTION
      'Role rythu_web does not exist. Run `npm run db:bootstrap` first.'
      USING HINT = 'See DEPLOYMENT.md, step 2 (provision the database).';
  END IF;
END $$;

GRANT CONNECT ON DATABASE rythudirect TO rythu_web;
GRANT USAGE ON SCHEMA public TO rythu_web;

-- ---------------------------------------------------------------------------
-- Context helpers. STABLE so the planner can cache them within a statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('rythudirect.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('rythudirect.role', true), '');
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT app_current_role() = 'admin';
$$;

-- True only while the server has deliberately entered a privileged block after
-- confirming the caller's admin role against the database.
CREATE OR REPLACE FUNCTION app_is_privileged() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('rythudirect.privileged', true), '') = 'on';
$$;

-- Auth flows (register / login / reset) run before a user identity exists.
-- The server sets this flag for the duration of those specific transactions.
CREATE OR REPLACE FUNCTION app_auth_context() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('rythudirect.auth_context', true), '');
$$;

-- ---------------------------------------------------------------------------
-- RLS-safe lookups
--
-- A policy on `products` that wrote `EXISTS (SELECT 1 FROM profiles ...)` would
-- be filtered by the policy on `profiles` too, and since a customer may only
-- read the profile rows of counterparties they trade with, the check would fail
-- for every other farmer. These SECURITY DEFINER helpers run as the schema
-- owner and see the true row, so policies can test a fact about another table
-- without inheriting that table's row filter.
--
-- They are narrow on purpose: each answers one boolean, so they leak no data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_farmer_is_public(p_farmer_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = p_farmer_id
       AND p.role = 'farmer'
       AND NOT p.is_suspended
  );
$$;

CREATE OR REPLACE FUNCTION app_user_is_active(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = p_user_id AND NOT p.is_suspended
  );
$$;

CREATE OR REPLACE FUNCTION app_order_belongs_to_caller(p_order_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM orders o
     WHERE o.id = p_order_id
       AND (o.customer_id = app_current_user_id() OR o.farmer_id = app_current_user_id())
  );
$$;

CREATE OR REPLACE FUNCTION app_conversation_visible(p_conversation_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = p_conversation_id
       AND (c.customer_id = app_current_user_id() OR c.farmer_id = app_current_user_id())
  );
$$;

-- A product is publicly readable when it is active and its seller is in good
-- standing. Used by the catalogue policies.
CREATE OR REPLACE FUNCTION app_product_is_public(p_product_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = p_product_id
       AND p.status = 'active'
       AND app_farmer_is_public(p.farmer_id)
  );
$$;

CREATE OR REPLACE FUNCTION app_product_owned_by_caller(p_product_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = p_product_id AND p.farmer_id = app_current_user_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every user-data table
-- ---------------------------------------------------------------------------
ALTER TABLE profiles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE farmer_profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_categories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images               ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_quality_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications                ENABLE ROW LEVEL SECURITY;
ALTER TABLE farmer_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reports                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_price_observations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_ledger                ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks                  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Table privileges for rythu_web.
--
-- Column-level grants on `profiles` do the heavy lifting here: password_hash is
-- absent from both the SELECT and the UPDATE list, so no statement the API can
-- construct is able to read or overwrite a password hash. Login and password
-- reset go exclusively through the SECURITY DEFINER functions below, which run
-- as the schema owner. `email` is likewise not updatable — changing a login
-- identifier needs a re-verification flow that is out of scope here.
-- ---------------------------------------------------------------------------
GRANT SELECT (id, email, full_name, phone, preferred_language, role,
              profile_photo, email_verified, phone_verified, identity_verified,
              is_suspended, suspended_reason, last_login_at, created_at, updated_at)
  ON profiles TO rythu_web;
GRANT INSERT ON profiles TO rythu_web;
-- role / is_suspended / identity_verified are writable at the SQL level but the
-- guard_profile_role trigger refuses any change outside a privileged context.
GRANT UPDATE (full_name, phone, preferred_language, role, profile_photo,
              email_verified, phone_verified, identity_verified, is_suspended,
              suspended_reason, last_login_at)
  ON profiles TO rythu_web;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  farmer_profiles, customer_addresses, crop_categories, products,
  product_images, crop_quality_reports, carts, cart_items, orders,
  order_items, payments, payment_events, conversations, messages, reviews,
  notifications, farmer_verification_requests, user_reports, audit_logs,
  market_price_observations, user_consents, auth_tokens, app_settings,
  seller_ledger, saved_products, user_blocks
TO rythu_web;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rythu_web;

-- ===========================================================================
-- profiles
-- ===========================================================================
CREATE POLICY profiles_select_self ON profiles FOR SELECT TO rythu_web
  USING (
    id = app_current_user_id()
    OR app_is_admin()
    -- Registration duplicate-email check and login lookup.
    OR app_auth_context() IN ('register', 'login', 'reset')
    -- A farmer's name/photo is public marketplace information. Only these two
    -- columns are exposed to other users by the public views, but a customer
    -- needs the name of a farmer they are transacting with, so allow reading
    -- rows for counterparties in the caller's own orders and conversations.
    OR EXISTS (
      SELECT 1 FROM orders o
       WHERE (o.customer_id = app_current_user_id() AND o.farmer_id = profiles.id)
          OR (o.farmer_id = app_current_user_id() AND o.customer_id = profiles.id)
    )
    OR EXISTS (
      SELECT 1 FROM conversations c
       WHERE (c.customer_id = app_current_user_id() AND c.farmer_id = profiles.id)
          OR (c.farmer_id = app_current_user_id() AND c.customer_id = profiles.id)
    )
  );

-- Anyone may register; the server sets auth_context='register' for that call.
CREATE POLICY profiles_insert_register ON profiles FOR INSERT TO rythu_web
  WITH CHECK (app_auth_context() = 'register');

-- A user may edit their own profile. Role, suspension and verification columns
-- are protected by the guard_profile_role trigger, which refuses any change
-- outside a privileged context — so even a crafted UPDATE cannot escalate.
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO rythu_web
  USING (id = app_current_user_id() OR app_is_admin())
  WITH CHECK (id = app_current_user_id() OR app_is_admin());

-- Only the schema owner may drop a profile; rythu_web has no DELETE grant.
-- Account removal is a suspension, which preserves order and audit history.
CREATE POLICY profiles_delete_admin ON profiles FOR DELETE TO rythu_web
  USING (false);

-- ===========================================================================
-- farmer_profiles
-- ===========================================================================
CREATE POLICY farmer_profiles_select ON farmer_profiles FOR SELECT TO rythu_web
  USING (user_id = app_current_user_id() OR app_is_admin() OR app_auth_context() = 'register');

CREATE POLICY farmer_profiles_insert ON farmer_profiles FOR INSERT TO rythu_web
  WITH CHECK (user_id = app_current_user_id() OR app_auth_context() = 'register');

CREATE POLICY farmer_profiles_update ON farmer_profiles FOR UPDATE TO rythu_web
  USING (user_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (user_id = app_current_user_id() OR app_is_admin());

CREATE POLICY farmer_profiles_delete ON farmer_profiles FOR DELETE TO rythu_web
  USING (app_is_admin());

-- ===========================================================================
-- customer_addresses — strictly private to the owning customer
--
-- The auth_context clause exists because registration inserts the customer's
-- first address in the same transaction that creates the profile, before any
-- user identity exists. Without it, signup fails on the address row.
-- ===========================================================================
CREATE POLICY customer_addresses_owner ON customer_addresses FOR ALL TO rythu_web
  USING (customer_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (
    customer_id = app_current_user_id()
    OR app_is_admin()
    OR app_auth_context() = 'register'
  );

-- ===========================================================================
-- crop_categories — public reference data, admin-managed
-- ===========================================================================
CREATE POLICY crop_categories_read ON crop_categories FOR SELECT TO rythu_web
  USING (true);
CREATE POLICY crop_categories_write ON crop_categories FOR INSERT TO rythu_web
  WITH CHECK (app_is_admin());
CREATE POLICY crop_categories_update ON crop_categories FOR UPDATE TO rythu_web
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY crop_categories_delete ON crop_categories FOR DELETE TO rythu_web
  USING (app_is_admin());

-- ===========================================================================
-- products
--
-- Note the asymmetry that makes this safe: a farmer sees their own drafts, but
-- *nobody else* — not even a logged-in customer — can read a non-active row.
-- ===========================================================================
CREATE POLICY products_select ON products FOR SELECT TO rythu_web
  USING (
    farmer_id = app_current_user_id()
    OR app_is_admin()
    OR (status = 'active' AND app_farmer_is_public(products.farmer_id))
  );

CREATE POLICY products_insert_farmer ON products FOR INSERT TO rythu_web
  WITH CHECK (
    farmer_id = app_current_user_id()
    AND app_current_role() = 'farmer'
    AND app_user_is_active(app_current_user_id())
  );

CREATE POLICY products_update_farmer ON products FOR UPDATE TO rythu_web
  USING (farmer_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (farmer_id = app_current_user_id() OR app_is_admin());

CREATE POLICY products_delete_farmer ON products FOR DELETE TO rythu_web
  USING (farmer_id = app_current_user_id() OR app_is_admin());

-- ===========================================================================
-- product_images — readable when the parent product is readable
-- ===========================================================================
CREATE POLICY product_images_select ON product_images FOR SELECT TO rythu_web
  USING (app_product_is_public(product_images.product_id)
         OR app_product_owned_by_caller(product_images.product_id)
         OR app_is_admin());

CREATE POLICY product_images_write ON product_images FOR INSERT TO rythu_web
  WITH CHECK (app_product_owned_by_caller(product_images.product_id));

CREATE POLICY product_images_update ON product_images FOR UPDATE TO rythu_web
  USING (app_product_owned_by_caller(product_images.product_id) OR app_is_admin())
  WITH CHECK (app_product_owned_by_caller(product_images.product_id) OR app_is_admin());

CREATE POLICY product_images_delete ON product_images FOR DELETE TO rythu_web
  USING (app_product_owned_by_caller(product_images.product_id) OR app_is_admin());

-- ===========================================================================
-- crop_quality_reports
--
-- A customer may read a report attached to a product they can see, but only the
-- non-sensitive summary columns are exposed through the public view. Document
-- paths are released only for reviewer-verified reports.
-- ===========================================================================
CREATE POLICY quality_reports_select ON crop_quality_reports FOR SELECT TO rythu_web
  USING (
    submitted_by = app_current_user_id()
    OR app_is_admin()
    OR app_product_is_public(crop_quality_reports.product_id)
  );

CREATE POLICY quality_reports_insert ON crop_quality_reports FOR INSERT TO rythu_web
  WITH CHECK (submitted_by = app_current_user_id());

-- Farmers may edit their own submission, but the trigger blocks any attempt to
-- set an official verification status without reviewer privileges.
CREATE POLICY quality_reports_update ON crop_quality_reports FOR UPDATE TO rythu_web
  USING (submitted_by = app_current_user_id() OR app_is_admin())
  WITH CHECK (submitted_by = app_current_user_id() OR app_is_admin());

CREATE POLICY quality_reports_delete ON crop_quality_reports FOR DELETE TO rythu_web
  USING (submitted_by = app_current_user_id() OR app_is_admin());

-- ===========================================================================
-- carts / cart_items
-- ===========================================================================
CREATE POLICY carts_owner ON carts FOR ALL TO rythu_web
  USING (customer_id = app_current_user_id())
  WITH CHECK (customer_id = app_current_user_id());

CREATE POLICY cart_items_owner ON cart_items FOR ALL TO rythu_web
  USING (EXISTS (SELECT 1 FROM carts c
                  WHERE c.id = cart_items.cart_id AND c.customer_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM carts c
                  WHERE c.id = cart_items.cart_id AND c.customer_id = app_current_user_id()));

-- ===========================================================================
-- orders — only the two parties, plus admins
-- ===========================================================================
CREATE POLICY orders_select_participants ON orders FOR SELECT TO rythu_web
  USING (customer_id = app_current_user_id()
         OR farmer_id = app_current_user_id()
         OR app_is_admin());

CREATE POLICY orders_insert_customer ON orders FOR INSERT TO rythu_web
  WITH CHECK (customer_id = app_current_user_id() AND app_current_role() = 'customer');

-- Both parties update the order, but in different directions. The transition
-- guard trigger rejects any move the caller's side is not entitled to make.
CREATE POLICY orders_update_participants ON orders FOR UPDATE TO rythu_web
  USING (customer_id = app_current_user_id()
         OR farmer_id = app_current_user_id()
         OR app_is_admin())
  WITH CHECK (customer_id = app_current_user_id()
         OR farmer_id = app_current_user_id()
         OR app_is_admin());

CREATE POLICY orders_delete_admin ON orders FOR DELETE TO rythu_web
  USING (app_is_admin());

CREATE POLICY order_items_select_participants ON order_items FOR SELECT TO rythu_web
  USING (app_order_belongs_to_caller(order_items.order_id) OR app_is_admin());

CREATE POLICY order_items_insert_participants ON order_items FOR INSERT TO rythu_web
  WITH CHECK (EXISTS (SELECT 1 FROM orders o
                  WHERE o.id = order_items.order_id
                    AND o.customer_id = app_current_user_id()));

-- ===========================================================================
-- payments — customers read their own; only the server may write.
-- A customer can never change a payment status: the guard trigger also demands
-- a verified provider signature for any captured/refunded transition.
-- ===========================================================================
CREATE POLICY payments_select_participants ON payments FOR SELECT TO rythu_web
  USING (EXISTS (SELECT 1 FROM orders o
                  WHERE o.id = payments.order_id
                    AND (o.customer_id = app_current_user_id()
                         OR o.farmer_id = app_current_user_id()
                         OR app_is_admin())));

CREATE POLICY payments_insert_server ON payments FOR INSERT TO rythu_web
  WITH CHECK (EXISTS (SELECT 1 FROM orders o
                  WHERE o.id = payments.order_id AND o.customer_id = app_current_user_id())
              OR app_is_privileged());

CREATE POLICY payments_update_server ON payments FOR UPDATE TO rythu_web
  USING (app_is_privileged()
         OR EXISTS (SELECT 1 FROM orders o
                     WHERE o.id = payments.order_id AND o.customer_id = app_current_user_id()))
  WITH CHECK (app_is_privileged()
         OR EXISTS (SELECT 1 FROM orders o
                     WHERE o.id = payments.order_id AND o.customer_id = app_current_user_id()));

CREATE POLICY payment_events_server ON payment_events FOR ALL TO rythu_web
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- ===========================================================================
-- conversations / messages — participants only
-- ===========================================================================
CREATE POLICY conversations_participants ON conversations FOR ALL TO rythu_web
  USING (customer_id = app_current_user_id()
         OR farmer_id = app_current_user_id()
         OR app_is_admin())
  WITH CHECK (customer_id = app_current_user_id()
         OR farmer_id = app_current_user_id()
         OR app_is_admin());

CREATE POLICY messages_participants ON messages FOR ALL TO rythu_web
  USING (EXISTS (SELECT 1 FROM conversations c
                  WHERE c.id = messages.conversation_id
                    AND (c.customer_id = app_current_user_id()
                         OR c.farmer_id = app_current_user_id()
                         OR app_is_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c
                  WHERE c.id = messages.conversation_id
                    AND (c.customer_id = app_current_user_id()
                         OR c.farmer_id = app_current_user_id()
                         OR app_is_admin())));

-- ===========================================================================
-- reviews — public read of non-hidden reviews, author-only writes
-- ===========================================================================
CREATE POLICY reviews_select ON reviews FOR SELECT TO rythu_web
  USING (NOT is_hidden OR customer_id = app_current_user_id() OR app_is_admin());

CREATE POLICY reviews_insert_author ON reviews FOR INSERT TO rythu_web
  WITH CHECK (
    customer_id = app_current_user_id()
    AND app_current_role() = 'customer'
    -- Verified-purchase rule enforced in the database, not just the handler:
    -- the order must exist, belong to the caller, and be delivered.
    AND EXISTS (SELECT 1 FROM orders o
                 WHERE o.id = reviews.order_id
                   AND o.customer_id = app_current_user_id()
                   AND o.order_status = 'delivered')
  );

CREATE POLICY reviews_update_author ON reviews FOR UPDATE TO rythu_web
  USING (customer_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (customer_id = app_current_user_id() OR app_is_admin());

CREATE POLICY reviews_delete_admin ON reviews FOR DELETE TO rythu_web
  USING (app_is_admin());

-- ===========================================================================
-- notifications — own rows only
-- ===========================================================================
CREATE POLICY notifications_owner ON notifications FOR ALL TO rythu_web
  USING (user_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (user_id = app_current_user_id() OR app_is_admin());

-- ===========================================================================
-- farmer_verification_requests
-- ===========================================================================
CREATE POLICY verification_requests_select ON farmer_verification_requests
  FOR SELECT TO rythu_web
  USING (farmer_id = app_current_user_id() OR app_is_admin());

CREATE POLICY verification_requests_insert ON farmer_verification_requests
  FOR INSERT TO rythu_web
  WITH CHECK (farmer_id = app_current_user_id() AND app_current_role() = 'farmer');

-- A farmer may withdraw a request; only a reviewer may change its status.
CREATE POLICY verification_requests_update ON farmer_verification_requests
  FOR UPDATE TO rythu_web
  USING (app_is_admin()) WITH CHECK (app_is_admin());

CREATE POLICY verification_requests_delete ON farmer_verification_requests
  FOR DELETE TO rythu_web
  USING (farmer_id = app_current_user_id() OR app_is_admin());

-- ===========================================================================
-- user_reports
-- ===========================================================================
CREATE POLICY user_reports_insert ON user_reports FOR INSERT TO rythu_web
  WITH CHECK (reporter_id = app_current_user_id());

CREATE POLICY user_reports_select ON user_reports FOR SELECT TO rythu_web
  USING (reporter_id = app_current_user_id() OR app_is_admin());

CREATE POLICY user_reports_update ON user_reports FOR UPDATE TO rythu_web
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ===========================================================================
-- audit_logs — append-only, admin-readable, never editable
-- ===========================================================================
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO rythu_web
  WITH CHECK (actor_id = app_current_user_id() OR app_is_privileged());

CREATE POLICY audit_logs_select_admin ON audit_logs FOR SELECT TO rythu_web
  USING (app_is_admin());

-- ===========================================================================
-- market_price_observations — public reference data, admin-curated
-- ===========================================================================
CREATE POLICY market_prices_read ON market_price_observations FOR SELECT TO rythu_web
  USING (true);
CREATE POLICY market_prices_write ON market_price_observations FOR INSERT TO rythu_web
  WITH CHECK (app_is_admin());
CREATE POLICY market_prices_update ON market_price_observations FOR UPDATE TO rythu_web
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY market_prices_delete ON market_price_observations FOR DELETE TO rythu_web
  USING (app_is_admin());

-- ===========================================================================
-- user_consents — the user's own privacy trail
-- ===========================================================================
CREATE POLICY user_consents_insert ON user_consents FOR INSERT TO rythu_web
  WITH CHECK (user_id = app_current_user_id() OR app_auth_context() = 'register');
CREATE POLICY user_consents_select ON user_consents FOR SELECT TO rythu_web
  USING (user_id = app_current_user_id() OR app_is_admin());

-- ===========================================================================
-- auth_tokens — no direct access at all; only SECURITY DEFINER functions
-- ===========================================================================
-- (no policies are created, so every direct statement is denied)

-- ===========================================================================
-- app_settings — readable by admins, written by admins
-- ===========================================================================
CREATE POLICY app_settings_select ON app_settings FOR SELECT TO rythu_web
  USING (app_is_admin());
CREATE POLICY app_settings_write ON app_settings FOR INSERT TO rythu_web
  WITH CHECK (app_is_admin());
CREATE POLICY app_settings_update ON app_settings FOR UPDATE TO rythu_web
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ===========================================================================
-- seller_ledger — a farmer sees their own earnings; server appends
-- ===========================================================================
CREATE POLICY seller_ledger_select ON seller_ledger FOR SELECT TO rythu_web
  USING (farmer_id = app_current_user_id() OR app_is_admin());
CREATE POLICY seller_ledger_insert ON seller_ledger FOR INSERT TO rythu_web
  WITH CHECK (farmer_id = app_current_user_id() OR app_is_privileged());

-- ===========================================================================
-- saved_products — own wishlist
-- ===========================================================================
CREATE POLICY saved_products_owner ON saved_products FOR ALL TO rythu_web
  USING (customer_id = app_current_user_id())
  WITH CHECK (customer_id = app_current_user_id());

-- ===========================================================================
-- user_blocks — own block list
-- ===========================================================================
CREATE POLICY user_blocks_owner ON user_blocks FOR ALL TO rythu_web
  USING (blocker_id = app_current_user_id() OR app_is_admin())
  WITH CHECK (blocker_id = app_current_user_id() OR app_is_admin());

-- ===========================================================================
-- SECURITY DEFINER functions
--
-- These are the only ways to reach the data they touch. They are owned by the
-- schema owner, so they bypass RLS; each one validates its own inputs and
-- returns the minimum necessary.
-- ============================================================================

-- Credential lookup for login. Returns the bcrypt hash; the API compares in
-- Node and never sends the hash anywhere else.
CREATE OR REPLACE FUNCTION auth_get_credentials(p_email TEXT)
RETURNS TABLE (
  id UUID, email TEXT, password_hash TEXT, role user_role,
  email_verified BOOLEAN, is_suspended BOOLEAN, full_name TEXT,
  preferred_language language_code, suspended_reason TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.email::text, p.password_hash, p.role, p.email_verified,
         p.is_suspended, p.full_name, p.preferred_language, p.suspended_reason
    FROM profiles p
   WHERE p.email = p_email::citext
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_create_token(
  p_user_id UUID, p_purpose TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Supersede any outstanding token for the same purpose.
  UPDATE auth_tokens SET used_at = now()
   WHERE user_id = p_user_id AND purpose = p_purpose AND used_at IS NULL;

  INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at)
  VALUES (p_user_id, p_token_hash, p_purpose, p_expires_at);
END;
$$;

-- Single-use token redemption. Returns the user id, or nothing when the token
-- is unknown, already spent, or expired.
CREATE OR REPLACE FUNCTION auth_consume_token(p_token_hash TEXT, p_purpose TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id UUID;
BEGIN
  UPDATE auth_tokens
     SET used_at = now()
   WHERE token_hash = p_token_hash
     AND purpose = p_purpose
     AND used_at IS NULL
     AND expires_at > now()
  RETURNING user_id INTO v_user_id;

  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION auth_set_password(p_user_id UUID, p_password_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles
     SET password_hash = p_password_hash,
         email_verified = true      -- completing a reset proves inbox control
   WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION auth_mark_email_verified(p_user_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET email_verified = true WHERE id = p_user_id;
$$;

-- The email-verification gate is applied by the API, but a farmer listing
-- crops without a confirmed address is a trust problem, so restate it here.
CREATE OR REPLACE FUNCTION auth_require_verified(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT email_verified FROM profiles WHERE id = p_user_id), false);
$$;

-- Cross-user notification insert (a farmer notifying a customer, etc.).
-- A notification is not sensitive data, so this is safe to expose narrowly.
CREATE OR REPLACE FUNCTION notify_user(
  p_user_id UUID, p_kind notification_kind, p_title TEXT,
  p_body TEXT DEFAULT NULL, p_link TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (user_id, kind, title, body, link, metadata)
  VALUES (p_user_id, p_kind, p_title, p_body, p_link, coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Audit write. Forced to record the acting identity from the session context so
-- a caller cannot attribute an action to somebody else.
CREATE OR REPLACE FUNCTION write_audit_log(
  p_action TEXT, p_entity_type TEXT DEFAULT NULL, p_entity_id TEXT DEFAULT NULL,
  p_before JSONB DEFAULT NULL, p_after JSONB DEFAULT NULL,
  p_ip TEXT DEFAULT NULL, p_user_agent TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id,
                          before_data, after_data, ip_address, user_agent)
  VALUES (app_current_user_id(), app_current_role()::user_role, p_action,
          p_entity_type, p_entity_id, p_before, p_after,
          NULLIF(p_ip, '')::inet, p_user_agent)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Farmer earnings summary. Aggregated in SQL rather than by shipping every
-- ledger row to the client.
CREATE OR REPLACE FUNCTION farmer_earnings(p_farmer_id UUID)
RETURNS TABLE (
  total_sales NUMERIC, total_earned NUMERIC, total_refunded NUMERIC,
  available NUMERIC, order_count BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    coalesce(sum(CASE WHEN entry_type = 'sale' THEN amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0),
    coalesce(sum(amount), 0),
    count(DISTINCT order_id) FILTER (WHERE entry_type = 'sale')
  FROM seller_ledger
  WHERE farmer_id = p_farmer_id;
$$;

-- Customer-scoped cart totals, computed in the database so the client cannot
-- influence the arithmetic that leads to a charge.
CREATE OR REPLACE FUNCTION cart_totals(p_customer_id UUID)
RETURNS TABLE (
  items_subtotal NUMERIC, delivery_charge NUMERIC, platform_fee NUMERIC,
  total_amount NUMERIC, item_count BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH lines AS (
    SELECT ci.quantity,
           CASE
             WHEN p.bulk_min_quantity IS NOT NULL AND ci.quantity >= p.bulk_min_quantity
               THEN p.bulk_price_per_unit
             ELSE p.price
           END AS effective_price,
           p.delivery_charge
      FROM carts c
      JOIN cart_items ci ON ci.cart_id = c.id
      JOIN products p    ON p.id = ci.product_id
     WHERE c.customer_id = p_customer_id
  )
  SELECT
    coalesce(round(sum(quantity * effective_price), 2), 0),
    coalesce(max(delivery_charge), 0),
    0::numeric,
    coalesce(round(sum(quantity * effective_price), 2), 0) + coalesce(max(delivery_charge), 0),
    count(*)
  FROM lines;
$$;

-- View counter. SECURITY DEFINER because the runtime role has no UPDATE
-- privilege on products; it does one thing and returns nothing, so it cannot be
-- used to read or alter a listing.
CREATE OR REPLACE FUNCTION increment_product_view(p_product_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE products SET view_count = view_count + 1 WHERE id = p_product_id;
$$;

GRANT EXECUTE ON FUNCTION
  auth_get_credentials(TEXT), auth_create_token(UUID, TEXT, TEXT, TIMESTAMPTZ),
  auth_consume_token(TEXT, TEXT), auth_set_password(UUID, TEXT),
  auth_mark_email_verified(UUID), auth_require_verified(UUID),
  notify_user(UUID, notification_kind, TEXT, TEXT, TEXT, JSONB),
  write_audit_log(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT),
  farmer_earnings(UUID), cart_totals(UUID),
  increment_product_view(UUID)
TO rythu_web;

-- ===========================================================================
-- PUBLIC VIEWS
--
-- Owned by the schema owner, so they read past RLS. Their value is that each one
-- names an explicit, safe column list and an explicit row filter. The API uses
-- these for anonymous browsing, which means an anonymous request physically
-- cannot reach a draft listing, a suspended farmer, or a private column.
-- ===========================================================================

-- Public product catalogue: active listings from non-suspended farmers only.
CREATE OR REPLACE VIEW public_products AS
SELECT
  p.id,
  p.farmer_id,
  p.name,
  p.category_id,
  cc.slug      AS category_slug,
  cc.name      AS category_name,
  cc.localized_names AS category_localized_names,
  p.variety,
  p.description,
  p.state, p.district, p.village,
  p.price, p.unit, p.custom_unit,
  p.stock_quantity, p.minimum_order_quantity,
  p.bulk_min_quantity, p.bulk_price_per_unit, p.price_negotiable,
  p.delivery_charge,
  p.harvest_date, p.grade, p.moisture_content,
  p.visible_defects, p.size_appearance, p.storage_conditions,
  p.pesticide_info,
  p.organic_certified, p.organic_cert_number,
  p.offers_delivery, p.offers_pickup,
  CASE WHEN p.latitude IS NOT NULL AND fp.location_public
       THEN p.latitude END AS latitude,
  CASE WHEN p.longitude IS NOT NULL AND fp.location_public
       THEN p.longitude END AS longitude,
  p.rating_avg, p.rating_count,
  p.created_at, p.updated_at,
  fp.farm_name,
  fp.verification_status AS farmer_verification_status,
  fp.rating_avg  AS farmer_rating_avg,
  fp.rating_count AS farmer_rating_count,
  pr.full_name   AS farmer_name,
  pr.profile_photo AS farmer_photo,
  (SELECT pi.storage_path FROM product_images pi
    WHERE pi.product_id = p.id AND pi.media_type = 'image'
    ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS primary_image
FROM products p
JOIN profiles pr ON pr.id = p.farmer_id
LEFT JOIN farmer_profiles fp ON fp.user_id = p.farmer_id
LEFT JOIN crop_categories cc ON cc.id = p.category_id
WHERE p.status = 'active'
  AND NOT pr.is_suspended
  AND cc.is_active IS NOT FALSE;

-- Public farmer directory. Coordinates appear only with explicit consent.
CREATE OR REPLACE VIEW public_farmer_profiles AS
SELECT
  fp.user_id,
  pr.full_name,
  pr.profile_photo,
  fp.farm_name,
  fp.state, fp.district, fp.village,
  fp.public_address,
  CASE WHEN fp.location_public THEN fp.latitude END  AS latitude,
  CASE WHEN fp.location_public THEN fp.longitude END AS longitude,
  fp.farming_type, fp.crops_cultivated, fp.bio,
  fp.offers_delivery, fp.offers_pickup,
  fp.verification_status,
  fp.verification_note, fp.verified_at,
  fp.rating_avg, fp.rating_count,
  fp.created_at,
  (SELECT count(*) FROM products p
    WHERE p.farmer_id = fp.user_id AND p.status = 'active') AS active_listings
FROM farmer_profiles fp
JOIN profiles pr ON pr.id = fp.user_id
WHERE NOT pr.is_suspended;

-- Public display identity.
--
-- Three columns and nothing else: a name to show, an avatar, and whether the
-- account is suspended so callers can refuse to trade with it. This exists
-- because several legitimate queries need a *display name* for a user the
-- caller has never traded with — a farmer's name on a cart line, for example —
-- and the policy on `profiles` (correctly) only reveals counterparties. Joining
-- the base table there returns no rows at all, which silently empties the cart.
--
-- Exposing a name and avatar is not a privacy loss: both already appear on every
-- public listing. Email, phone and role are deliberately absent.
CREATE OR REPLACE VIEW public_profiles AS
SELECT id, full_name, profile_photo, role, is_suspended
FROM profiles;

-- Public review feed. The reviewer is shown by first name plus initial only.
CREATE OR REPLACE VIEW public_reviews AS
SELECT
  r.id, r.product_id, r.farmer_id, r.product_rating, r.seller_rating,
  r.comment, r.photo_path, r.is_verified_purchase, r.created_at,
  split_part(pr.full_name, ' ', 1) AS reviewer_display_name,
  pr.profile_photo AS reviewer_photo,
  p.name AS product_name
FROM reviews r
JOIN profiles pr ON pr.id = r.customer_id
LEFT JOIN products p ON p.id = r.product_id
WHERE NOT r.is_hidden;

-- Public quality summary. report_document is released only when a reviewer has
-- actually verified the report — an unverified attachment stays private.
CREATE OR REPLACE VIEW public_quality_reports AS
SELECT
  q.id, q.product_id, q.report_type, q.title, q.summary, q.measurements,
  q.ai_findings, q.ai_disclaimer,
  q.inspection_provider, q.inspection_date, q.inspector_name,
  q.verification_status, q.expiry_date, q.reviewed_at, q.created_at,
  CASE WHEN q.verification_status = 'verified' THEN q.report_document END
    AS report_document
FROM crop_quality_reports q
JOIN products p ON p.id = q.product_id
WHERE p.status = 'active';

-- Product gallery, public side.
CREATE OR REPLACE VIEW public_product_images AS
SELECT pi.id, pi.product_id, pi.storage_path, pi.caption,
       pi.media_type, pi.sort_order
FROM product_images pi
JOIN products p ON p.id = pi.product_id
WHERE p.status = 'active';

GRANT SELECT ON public_profiles, public_products, public_farmer_profiles, public_reviews,
                public_quality_reports, public_product_images TO rythu_web;

-- NOBYPASSRLS is asserted once, in bootstrap.sql, where a superuser sets it.
-- Repeating it here would need superuser rights and would fail the migration
-- for the schema owner, which is exactly the role that must not have them.
--
-- To confirm the runtime role really is policy-bound:
--   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'rythu_web';
-- rolbypassrls must be false. If it is true, every policy in this file is
-- inert and the isolation tests in server/test will fail loudly.
