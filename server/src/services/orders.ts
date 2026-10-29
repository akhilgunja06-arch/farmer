import { HttpError, currentClient } from '../db/pool.js';
import { sendNewOrderEmailToFarmer, sendOrderPlacedEmail, sendOrderStatusEmail } from './email.js';
import { audit, count, notify, q, q1, type Page, toPage, type Pagination } from './helpers.js';

/** Per-order platform fee. Zero today; the column exists so it can be set. */
const PLATFORM_FEE = 0;

export type OrderStatus =
  | 'pending_confirmation' | 'accepted' | 'preparing' | 'ready_for_pickup'
  | 'shipped' | 'delivered' | 'cancelled' | 'refund_pending' | 'refunded';

interface CartLine {
  cart_item_id: string;
  product_id: string;
  farmer_id: string;
  product_name: string;
  unit: string;
  custom_unit: string | null;
  quantity: number;
  unit_price: number;
  price: number;
  bulk_min_quantity: number | null;
  bulk_price_per_unit: number | null;
  delivery_charge: number;
  stock_quantity: number;
  minimum_order_quantity: number;
  product_status: string;
  offers_delivery: boolean;
  offers_pickup: boolean;
  farmer_suspended: boolean;
  farmer_name: string;
}

/** The effective unit price, applying a bulk tier when the quantity qualifies. */
function effectiveUnitPrice(line: CartLine): number {
  if (line.bulk_min_quantity !== null && line.quantity >= Number(line.bulk_min_quantity)) {
    return Number(line.bulk_price_per_unit);
  }
  return Number(line.price);
}

/**
 * Create orders from the caller's cart.
 *
 * A cart spanning several farmers becomes one order per farmer, because an
 * order has a single seller who accepts, prepares and ships it. That is the
 * "split into separate seller orders" model the brief allows for.
 *
 * Everything below runs inside the request's single transaction, so either all
 * of the resulting orders exist or none do.
 */
