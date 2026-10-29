-- ============================================================================
-- RythuDirect 0002 — Business rules, inventory safety, derived aggregates
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Order number: human-readable, collision-free, sequential per year.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE order_number_seq START 1000;

CREATE OR REPLACE FUNCTION next_order_number() RETURNS TEXT
LANGUAGE sql VOLATILE AS $$
  SELECT 'RD-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('order_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- Reserve inventory atomically.
--
-- The UPDATE ... WHERE stock_quantity >= qty is the whole point: the row lock
-- plus the predicate means two concurrent checkouts cannot both pass the check
-- for the last unit. If zero rows come back, we roll the transaction back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_product_stock(p_product_id UUID, p_qty NUMERIC)
RETURNS NUMERIC
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining NUMERIC(14,3);
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = 'P0001';
  END IF;

  UPDATE products
     SET stock_quantity = stock_quantity - p_qty,
         status = CASE
                    WHEN stock_quantity - p_qty <= 0 AND status = 'active'
                      THEN 'out_of_stock'::product_status
                    ELSE status
                  END
   WHERE id = p_product_id
     AND status IN ('active', 'out_of_stock')
     AND stock_quantity >= p_qty
  RETURNING stock_quantity INTO v_remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_remaining;
END;
$$;

-- Return stock to the shelf (cancellation / refund path).
CREATE OR REPLACE FUNCTION release_product_stock(p_product_id UUID, p_qty NUMERIC)
RETURNS NUMERIC
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining NUMERIC(14,3);
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = 'P0001';
  END IF;

  UPDATE products
     SET stock_quantity = stock_quantity + p_qty,
         status = CASE
                    WHEN status = 'out_of_stock' THEN 'active'::product_status
                    ELSE status
                  END
   WHERE id = p_product_id
  RETURNING stock_quantity INTO v_remaining;

  RETURN v_remaining;
END;
$$;

