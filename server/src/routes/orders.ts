import { Router } from 'express';
import { HttpError } from '../db/pool.js';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { paginate, q, q1 } from '../services/helpers.js';
import * as orders from '../services/orders.js';
import * as payments from '../services/payments.js';
import {
  checkoutSchema,
  orderStatusSchema,
  paymentConfirmSchema,
  paymentInitiateSchema,
  refundSchema,
} from './schemas.js';

export const ordersRouter = Router();

ordersRouter.use(requireSession);

/**
 * Place an order from the cart.
 *
 * Customers only. A farmer account has no cart, and the cart RLS policies
 * would return nothing to one anyway.
 */
ordersRouter.post(
  '/checkout',
  requireRole('customer'),
  writeLimiter,
  validateBody(checkoutSchema),
  withDb(async (req, res) => {
    const result = await orders.checkout(req.session!.sub, req.body, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({
      orders: result.orders,
      total_amount: result.totalAmount,
      message:
        result.orders.length > 1
          ? `Your order was split into ${result.orders.length} orders, one per farmer.`
          : 'Your order has been placed.',
    });
  }),
);

/**
 * The caller's orders.
 *
 * The same route serves both sides: a customer sees the orders they placed, a
 * farmer sees the orders placed with them. Which column is filtered is decided
 * from the session role, never from a query parameter.
 */
ordersRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const p = paginate(Number(query.page ?? 1), Number(query.page_size ?? 20));

    const party =
      req.session!.role === 'farmer'
        ? { farmerId: req.session!.sub }
        : { customerId: req.session!.sub };

    const page = await orders.listOrders(party, p, { status: query.status });
    res.json(page);
  }),
);

ordersRouter.get(
  '/stats',
  generalLimiter,
  withDb(async (req, res) => {
    const stats =
      req.session!.role === 'farmer'
        ? await orders.farmerOrderStats(req.session!.sub)
        : await orders.customerOrderStats(req.session!.sub);
    res.json({ stats });
  }),
);

/**
 * One order.
 *
 * getOrderDetail reads through the orders RLS policy, so an order belonging to
 * somebody else returns 404 rather than revealing that it exists.
 */
ordersRouter.get(
  '/:id',
  generalLimiter,
  withDb(async (req, res) => {
    const detail = await orders.getOrderDetail(req.params.id!);
    res.json({ order: detail });
  }),
);

/**
 * Change an order's status.
 *
 * The state machine and who may drive each transition are enforced in
 * updateOrderStatus; the database trigger enforces the machine again. A farmer
 * cannot mark a customer's order delivered, and a customer cannot accept their
 * own order.
 */
ordersRouter.put(
  '/:id/status',
  writeLimiter,
  validateBody(orderStatusSchema),
  withDb(async (req, res) => {
    const body = req.body as { status: never; note?: string | null; reason?: string | null };

    const detail = await orders.updateOrderStatus(
      req.params.id!,
      { userId: req.session!.sub, role: req.session!.role },
      body.status,
      { note: body.note ?? null, reason: body.reason ?? null },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );

    // A cash-on-delivery obligation settles when the order is delivered, so the
    // payment ledger ends up consistent without a provider callback.
    if (body.status === 'delivered') {
      await payments.settleCodIfApplicable(req.params.id!);
    }

    res.json({ order: detail, message: `Order marked ${orders.humanStatus(body.status)}.` });
  }),
);

ordersRouter.get(
  '/:id/payments',
  generalLimiter,
  withDb(async (req, res) => {
    // Confirm the caller may see this order before exposing its payments.
    await orders.getOrderDetail(req.params.id!);
    res.json({ payments: await payments.listOrderPayments(req.params.id!) });
  }),
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const paymentsRouter = Router();

paymentsRouter.use(requireSession);

/** What this deployment can actually accept. Drives the checkout UI. */
paymentsRouter.get(
  '/capability',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json(payments.paymentCapability());
  }),
);

paymentsRouter.post(
  '/initiate',
  requireRole('customer'),
  writeLimiter,
  validateBody(paymentInitiateSchema),
  withDb(async (req, res) => {
    const { order_id, provider } = req.body as { order_id: string; provider: 'razorpay' | 'cod' };
    const result = await payments.beginPayment(
      req.session!.sub,
      order_id,
      provider,
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
    res.status(201).json(result);
  }),
);

/**
 * Confirm a Razorpay payment.
 *
 * The client sends the three values Razorpay's checkout handed it. The server
 * recomputes the HMAC with the merchant secret and only then marks the payment
 * captured. A fabricated callback fails here, which is the point.
 */
paymentsRouter.post(
  '/confirm',
  requireRole('customer'),
  writeLimiter,
  validateBody(paymentConfirmSchema),
  withDb(async (req, res) => {
    const result = await payments.confirmPayment(req.session!.sub, req.body as never, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json(result);
  }),
);

/** Refund a captured payment. Administrator only. */
paymentsRouter.post(
  '/refund',
  requireRole('admin'),
  writeLimiter,
  validateBody(refundSchema),
  withDb(async (req, res) => {
    const body = req.body as { order_id: string; amount: number; reason: string };
    const result = await payments.refundPayment(body.order_id, body.amount, body.reason, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json(result);
  }),
);