export async function checkout(
  customerId: string,
  input: {
    fulfilment_method: 'delivery' | 'pickup';
    address_id?: string | null;
    customer_note?: string | null;
    idempotency_key?: string | null;
  },
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ orders: Array<Record<string, unknown>>; totalAmount: number }> {
  const client = currentClient();

  // Idempotency: a retried submit with the same key returns the orders that
  // already exist rather than creating a second set.
  if (input.idempotency_key) {
    const existing = await q<{ id: string; order_number: string }>(
      'SELECT id, order_number FROM orders WHERE customer_id = $1 AND idempotency_key = $2',
      [customerId, input.idempotency_key],
    );
    if (existing.length > 0) {
      const orders = await Promise.all(existing.map((o) => getOrderDetail(o.id)));
      return {
        orders,
        totalAmount: orders.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0),
      };
    }
  }

  const lines = await q<CartLine>(
    `SELECT ci.id AS cart_item_id, ci.product_id, ci.quantity,
            p.farmer_id, p.name AS product_name, p.unit, p.custom_unit,
            p.price, p.bulk_min_quantity, p.bulk_price_per_unit,
            p.delivery_charge, p.stock_quantity, p.minimum_order_quantity,
            p.status::text AS product_status,
            p.offers_delivery, p.offers_pickup,
            pr.is_suspended AS farmer_suspended,
            pr.full_name AS farmer_name
       FROM carts c
       JOIN cart_items ci ON ci.cart_id = c.id
       JOIN products p    ON p.id = ci.product_id
       JOIN public_profiles pr ON pr.id = p.farmer_id
      WHERE c.customer_id = $1
      ORDER BY p.farmer_id`,
    [customerId],
  );

  if (lines.length === 0) {
    throw new HttpError(400, 'Your cart is empty.', 'CART_EMPTY');
  }

  // --- Pre-flight validation, before anything is written ---------------------
  const problems: Array<{ product_id: string; message: string }> = [];
  for (const line of lines) {
    const name = line.product_name;
    if (line.product_status !== 'active') {
      problems.push({ product_id: line.product_id, message: `${name} is no longer available.` });
      continue;
    }
    if (line.farmer_suspended) {
      problems.push({ product_id: line.product_id, message: `${name} is no longer sold.` });
      continue;
    }
    const qty = Number(line.quantity);
    if (qty < Number(line.minimum_order_quantity)) {
      problems.push({
        product_id: line.product_id,
        message: `${name} has a minimum order of ${line.minimum_order_quantity} ${unitLabel(line)}.`,
      });
    }
    if (qty > Number(line.stock_quantity)) {
      problems.push({
        product_id: line.product_id,
        message: `Only ${line.stock_quantity} ${unitLabel(line)} of ${name} remain.`,
      });
    }
    if (input.fulfilment_method === 'delivery' && !line.offers_delivery) {
      problems.push({ product_id: line.product_id, message: `${name} is pickup only.` });
    }
    if (input.fulfilment_method === 'pickup' && !line.offers_pickup) {
      problems.push({ product_id: line.product_id, message: `${name} is delivery only.` });
    }
  }
  if (problems.length > 0) {
    throw new HttpError(
      409,
      'Some items in your cart need attention before you can order.',
      'CART_VALIDATION_FAILED',
      problems,
    );
  }

  // --- Address ---------------------------------------------------------------
  let addressSnapshot: Record<string, unknown> | null = null;
  let addressId: string | null = null;

  if (input.fulfilment_method === 'delivery') {
    const address = input.address_id
      ? await q1<Record<string, unknown>>(
          'SELECT * FROM customer_addresses WHERE id = $1 AND customer_id = $2',
          [input.address_id, customerId],
        )
      : await q1<Record<string, unknown>>(
          'SELECT * FROM customer_addresses WHERE customer_id = $1 AND is_default LIMIT 1',
          [customerId],
        );

    if (!address) {
      throw new HttpError(
        400,
        'Add a delivery address before placing a delivery order.',
        'ADDRESS_REQUIRED',
      );
    }

    addressId = address.id as string;
    // Snapshot, not a foreign key alone: editing or deleting an address later
    // must not rewrite where a past order went.
    addressSnapshot = {
      recipient_name: address.recipient_name,
      phone: address.phone,
      address_line: address.address_line,
      state: address.state,
      district: address.district,
      village: address.village,
      postal_code: address.postal_code,
    };
  }

  // --- Group by seller -------------------------------------------------------
  const byFarmer = new Map<string, CartLine[]>();
  for (const line of lines) {
    const bucket = byFarmer.get(line.farmer_id) ?? [];
    bucket.push(line);
    byFarmer.set(line.farmer_id, bucket);
  }

  const createdOrders: Array<Record<string, unknown>> = [];
  // Running total across every order this checkout produced. A multi-farmer
  // cart splits into one order per farmer, and the customer must see the sum.
  let createdTotal = 0;

  for (const [farmerId, farmerLines] of byFarmer) {
    let itemsSubtotal = 0;
    let deliveryCharge = 0;

    for (const line of farmerLines) {
      const qty = Number(line.quantity);
      const unitPrice = effectiveUnitPrice(line);
      itemsSubtotal += qty * unitPrice;
      // Delivery is charged once per seller, using the highest charge among
      // their items, rather than per line.
      if (input.fulfilment_method === 'delivery') {
        deliveryCharge = Math.max(deliveryCharge, Number(line.delivery_charge));
      }
    }

    itemsSubtotal = round2(itemsSubtotal);
    deliveryCharge = round2(deliveryCharge);
    const totalAmount = round2(itemsSubtotal + deliveryCharge + PLATFORM_FEE);

    const orderRow = await q1<{ id: string; order_number: string }>(
      `INSERT INTO orders (
         order_number, customer_id, farmer_id,
         total_amount, items_subtotal, delivery_charge, platform_fee,
         fulfilment_method, delivery_address_snapshot, delivery_address_id,
         customer_note, idempotency_key
       ) VALUES (
         next_order_number(), $1, $2,
         $3, $4, $5, $6,
         $7::fulfilment_method, $8::jsonb, $9,
         $10, $11
       ) RETURNING id, order_number`,
      [
        customerId, farmerId,
        totalAmount, itemsSubtotal, deliveryCharge, PLATFORM_FEE,
        input.fulfilment_method,
        addressSnapshot ? JSON.stringify(addressSnapshot) : null,
        addressId,
        input.customer_note ?? null,
        input.idempotency_key ?? null,
      ],
    );
    if (!orderRow) throw new HttpError(500, 'The order could not be created.', 'ORDER_FAILED');

    for (const line of farmerLines) {
      const qty = Number(line.quantity);
      const unitPrice = effectiveUnitPrice(line);

      // Atomic reservation. The UPDATE ... WHERE stock_quantity >= qty inside
      // reserve_product_stock() is what prevents two concurrent checkouts from
      // overselling the last unit: the second one gets no row back and raises,
      // which rolls the whole transaction back.
      await q('SELECT reserve_product_stock($1, $2)', [line.product_id, qty]);

      await q(
        `INSERT INTO order_items (
           order_id, product_id, farmer_id, product_name_snapshot, unit_snapshot,
           quantity, unit_price_snapshot, subtotal
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          orderRow.id, line.product_id, farmerId,
          line.product_name,
          line.unit === 'other' ? (line.custom_unit ?? 'unit') : line.unit,
          qty, unitPrice, round2(qty * unitPrice),
        ],
      );
    }

    createdOrders.push({ id: orderRow.id, order_number: orderRow.order_number });
    createdTotal = round2(createdTotal + totalAmount);
  }

  // Clear the cart only after every order succeeded.
  await q('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE customer_id = $1)', [
    customerId,
  ]);

  // --- Notify ----------------------------------------------------------------
  for (const order of createdOrders) {
    const detail = await getOrderDetail(order.id as string);
    const farmerId = detail.farmer_id as string;
    const orderNumber = detail.order_number as string;
    const total = formatINR(Number(detail.total_amount));

    await notify(
      farmerId,
      'order',
      `New order ${orderNumber}`,
      `${total} • ${input.fulfilment_method === 'delivery' ? 'Delivery' : 'Pickup'}`,
      `/farmer/orders/${order.id}`,
      { orderId: order.id },
    );

    await audit({
      action: 'order.create',
      entityType: 'order',
      entityId: order.id as string,
      after: { order_number: orderNumber, total_amount: Number(detail.total_amount) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Email is best-effort; a delivery failure never fails the order.
    void sendNewOrderEmailToFarmer(
      await farmerEmail(farmerId),
      orderNumber,
      total,
    );
    void sendOrderPlacedEmail(
      await customerEmail(customerId),
      orderNumber,
      total,
      detail.farmer_name as string,
    );
  }

  return { orders: createdOrders, totalAmount: createdTotal };
}

/**
 * Load one order with its items.
 *
 * The `orders` policy restricts this to the two parties and admins, so a
 * request for somebody else's order returns 404 rather than leaking its
 * existence.
 */
export async function getOrderDetail(orderId: string): Promise<Record<string, unknown>> {
  const order = await q1<Record<string, unknown>>(
    `SELECT o.*,
            cu.full_name AS customer_name, cu.phone AS customer_phone,
            fu.full_name AS farmer_name, fu.phone AS farmer_phone,
            fp.farm_name, fp.state AS farmer_state, fp.district AS farmer_district,
            fp.village AS farmer_village, fp.offers_pickup
       FROM orders o
       JOIN profiles cu ON cu.id = o.customer_id
       JOIN profiles fu ON fu.id = o.farmer_id
       LEFT JOIN farmer_profiles fp ON fp.user_id = o.farmer_id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order) throw new HttpError(404, 'That order could not be found.', 'ORDER_NOT_FOUND');

  const items = await q(
    `SELECT oi.*,
            (SELECT pi.storage_path FROM product_images pi
              WHERE pi.product_id = oi.product_id AND pi.media_type = 'image'
              ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS product_image,
            p.status::text AS product_current_status
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at`,
    [orderId],
  );

  const payments = await q(
    `SELECT id, provider::text, amount, currency, status::text, method,
            failure_reason, refunded_amount, created_at, updated_at
       FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );

  const review = await q1(
    `SELECT id, product_rating, seller_rating, comment, photo_path, created_at
       FROM reviews WHERE order_id = $1 LIMIT 1`,
    [orderId],
  );

  return { ...order, items, payments, review };
}

/** Orders for a customer or a farmer, depending on which column is set. */
export async function listOrders(
  party: { customerId?: string; farmerId?: string },
  p: Pagination,
  options: { status?: string } = {},
): Promise<Page<Record<string, unknown>>> {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (party.customerId) {
    params.push(party.customerId);
    clauses.push(`o.customer_id = $${params.length}`);
  }
  if (party.farmerId) {
    params.push(party.farmerId);
    clauses.push(`o.farmer_id = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    clauses.push(`o.order_status = $${params.length}::order_status`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = await count(`SELECT count(*)::int AS n FROM orders o ${where}`, params);

  const limitIdx = params.push(p.pageSize);
  const offsetIdx = params.push(p.offset);

  const items = await q(
    `SELECT o.id, o.order_number, o.total_amount, o.items_subtotal, o.delivery_charge,
            o.order_status::text, o.payment_status::text, o.fulfilment_method::text,
            o.placed_at, o.delivered_at, o.cancelled_at, o.created_at, o.updated_at,
            cu.full_name AS customer_name,
            fu.full_name AS farmer_name,
            (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
            (SELECT oi.product_name_snapshot FROM order_items oi
              WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS first_item_name,
            (SELECT pi.storage_path FROM order_items oi
               JOIN product_images pi ON pi.product_id = oi.product_id AND pi.media_type = 'image'
              WHERE oi.order_id = o.id
              ORDER BY oi.created_at, pi.sort_order LIMIT 1) AS first_item_image
       FROM orders o
       JOIN profiles cu ON cu.id = o.customer_id
       JOIN profiles fu ON fu.id = o.farmer_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return toPage(items, total, p);
}

/**
 * Move an order to a new status.
 *
 * Which transitions a caller may trigger depends on which side of the order
 * they are on. The database trigger enforces the state machine itself; this
 * function enforces who may drive it, and returns a message that says why when
 * the answer is no.
 */
export async function updateOrderStatus(
  orderId: string,
  actor: { userId: string; role: 'farmer' | 'customer' | 'admin' },
  nextStatus: OrderStatus,
  options: { note?: string | null; reason?: string | null } = {},
  meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
): Promise<Record<string, unknown>> {
  const order = await q1<{
    id: string; order_number: string; customer_id: string; farmer_id: string;
    order_status: OrderStatus; payment_status: string; fulfilment_method: string;
    items_subtotal: number;
  }>(
    `SELECT id, order_number, customer_id, farmer_id, order_status::text AS order_status,
            payment_status::text AS payment_status, fulfilment_method::text AS fulfilment_method,
            items_subtotal
       FROM orders WHERE id = $1`,
    [orderId],
  );
  if (!order) throw new HttpError(404, 'That order could not be found.', 'ORDER_NOT_FOUND');

  const isFarmer = actor.userId === order.farmer_id;
  const isCustomer = actor.userId === order.customer_id;
  const isAdmin = actor.role === 'admin';

  if (!isFarmer && !isCustomer && !isAdmin) {
    throw new HttpError(403, 'You do not have access to this order.', 'NOT_PARTICIPANT');
  }

  assertTransitionAllowed(order, nextStatus, { isFarmer, isCustomer, isAdmin });

  const sets: string[] = ['order_status = $1::order_status'];
  const params: unknown[] = [nextStatus];

  if (nextStatus === 'cancelled') {
    params.push(options.reason ?? null, actor.userId);
    sets.push(`cancel_reason = $${params.length - 1}`, `cancelled_by = $${params.length}`);
  }
  if (options.note !== undefined) {
    params.push(options.note);
    const column = isFarmer ? 'farmer_note' : 'customer_note';
    sets.push(`${column} = $${params.length}`);
  }

  params.push(orderId);
  const updated = await q(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params,
  );
  if (updated.length === 0) {
    throw new HttpError(403, 'That order status change is not permitted.', 'TRANSITION_DENIED');
  }

  // Restore stock when an order is cancelled or refunded. Without this the
  // produce would be unsellable for good.
  if (nextStatus === 'cancelled' || nextStatus === 'refunded') {
    const items = await q<{ product_id: string | null; quantity: number }>(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [orderId],
    );
    for (const item of items) {
      if (item.product_id) {
        await q('SELECT release_product_stock($1, $2)', [item.product_id, item.quantity]);
      }
    }
  }

  // Keep the customer informed at each meaningful step.
  const customerFacing: OrderStatus[] = [
    'accepted', 'preparing', 'ready_for_pickup', 'shipped', 'delivered',
    'cancelled', 'refund_pending', 'refunded',
  ];
  if (customerFacing.includes(nextStatus)) {
    await notify(
      order.customer_id,
      'order',
      `Order ${order.order_number}: ${humanStatus(nextStatus)}`,
      statusExplanation(nextStatus, order.fulfilment_method as 'delivery' | 'pickup'),
      `/customer/orders/${orderId}`,
      { orderId, status: nextStatus },
    );
    void sendOrderStatusEmail(await customerEmail(order.customer_id), order.order_number, nextStatus);
  }

  await audit({
    action: 'order.status_change',
    entityType: 'order',
    entityId: orderId,
    before: { status: order.order_status },
    after: { status: nextStatus, note: options.note ?? null },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return getOrderDetail(orderId);
}

function assertTransitionAllowed(
  order: { order_status: OrderStatus; farmer_id: string; customer_id: string },
  next: OrderStatus,
  who: { isFarmer: boolean; isCustomer: boolean; isAdmin: boolean },
): void {
  const current = order.order_status;

  const farmerTransitions: Record<OrderStatus, OrderStatus[]> = {
    pending_confirmation: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready_for_pickup', 'shipped', 'cancelled'],
    ready_for_pickup: ['delivered'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
    refund_pending: ['refunded'],
    refunded: [],
  };

  // A customer may cancel only before the farmer has started work. Once it is
  // being prepared, cancelling is a refund conversation, not a button.
  const customerTransitions: Record<OrderStatus, OrderStatus[]> = {
    pending_confirmation: ['cancelled'],
    accepted: ['cancelled'],
    preparing: [],
    ready_for_pickup: [],
    shipped: ['refund_pending'],
    delivered: ['refund_pending'],
    cancelled: [],
    refund_pending: [],
    refunded: [],
  };

  const adminTransitions: OrderStatus[] = [
    'cancelled', 'refund_pending', 'refunded', 'delivered',
  ];

  if (who.isAdmin) {
    if (!adminTransitions.includes(next)) {
      throw new HttpError(
        403,
        'Administrators may only cancel, refund or resolve an order, not run its fulfilment.',
        'TRANSITION_DENIED',
      );
    }
    return;
  }

  const allowed = who.isFarmer ? farmerTransitions[current] : customerTransitions[current];
  if (!allowed.includes(next)) {
    throw new HttpError(
      409,
      `An order that is ${humanStatus(current)} cannot be moved to ${humanStatus(next)}.`,
      'ILLEGAL_ORDER_TRANSITION',
    );
  }
}

export function humanStatus(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    pending_confirmation: 'Pending confirmation',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready_for_pickup: 'Ready for pickup',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refund_pending: 'Refund pending',
    refunded: 'Refunded',
  };
  return labels[status];
}

function statusExplanation(status: OrderStatus, method: 'delivery' | 'pickup'): string {
  switch (status) {
    case 'accepted': return 'The farmer has accepted your order.';
    case 'preparing': return 'Your order is being packed.';
    case 'ready_for_pickup': return 'Your order is ready to collect from the farm.';
    case 'shipped': return 'Your order is on its way.';
    case 'delivered': return method === 'pickup'
      ? 'The order was collected. Thank you.'
      : 'Your order has been delivered.';
    case 'cancelled': return 'This order was cancelled.';
    case 'refund_pending': return 'A refund has been requested for this order.';
    case 'refunded': return 'This order has been refunded.';
    default: return '';
  }
}

async function farmerEmail(farmerId: string): Promise<string> {
  const row = await q1<{ email: string }>('SELECT email FROM profiles WHERE id = $1', [farmerId]);
  return row?.email ?? '';
}

async function customerEmail(customerId: string): Promise<string> {
  const row = await q1<{ email: string }>('SELECT email FROM profiles WHERE id = $1', [customerId]);
  return row?.email ?? '';
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function unitLabel(line: { unit: string; custom_unit: string | null }): string {
  return line.unit === 'other' ? (line.custom_unit ?? 'unit') : line.unit;
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Farmer dashboard counters, all read from the database. */
export async function farmerOrderStats(farmerId: string): Promise<Record<string, number>> {
  const row = await q1<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE order_status = 'pending_confirmation')::int AS pending_orders,
       count(*) FILTER (WHERE order_status IN ('accepted','preparing','ready_for_pickup','shipped'))::int AS active_orders,
       count(*) FILTER (WHERE order_status = 'delivered')::int AS completed_orders,
       count(*) FILTER (WHERE order_status = 'cancelled')::int AS cancelled_orders,
       coalesce(sum(total_amount) FILTER (WHERE order_status = 'delivered'), 0) AS total_sales,
       count(*)::int AS total_orders
     FROM orders WHERE farmer_id = $1`,
    [farmerId],
  );
  return row ?? {
    pending_orders: 0, active_orders: 0, completed_orders: 0,
    cancelled_orders: 0, total_sales: 0, total_orders: 0,
  };
}

export async function customerOrderStats(customerId: string): Promise<Record<string, number>> {
  const row = await q1<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE order_status = 'pending_confirmation')::int AS pending_orders,
       count(*) FILTER (WHERE order_status IN ('accepted','preparing','ready_for_pickup','shipped'))::int AS active_orders,
       count(*) FILTER (WHERE order_status = 'delivered')::int AS completed_orders,
       coalesce(sum(total_amount) FILTER (WHERE order_status = 'delivered'), 0) AS total_spent,
       count(*)::int AS total_orders
     FROM orders WHERE customer_id = $1`,
    [customerId],
  );
  return row ?? {
    pending_orders: 0, active_orders: 0, completed_orders: 0, total_spent: 0, total_orders: 0,
  };
}
