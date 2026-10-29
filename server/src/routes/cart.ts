import { Router } from 'express';
import { HttpError } from '../db/pool.js';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { q, q1 } from '../services/helpers.js';
import * as cart from '../services/cart.js';
import { addressSchema, cartAddSchema, cartUpdateSchema } from './schemas.js';

export const cartRouter = Router();

// Everything under the cart requires a signed-in customer. The RLS policies on
// carts and cart_items enforce the same thing at the database level, so a
// missing middleware would not expose another customer's cart.
cartRouter.use(requireSession, requireRole('customer'));

cartRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ cart: await cart.getCart(req.session!.sub) });
  }),
);

cartRouter.get(
  '/count',
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ count: await cart.cartItemCount(req.session!.sub) });
  }),
);

cartRouter.post(
  '/items',
  writeLimiter,
  validateBody(cartAddSchema),
  withDb(async (req, res) => {
    const { product_id, quantity } = req.body as { product_id: string; quantity: number };
    const updated = await cart.addToCart(req.session!.sub, product_id, quantity);
    res.status(201).json({ cart: updated, message: 'Added to your cart.' });
  }),
);

cartRouter.patch(
  '/items/:itemId',
  writeLimiter,
  validateBody(cartUpdateSchema),
  withDb(async (req, res) => {
    const { quantity } = req.body as { quantity: number };
    const updated = await cart.updateCartItem(req.session!.sub, req.params.itemId!, quantity);
    res.json({ cart: updated });
  }),
);

cartRouter.delete(
  '/items/:itemId',
  writeLimiter,
  withDb(async (req, res) => {
    const updated = await cart.removeCartItem(req.session!.sub, req.params.itemId!);
    res.json({ cart: updated, message: 'Item removed.' });
  }),
);

cartRouter.delete(
  '/',
  writeLimiter,
  withDb(async (req, res) => {
    const updated = await cart.clearCart(req.session!.sub);
    res.json({ cart: updated, message: 'Cart emptied.' });
  }),
);

// ---------------------------------------------------------------------------
// Saved products ("wishlist")
// ---------------------------------------------------------------------------

export const savedRouter = Router();

savedRouter.use(requireSession, requireRole('customer'));

savedRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const items = await q(
      // saved_products is keyed by (customer_id, product_id) with no surrogate
      // id of its own, so the product id doubles as the saved-row identity.
      `SELECT sp.product_id AS saved_id, sp.created_at AS saved_at,
              p.id, p.name, p.variety, p.price, p.unit::text, p.stock_quantity,
              p.state, p.district, p.grade::text, p.status::text, p.rating_avg,
              pr.full_name AS farmer_name,
              (SELECT pi.storage_path FROM product_images pi
                WHERE pi.product_id = p.id AND pi.media_type = 'image'
                ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS primary_image
         FROM saved_products sp
         JOIN products p ON p.id = sp.product_id
         JOIN public_profiles pr ON pr.id = p.farmer_id
        WHERE sp.customer_id = $1
        ORDER BY sp.created_at DESC`,
      [req.session!.sub],
    );
    res.json({ items });
  }),
);

savedRouter.post(
  '/:productId',
  writeLimiter,
  withDb(async (req, res) => {
    const product = await q1<{ id: string }>('SELECT id FROM products WHERE id = $1', [
      req.params.productId,
    ]);
    if (!product) throw new HttpError(404, 'That product could not be found.', 'PRODUCT_NOT_FOUND');

    await q(
      `INSERT INTO saved_products (customer_id, product_id) VALUES ($1, $2)
       ON CONFLICT (customer_id, product_id) DO NOTHING`,
      [req.session!.sub, req.params.productId],
    );
    res.status(201).json({ message: 'Saved to your list.' });
  }),
);

savedRouter.delete(
  '/:productId',
  writeLimiter,
  withDb(async (req, res) => {
    await q('DELETE FROM saved_products WHERE customer_id = $1 AND product_id = $2', [
      req.session!.sub,
      req.params.productId,
    ]);
    res.json({ message: 'Removed from your list.' });
  }),
);

