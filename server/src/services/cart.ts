import { HttpError } from '../db/pool.js';
import { q, q1 } from './helpers.js';
import { round2 } from './orders.js';

/**
 * The customer's cart, or a new empty one.
 *
 * Every customer has exactly one cart, created on first use. The unique index
 * on carts.customer_id is what makes that a guarantee rather than a hope.
 */
async function getOrCreateCart(customerId: string): Promise<string> {
  const existing = await q1<{ id: string }>('SELECT id FROM carts WHERE customer_id = $1', [
    customerId,
  ]);
  if (existing) return existing.id;

  const created = await q1<{ id: string }>(
    `INSERT INTO carts (customer_id) VALUES ($1)
     ON CONFLICT (customer_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [customerId],
  );
  if (!created) throw new HttpError(500, 'The cart could not be created.', 'CART_FAILED');
  return created.id;
}

export interface CartLine {
  id: string;
  product_id: string;
  quantity: number;
  effective_unit_price: number;
  list_price: number;
  bulk_applied: boolean;
  line_subtotal: number;
  name: string;
  variety: string | null;
  unit: string;
  custom_unit: string | null;
  stock_quantity: number;
  minimum_order_quantity: number;
  bulk_min_quantity: number | null;
  delivery_charge: number;
  product_status: string;
  offers_delivery: boolean;
  offers_pickup: boolean;
  farmer_id: string;
  farmer_name: string;
  state: string | null;
  district: string | null;
  image: string | null;
  available: boolean;
  issue: string | null;
}

export interface CartView {
  id: string;
  lines: CartLine[];
  groups: Array<{
    farmer_id: string;
    farmer_name: string;
    state: string | null;
    district: string | null;
    lines: CartLine[];
    items_subtotal: number;
    delivery_charge: number;
    total_amount: number;
    offers_delivery: boolean;
    offers_pickup: boolean;
  }>;
  items_subtotal: number;
  delivery_charge: number;
  platform_fee: number;
  total_amount: number;
  item_count: number;
  has_issues: boolean;
}

/**
 * Read the cart, priced the same way checkout will price it.
 *
 * Availability is recomputed here rather than trusted from when the item was
 * added, so a customer sees "only 3 kg left" instead of discovering it at
 * checkout.
 */
export async function getCart(customerId: string): Promise<CartView> {
  const cartId = await getOrCreateCart(customerId);

  const rows = await q<CartLine>(
    `SELECT ci.id, ci.product_id, ci.quantity,
            CASE
              WHEN p.bulk_min_quantity IS NOT NULL AND ci.quantity >= p.bulk_min_quantity
                THEN p.bulk_price_per_unit
              ELSE p.price
            END AS effective_unit_price,
            (p.bulk_min_quantity IS NOT NULL AND ci.quantity >= p.bulk_min_quantity) AS bulk_applied,
            p.price AS list_price,
            round(ci.quantity * CASE
              WHEN p.bulk_min_quantity IS NOT NULL AND ci.quantity >= p.bulk_min_quantity
                THEN p.bulk_price_per_unit
              ELSE p.price END, 2) AS line_subtotal,
            p.name, p.variety, p.unit::text, p.custom_unit,
            p.stock_quantity, p.minimum_order_quantity, p.bulk_min_quantity,
            p.delivery_charge, p.status::text AS product_status,
            p.offers_delivery, p.offers_pickup,
            p.farmer_id, pr.full_name AS farmer_name,
            p.state, p.district,
            (SELECT pi.storage_path FROM product_images pi
              WHERE pi.product_id = p.id AND pi.media_type = 'image'
              ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS image
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
       JOIN products p ON p.id = ci.product_id
       JOIN public_profiles pr ON pr.id = p.farmer_id
      WHERE c.id = $1
      ORDER BY p.farmer_id, ci.added_at`,
    [cartId],
  );

  const lines: CartLine[] = rows.map((row) => {
    const quantity = Number(row.quantity);
    const stock = Number(row.stock_quantity);
    const minimum = Number(row.minimum_order_quantity);

    let issue: string | null = null;
    if (row.product_status !== 'active') {
      issue = 'This listing is no longer available.';
    } else if (quantity > stock) {
      issue = `Only ${stock} ${row.unit === 'other' ? (row.custom_unit ?? 'unit') : row.unit} left.`;
    } else if (quantity < minimum) {
      issue = `Minimum order is ${minimum} ${row.unit === 'other' ? (row.custom_unit ?? 'unit') : row.unit}.`;
    }

    return {
      ...row,
      quantity,
      effective_unit_price: Number(row.effective_unit_price),
      list_price: Number(row.list_price),
      line_subtotal: Number(row.line_subtotal),
      bulk_applied: Boolean(row.bulk_applied),
      stock_quantity: stock,
      minimum_order_quantity: minimum,
      delivery_charge: Number(row.delivery_charge),
      available: issue === null,
      issue,
    };
  });

  // Group by seller so the UI can show "3 items from Ravi Farms" and a
  // per-seller delivery charge, matching how the orders are split.
  const groupMap = new Map<string, CartView['groups'][number]>();
  for (const line of lines) {
    let group = groupMap.get(line.farmer_id);
    if (!group) {
      group = {
        farmer_id: line.farmer_id,
        farmer_name: line.farmer_name,
        state: line.state,
        district: line.district,
        lines: [],
        items_subtotal: 0,
        delivery_charge: 0,
        total_amount: 0,
        offers_delivery: line.offers_delivery,
        offers_pickup: line.offers_pickup,
      };
      groupMap.set(line.farmer_id, group);
    }
    group.lines.push(line);
    group.items_subtotal = round2(group.items_subtotal + line.line_subtotal);
    // One delivery charge per seller, taken as the highest of their lines.
    group.delivery_charge = Math.max(group.delivery_charge, line.delivery_charge);
    group.offers_delivery = group.offers_delivery && line.offers_delivery;
    group.offers_pickup = group.offers_pickup && line.offers_pickup;
  }

  const groups = [...groupMap.values()].map((group) => ({
    ...group,
    total_amount: round2(group.items_subtotal + group.delivery_charge),
  }));

  const itemsSubtotal = round2(groups.reduce((sum, g) => sum + g.items_subtotal, 0));
  const deliveryCharge = round2(groups.reduce((sum, g) => sum + g.delivery_charge, 0));

  return {
    id: cartId,
    lines,
    groups,
    items_subtotal: itemsSubtotal,
    delivery_charge: deliveryCharge,
    platform_fee: 0,
    total_amount: round2(itemsSubtotal + deliveryCharge),
    item_count: lines.length,
    has_issues: lines.some((l) => !l.available),
  };
}

/**
 * Add a product to the cart.
 *
 * Rejects up front when the requested quantity exceeds what is on the shelf,
 * rather than letting the customer reach checkout with an order that cannot be
 * filled.
 */
export async function addToCart(
  customerId: string,
  productId: string,
  quantity: number,
): Promise<CartView> {
  if (!(quantity > 0)) {
    throw new HttpError(400, 'Quantity must be greater than zero.', 'INVALID_QUANTITY');
  }

  const product = await q1<{
    id: string; farmer_id: string; stock_quantity: number;
    minimum_order_quantity: number; status: string; name: string; unit: string;
    custom_unit: string | null;
  }>(
    `SELECT id, farmer_id, stock_quantity, minimum_order_quantity,
            status::text AS status, name, unit::text AS unit, custom_unit
       FROM products WHERE id = $1`,
    [productId],
  );
  if (!product) {
    throw new HttpError(404, 'That product is not available.', 'PRODUCT_NOT_FOUND');
  }
  if (product.status !== 'active') {
    throw new HttpError(409, 'That listing is not currently available.', 'PRODUCT_UNAVAILABLE');
  }

  const unit = product.unit === 'other' ? (product.custom_unit ?? 'unit') : product.unit;

  if (quantity < Number(product.minimum_order_quantity)) {
    throw new HttpError(
      400,
      `The minimum order for this item is ${product.minimum_order_quantity} ${unit}.`,
      'BELOW_MINIMUM',
      { quantity: `Enter at least ${product.minimum_order_quantity}.` },
    );
  }
  if (quantity > Number(product.stock_quantity)) {
    throw new HttpError(
      409,
      `Only ${product.stock_quantity} ${unit} of ${product.name} are available.`,
      'INSUFFICIENT_STOCK',
      { quantity: `At most ${product.stock_quantity} can be ordered.` },
    );
  }

  const cartId = await getOrCreateCart(customerId);

  // Adding an item already in the cart accumulates, and the combined total is
  // re-checked against stock so repeated adds cannot walk past the limit.
  const existing = await q1<{ quantity: number }>(
    'SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
    [cartId, productId],
  );
  const combined = Number(existing?.quantity ?? 0) + quantity;

  if (combined > Number(product.stock_quantity)) {
    throw new HttpError(
      409,
      `Adding that many would exceed the ${product.stock_quantity} ${unit} available.`,
      'INSUFFICIENT_STOCK',
      { quantity: `At most ${product.stock_quantity} can be ordered in total.` },
    );
  }

  await q(
    `INSERT INTO cart_items (cart_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, product_id)
     DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()`,
    [cartId, productId, quantity],
  );

  return getCart(customerId);
}

export async function updateCartItem(
  customerId: string,
  cartItemId: string,
  quantity: number,
): Promise<CartView> {
  if (quantity <= 0) {
    return removeCartItem(customerId, cartItemId);
  }

  const line = await q1<{
    product_id: string; stock_quantity: number; minimum_order_quantity: number;
    name: string; unit: string; custom_unit: string | null; status: string;
  }>(
    `SELECT ci.product_id, p.stock_quantity, p.minimum_order_quantity,
            p.name, p.unit::text AS unit, p.custom_unit, p.status::text AS status
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
       JOIN products p ON p.id = ci.product_id
      WHERE ci.id = $1 AND c.customer_id = $2`,
    [cartItemId, customerId],
  );
  if (!line) {
    throw new HttpError(404, 'That cart item could not be found.', 'CART_ITEM_NOT_FOUND');
  }

  const unit = line.unit === 'other' ? (line.custom_unit ?? 'unit') : line.unit;

  if (quantity < Number(line.minimum_order_quantity)) {
    throw new HttpError(
      400,
      `The minimum order for ${line.name} is ${line.minimum_order_quantity} ${unit}.`,
      'BELOW_MINIMUM',
      { quantity: `Enter at least ${line.minimum_order_quantity}.` },
    );
  }
  if (quantity > Number(line.stock_quantity)) {
    throw new HttpError(
      409,
      `Only ${line.stock_quantity} ${unit} of ${line.name} are available.`,
      'INSUFFICIENT_STOCK',
      { quantity: `At most ${line.stock_quantity} can be ordered.` },
    );
  }

  await q(
    `UPDATE cart_items SET quantity = $1, updated_at = now()
      WHERE id = $2 AND cart_id IN (SELECT id FROM carts WHERE customer_id = $3)`,
    [quantity, cartItemId, customerId],
  );

  return getCart(customerId);
}

export async function removeCartItem(customerId: string, cartItemId: string): Promise<CartView> {
  const removed = await q(
    `DELETE FROM cart_items
      WHERE id = $1
        AND cart_id IN (SELECT id FROM carts WHERE customer_id = $2)
      RETURNING id`,
    [cartItemId, customerId],
  );
  if (removed.length === 0) {
    throw new HttpError(404, 'That cart item could not be found.', 'CART_ITEM_NOT_FOUND');
  }
  return getCart(customerId);
}

export async function clearCart(customerId: string): Promise<CartView> {
  await q(
    'DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE customer_id = $1)',
    [customerId],
  );
  return getCart(customerId);
}

/** Number of distinct lines, for the header badge. */
export async function cartItemCount(customerId: string): Promise<number> {
  const row = await q1<{ n: number }>(
    `SELECT coalesce(sum(1), 0)::int AS n
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
      WHERE c.customer_id = $1`,
    [customerId],
  );
  return row?.n ?? 0;
}