-- ---------------------------------------------------------------------------
-- Order status transition guard.
--
-- Enforced in the database so no API path (or future bug) can move an order
-- from delivered back to pending, or resurrect a cancelled order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_order_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_allowed order_status[];
BEGIN
  IF NEW.order_status = OLD.order_status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.order_status
    WHEN 'pending_confirmation' THEN ARRAY['accepted','cancelled']::order_status[]
    WHEN 'accepted'             THEN ARRAY['preparing','cancelled']::order_status[]
    WHEN 'preparing'            THEN ARRAY['ready_for_pickup','shipped','cancelled']::order_status[]
    WHEN 'ready_for_pickup'     THEN ARRAY['delivered','cancelled']::order_status[]
    WHEN 'shipped'              THEN ARRAY['delivered','refund_pending']::order_status[]
    WHEN 'delivered'            THEN ARRAY['refund_pending']::order_status[]
    WHEN 'refund_pending'       THEN ARRAY['refunded']::order_status[]
    ELSE ARRAY[]::order_status[]
  END;

  IF NOT (NEW.order_status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'ILLEGAL_ORDER_TRANSITION: % -> %', OLD.order_status, NEW.order_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Stamp the matching lifecycle timestamp once.
  NEW.accepted_at  := CASE WHEN NEW.order_status = 'accepted'  AND OLD.accepted_at  IS NULL THEN now() ELSE NEW.accepted_at  END;
  NEW.ready_at     := CASE WHEN NEW.order_status = 'ready_for_pickup' AND OLD.ready_at IS NULL THEN now() ELSE NEW.ready_at END;
  NEW.shipped_at   := CASE WHEN NEW.order_status = 'shipped'   AND OLD.shipped_at   IS NULL THEN now() ELSE NEW.shipped_at   END;
  NEW.delivered_at := CASE WHEN NEW.order_status = 'delivered' AND OLD.delivered_at IS NULL THEN now() ELSE NEW.delivered_at END;
  NEW.cancelled_at := CASE WHEN NEW.order_status = 'cancelled' AND OLD.cancelled_at IS NULL THEN now() ELSE NEW.cancelled_at END;

  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_guard_transition BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_order_transition();

-- ---------------------------------------------------------------------------
-- Payment status may only advance to 'captured' with a verified signature.
-- This is the database-level backstop for "never trust the frontend".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_payment_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('captured', 'refunded', 'refund_pending')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.provider <> 'cod'
     AND NOT NEW.signature_verified THEN
    RAISE EXCEPTION 'UNVERIFIED_PAYMENT: cannot mark % without a verified provider signature', NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_guard_status BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_status();

-- Keep orders.payment_status in step with the payment record.
CREATE OR REPLACE FUNCTION sync_order_payment_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders SET payment_status = NEW.status WHERE id = NEW.order_id
    AND payment_status IS DISTINCT FROM NEW.status;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_sync_order AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_order_payment_status();

-- ---------------------------------------------------------------------------
-- Derived rating aggregates. Recomputed from the source rows every time, so a
-- hidden or deleted review cannot leave a stale average behind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_product_rating() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id UUID := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  IF v_product_id IS NOT NULL THEN
    UPDATE products p
       SET rating_avg = COALESCE((
             SELECT round(avg(r.product_rating)::numeric, 2)
               FROM reviews r
              WHERE r.product_id = v_product_id AND NOT r.is_hidden
           ), 0),
           rating_count = (
             SELECT count(*) FROM reviews r
              WHERE r.product_id = v_product_id AND NOT r.is_hidden
           )
     WHERE p.id = v_product_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER reviews_refresh_product_rating
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION refresh_product_rating();

CREATE OR REPLACE FUNCTION refresh_farmer_rating() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_farmer_id UUID := COALESCE(NEW.farmer_id, OLD.farmer_id);
BEGIN
  IF v_farmer_id IS NOT NULL THEN
    UPDATE farmer_profiles f
       SET rating_avg = COALESCE((
             SELECT round(avg(r.seller_rating)::numeric, 2)
               FROM reviews r
              WHERE r.farmer_id = v_farmer_id AND NOT r.is_hidden
           ), 0),
           rating_count = (
             SELECT count(*) FROM reviews r
              WHERE r.farmer_id = v_farmer_id AND NOT r.is_hidden
           )
     WHERE f.user_id = v_farmer_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER reviews_refresh_farmer_rating
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION refresh_farmer_rating();

-- ---------------------------------------------------------------------------
-- Order items must all belong to the order's farmer. Stops a crafted request
-- from smuggling a second seller's product into a single-seller order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_order_item_farmer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_order_farmer UUID;
BEGIN
  SELECT farmer_id INTO v_order_farmer FROM orders WHERE id = NEW.order_id;
  IF v_order_farmer IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order_farmer <> NEW.farmer_id THEN
    RAISE EXCEPTION 'ORDER_ITEM_FARMER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_items_guard_farmer BEFORE INSERT OR UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION guard_order_item_farmer();

-- ---------------------------------------------------------------------------
-- Ledger: a captured payment credits the farmer; a refund debits them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger_on_order_status() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.order_status = 'delivered' AND OLD.order_status <> 'delivered' THEN
    INSERT INTO seller_ledger (farmer_id, order_id, entry_type, amount, description)
    VALUES (NEW.farmer_id, NEW.id, 'sale', NEW.items_subtotal,
            'Sale credited for order ' || NEW.order_number);
  ELSIF NEW.order_status = 'refunded' AND OLD.order_status <> 'refunded' THEN
    INSERT INTO seller_ledger (farmer_id, order_id, entry_type, amount, description)
    VALUES (NEW.farmer_id, NEW.id, 'refund', -NEW.items_subtotal,
            'Refund debited for order ' || NEW.order_number);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER orders_ledger AFTER UPDATE OF order_status ON orders
  FOR EACH ROW EXECUTE FUNCTION ledger_on_order_status();

-- ---------------------------------------------------------------------------
-- Conversation read markers follow the newest message per side.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_conversation_on_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations
     SET updated_at = now(),
         customer_last_read_at = CASE WHEN NEW.sender_id = customer_id
                                      THEN now() ELSE customer_last_read_at END,
         farmer_last_read_at   = CASE WHEN NEW.sender_id = farmer_id
                                      THEN now() ELSE farmer_last_read_at END
   WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER messages_touch_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION touch_conversation_on_message();

-- ---------------------------------------------------------------------------
-- Notify helper used by the API layer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_user(
  p_user_id UUID, p_kind notification_kind, p_title TEXT,
  p_body TEXT DEFAULT NULL, p_link TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (user_id, kind, title, body, link, metadata)
  VALUES (p_user_id, p_kind, p_title, p_body, p_link, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