// ---------------------------------------------------------------------------
// Delivery addresses
// ---------------------------------------------------------------------------

export const addressesRouter = Router();

addressesRouter.use(requireSession, requireRole('customer'));

addressesRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const addresses = await q(
      `SELECT id, label, recipient_name, phone, address_line, state, district,
              village, postal_code, latitude, longitude, is_default, created_at
         FROM customer_addresses
        WHERE customer_id = $1
        ORDER BY is_default DESC, created_at DESC`,
      [req.session!.sub],
    );
    res.json({ addresses });
  }),
);

addressesRouter.post(
  '/',
  writeLimiter,
  validateBody(addressSchema),
  withDb(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    // Only one default address at a time. The partial unique index in the
    // schema is the real guarantee; this keeps the error friendly.
    if (body.is_default) {
      await q('UPDATE customer_addresses SET is_default = false WHERE customer_id = $1', [
        req.session!.sub,
      ]);
    }

    const created = await q1<{ id: string }>(
      `INSERT INTO customer_addresses
         (customer_id, label, recipient_name, phone, address_line, state, district,
          village, postal_code, latitude, longitude, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        req.session!.sub,
        (body.label as string) ?? null,
        body.recipient_name,
        body.phone,
        body.address_line,
        body.state,
        body.district,
        (body.village as string) ?? null,
        (body.postal_code as string) || null,
        (body.latitude as number) ?? null,
        (body.longitude as number) ?? null,
        Boolean(body.is_default),
      ],
    );

    res.status(201).json({ id: created?.id, message: 'Address saved.' });
  }),
);

addressesRouter.patch(
  '/:id',
  writeLimiter,
  validateBody(addressSchema.partial()),
  withDb(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const existing = await q1<{ id: string }>(
      'SELECT id FROM customer_addresses WHERE id = $1 AND customer_id = $2',
      [req.params.id, req.session!.sub],
    );
    if (!existing) throw new HttpError(404, 'That address could not be found.', 'ADDRESS_NOT_FOUND');

    if (body.is_default) {
      await q('UPDATE customer_addresses SET is_default = false WHERE customer_id = $1', [
        req.session!.sub,
      ]);
    }

    const columns = [
      'label', 'recipient_name', 'phone', 'address_line', 'state', 'district',
      'village', 'postal_code', 'latitude', 'longitude', 'is_default',
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const column of columns) {
      if (column in body) {
        params.push(body[column]);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update.', 'NOTHING_TO_UPDATE');

    params.push(req.params.id, req.session!.sub);
    await q(
      `UPDATE customer_addresses SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND customer_id = $${params.length}`,
      params,
    );

    res.json({ message: 'Address updated.' });
  }),
);

addressesRouter.delete(
  '/:id',
  writeLimiter,
  withDb(async (req, res) => {
    // An address used by a live order is snapshotted onto the order, so
    // deleting it does not damage history. The guard is about not leaving a
    // customer with zero addresses while they have orders in flight.
    const removed = await q(
      'DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2 RETURNING id',
      [req.params.id, req.session!.sub],
    );
    if (removed.length === 0) {
      throw new HttpError(404, 'That address could not be found.', 'ADDRESS_NOT_FOUND');
    }
    res.json({ message: 'Address deleted.' });
  }),
);

addressesRouter.post(
  '/:id/default',
  writeLimiter,
  withDb(async (req, res) => {
    const existing = await q1<{ id: string }>(
      'SELECT id FROM customer_addresses WHERE id = $1 AND customer_id = $2',
      [req.params.id, req.session!.sub],
    );
    if (!existing) throw new HttpError(404, 'That address could not be found.', 'ADDRESS_NOT_FOUND');

    await q('UPDATE customer_addresses SET is_default = false WHERE customer_id = $1', [
      req.session!.sub,
    ]);
    await q('UPDATE customer_addresses SET is_default = true WHERE id = $1', [req.params.id]);

    res.json({ message: 'Default address updated.' });
  }),
);
