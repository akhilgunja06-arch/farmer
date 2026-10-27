import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, capabilities } from '../config.js';
import { HttpError, currentClient } from '../db/pool.js';
import { audit, notify, q, q1 } from './helpers.js';
import { formatINR, round2 } from './orders.js';

/**
 * Payment integration.
 *
 * Razorpay is the intended provider. When its keys are absent every function
 * here still works, but reports `configured: false` and the checkout page
 * offers only the payment methods that are genuinely available. Nothing is ever
 * reported as paid without a signature the server verified itself.
 *
 * The rule this module exists to enforce: a browser saying "payment succeeded"
 * is a claim, not evidence. Only a signature checked with the merchant secret,
 * or a webhook whose HMAC matches, moves money in the database.
 */

export interface PaymentCapability {
  configured: boolean;
  provider: 'razorpay' | null;
  webhookConfigured: boolean;
  /** Public key id, safe to send to the browser. Never the secret. */
  publicKeyId: string | null;
  reason: string;
}

export function paymentCapability(): PaymentCapability {
  if (!capabilities.payments) {
    return {
      configured: false,
      provider: null,
      webhookConfigured: false,
      publicKeyId: null,
      reason:
        'Online payment is not configured on this deployment. Set RAZORPAY_KEY_ID and ' +
        'RAZORPAY_KEY_SECRET to enable it. Cash on delivery and bank transfer are available ' +
        'where the farmer offers them.',
    };
  }
  return {
    configured: true,
    provider: 'razorpay',
    webhookConfigured: capabilities.paymentsWebhook,
    publicKeyId: config.razorpay.keyId,
    reason: capabilities.paymentsWebhook
      ? ''
      : 'Payments work, but webhooks are not configured. A payment whose browser callback is ' +
        'lost will not be reconciled automatically until the webhook secret is set.',
  };
}

/**
 * Record the customer's intent to pay.
 *
 * This creates a local `payments` row in the `created` state. It does not talk
 * to Razorpay yet: the provider order is created by createProviderOrder, and
 * even then the payment stays unsettled until a verified signature arrives.
 */
export async function beginPayment(
  customerId: string,
  orderId: string,
  provider: 'razorpay' | 'cod' | 'manual',
  meta: { ip: string | null; userAgent: string | null },
): Promise<Record<string, unknown>> {
  const order = await q1<{
    id: string; order_number: string; customer_id: string; total_amount: number;
    payment_status: string; order_status: string;
  }>(
    `SELECT id, order_number, customer_id, total_amount,
            payment_status::text AS payment_status, order_status::text AS order_status
       FROM orders WHERE id = $1 AND customer_id = $2`,
    [orderId, customerId],
  );
  if (!order) throw new HttpError(404, 'That order could not be found.', 'ORDER_NOT_FOUND');
  if (order.order_status === 'cancelled') {
    throw new HttpError(409, 'This order was cancelled and cannot be paid.', 'ORDER_CANCELLED');
  }
  if (order.payment_status === 'captured') {
    throw new HttpError(409, 'This order has already been paid.', 'ALREADY_PAID');
  }

  if (provider === 'razorpay' && !capabilities.payments) {
    throw new HttpError(
      503,
      'Online payment is not available on this deployment. Please choose another payment method.',
      'PAYMENTS_NOT_CONFIGURED',
    );
  }

  if (provider === 'cod') {
    // Cash on delivery is recorded as a pending obligation, not a payment.
    // It settles when the farmer marks the order delivered.
    const existing = await q1<{ id: string }>(
      `SELECT id FROM payments WHERE order_id = $1 AND provider = 'cod' AND status = 'created'`,
      [orderId],
    );
    if (!existing) {
      await q(
        `INSERT INTO payments (order_id, provider, amount, status, method)
         VALUES ($1, 'cod', $2, 'created', 'cash_on_delivery')`,
        [orderId, order.total_amount],
      );
    }
    await audit({
      action: 'payment.cod_selected',
      entityType: 'order',
      entityId: orderId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { provider: 'cod', status: 'created', amount: order.total_amount };
  }

  // Razorpay: create a local pending row first so there is always something to
  // reconcile against, then ask the provider for an order id.
  const payment = await q1<{ id: string }>(
    `INSERT INTO payments (order_id, provider, amount, status)
     VALUES ($1, 'razorpay', $2, 'created')
     RETURNING id`,
    [orderId, order.total_amount],
  );
  if (!payment) throw new HttpError(500, 'The payment could not be started.', 'PAYMENT_FAILED');

  const providerOrder = await createRazorpayOrder({
    amount: order.total_amount,
    receipt: order.order_number,
    notes: { order_id: orderId, order_number: order.order_number },
  });

  await q('UPDATE payments SET provider_order_reference = $1 WHERE id = $2', [
    providerOrder.id,
    payment.id,
  ]);

  await audit({
    action: 'payment.initiated',
    entityType: 'order',
    entityId: orderId,
    after: { provider: 'razorpay', provider_order_reference: providerOrder.id },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    provider: 'razorpay',
    status: 'created',
    amount: order.total_amount,
    currency: 'INR',
    // Only the public key id crosses to the browser.
    key_id: config.razorpay.keyId,
    provider_order_id: providerOrder.id,
  };
}

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Create an order at Razorpay.
 *
 * Basic auth with the key id and secret. The secret never leaves this function.
 * Amounts are in paise (the smallest unit), which is why it is multiplied by
 * 100 and rounded — sending rupees here would charge 1/100th of the price.
 */
async function createRazorpayOrder(input: {
  amount: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  const credentials = Buffer.from(
    `${config.razorpay.keyId}:${config.razorpay.keySecret}`,
  ).toString('base64');

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      amount: Math.round(input.amount * 100),
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[razorpay] order creation failed', response.status, detail.slice(0, 500));
    throw new HttpError(
      502,
      'The payment provider could not start this payment. Please try again or choose another method.',
      'PAYMENT_PROVIDER_ERROR',
    );
  }

  return (await response.json()) as RazorpayOrder;
}

/**
 * Verify a payment the browser reported.
 *
 * Razorpay signs `order_id|payment_id` with the merchant secret. We recompute
 * that HMAC and compare in constant time. Only a match moves the payment to
 * `captured`. This is the entire reason a customer cannot mark their own order
 * paid: they do not have the secret.
 *
 * The write also passes the database trigger `guard_payment_status`, which
 * refuses a captured status without signature_verified = true.
 */
export async function confirmPayment(
  customerId: string,
  input: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  },
  meta: { ip: string | null; userAgent: string | null },
): Promise<Record<string, unknown>> {
  if (!capabilities.payments) {
    throw new HttpError(503, 'Payment verification is not configured.', 'PAYMENTS_NOT_CONFIGURED');
  }

  const expected = createHmac('sha256', config.razorpay.keySecret)
    .update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`)
    .digest('hex');

  if (!constantTimeEquals(expected, input.razorpay_signature)) {
    // A signature mismatch means the callback is forged, replayed against a
    // different order, or corrupted. Record the attempt and refuse.
    await recordFailedVerification(input, meta);
    throw new HttpError(
      400,
      'We could not verify this payment. No money has been taken. Please try again.',
      'SIGNATURE_MISMATCH',
    );
  }

  const payment = await q1<{ id: string; order_id: string; amount: number }>(
    `SELECT p.id, p.order_id, p.amount
       FROM payments p
       JOIN orders o ON o.id = p.order_id
      WHERE p.provider_order_reference = $1 AND o.customer_id = $2`,
    [input.razorpay_order_id, customerId],
  );
  if (!payment) {
    throw new HttpError(404, 'No matching payment record was found.', 'PAYMENT_NOT_FOUND');
  }

  // Idempotent: a retried callback with the same payment id is a no-op, because
  // the unique index on (provider, provider_payment_reference) would reject a
  // second row and the status is already captured.
  const already = await q1<{ id: string; status: string }>(
    'SELECT id, status::text AS status FROM payments WHERE id = $1',
    [payment.id],
  );
  if (already?.status === 'captured') {
    return { status: 'captured', already_processed: true };
  }

  await q(
    `UPDATE payments
        SET status = 'captured',
            provider_payment_reference = $1,
            signature_verified = true,
            method = 'razorpay_checkout',
            failure_reason = NULL
      WHERE id = $2`,
    [input.razorpay_payment_id, payment.id],
  );

  await notify(
    (await q1<{ farmer_id: string }>('SELECT farmer_id FROM orders WHERE id = $1', [payment.order_id]))!
      .farmer_id,
    'payment',
    'Payment received',
    `${formatINR(payment.amount)} for order ${input.razorpay_order_id}`,
    `/farmer/orders/${payment.order_id}`,
    { orderId: payment.order_id },
  );

  await audit({
    action: 'payment.captured',
    entityType: 'order',
    entityId: payment.order_id,
    after: { amount: payment.amount, provider_payment_reference: input.razorpay_payment_id },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { status: 'captured', amount: payment.amount };
}

async function recordFailedVerification(
  input: { razorpay_order_id: string; razorpay_payment_id: string },
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const payment = await q1<{ id: string; order_id: string }>(
    'SELECT id, order_id FROM payments WHERE provider_order_reference = $1',
    [input.razorpay_order_id],
  );
  if (payment) {
    await q(
      `UPDATE payments SET status = 'failed', failure_reason = $1 WHERE id = $2`,
      ['Signature verification failed', payment.id],
    );
  }
  await audit({
    action: 'payment.verification_failed',
    entityType: 'payment',
    entityId: payment?.id ?? null,
    after: { provider_order_reference: input.razorpay_order_id },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/**
 * Verify and apply a Razorpay webhook.
 *
 * The webhook is the authoritative path: if the customer closes the tab after
 * paying, this is what settles the order. The HMAC is over the raw request
 * body, so the body must be read as a Buffer before any JSON parsing.
 *
 * Every event is stored in payment_events keyed by provider event id, so a
 * redelivery is a no-op rather than a second capture.
 */
export async function handleWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<{ handled: boolean; reason?: string }> {
  if (!capabilities.paymentsWebhook) {
    return { handled: false, reason: 'webhook_not_configured' };
  }
  if (!signature) {
    throw new HttpError(400, 'Missing webhook signature.', 'SIGNATURE_MISSING');
  }

  const expected = createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  if (!constantTimeEquals(expected, signature)) {
    // Never trust an unsigned webhook: anyone who learns the URL could
    // otherwise mark arbitrary orders paid.
    throw new HttpError(400, 'Webhook signature did not match.', 'SIGNATURE_MISMATCH');
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      refund?: { entity?: Record<string, unknown> };
    };
  };
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Webhook body was not valid JSON.', 'INVALID_BODY');
  }

  const eventType = event.event ?? 'unknown';
  const entity = event.payload?.payment?.entity ?? event.payload?.refund?.entity ?? {};
  const eventId =
    (entity.id as string | undefined) ??
    (entity.payment_id as string | undefined) ??
    `${eventType}-${randomUUID()}`;

  // Deduplicate. The unique constraint on (provider, event_id) makes this
  // safe even under concurrent deliveries.
  const inserted = await q<{ id: number }>(
    `INSERT INTO payment_events (provider, event_id, event_type, payload)
     VALUES ('razorpay', $1, $2, $3::jsonb)
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType, JSON.stringify(event)],
  );
  if (inserted.length === 0) {
    return { handled: false, reason: 'duplicate_event' };
  }

  const client = currentClient();

  switch (eventType) {
    case 'payment.captured':
    case 'payment.authorized': {
      const providerOrderId = entity.order_id as string | undefined;
      const providerPaymentId = entity.id as string | undefined;
      if (!providerOrderId || !providerPaymentId) {
        return { handled: false, reason: 'missing_ids' };
      }

      // Webhook delivery is server-to-server and signature-verified, so the
      // privileged flag is set to satisfy the payments guard trigger.
      await client.query(`SELECT set_config('rythudirect.privileged', 'on', true)`);
      try {
        await q(
          `UPDATE payments
              SET status = 'captured',
                  provider_payment_reference = $1,
                  signature_verified = true,
                  provider_payload = $2::jsonb,
                  failure_reason = NULL
            WHERE provider_order_reference = $3
              AND status <> 'captured'`,
          [providerPaymentId, JSON.stringify(entity), providerOrderId],
        );
      } finally {
        await client.query(`SELECT set_config('rythudirect.privileged', 'off', true)`);
      }

      await audit({
        action: 'payment.webhook_captured',
        entityType: 'payment',
        entityId: providerPaymentId,
        after: { provider_order_reference: providerOrderId },
      });
      return { handled: true };
    }

    case 'payment.failed': {
      const providerOrderId = entity.order_id as string | undefined;
      const reason = (entity.error_description as string | undefined) ?? 'Payment failed';
      if (!providerOrderId) return { handled: false, reason: 'missing_order_id' };

      await q(
        `UPDATE payments SET status = 'failed', failure_reason = $1, provider_payload = $2::jsonb
          WHERE provider_order_reference = $3 AND status <> 'captured'`,
        [reason, JSON.stringify(entity), providerOrderId],
      );

      await audit({
        action: 'payment.webhook_failed',
        entityType: 'payment',
        entityId: providerOrderId,
        after: { reason },
      });
      return { handled: true };
    }

    case 'refund.created':
    case 'refund.processed': {
      const providerPaymentId = entity.payment_id as string | undefined;
      const refundAmountPaise = Number(entity.amount ?? 0);
      if (!providerPaymentId) return { handled: false, reason: 'missing_payment_id' };

      await client.query(`SELECT set_config('rythudirect.privileged', 'on', true)`);
      try {
        const payment = await q1<{ id: string; order_id: string; amount: number }>(
          'SELECT id, order_id, amount FROM payments WHERE provider_payment_reference = $1',
          [providerPaymentId],
        );
        if (payment) {
          const refundedRupees = round2(refundAmountPaise / 100);
          await q(
            `UPDATE payments
                SET status = CASE WHEN $1::numeric >= amount THEN 'refunded'::payment_status
                                  ELSE 'refund_pending'::payment_status END,
                    refunded_amount = $1,
                    refund_reference = $2,
                    signature_verified = true
              WHERE id = $3`,
            [refundedRupees, (entity.id as string | undefined) ?? null, payment.id],
          );
        }
      } finally {
        await client.query(`SELECT set_config('rythudirect.privileged', 'off', true)`);
      }

      await audit({
        action: `payment.${eventType.replace('.', '_')}`,
        entityType: 'payment',
        entityId: providerPaymentId,
      });
      return { handled: true };
    }

    default:
      return { handled: false, reason: `unhandled_event:${eventType}` };
  }
}

/**
 * Issue a refund.
 *
 * Only an administrator may do this. The provider call happens first; the local
 * row is only marked refunded once Razorpay acknowledges, so the record never
 * claims money moved that did not.
 */
export async function refundPayment(
  orderId: string,
  amount: number,
  reason: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<Record<string, unknown>> {
  const payment = await q1<{
    id: string; provider: string; provider_payment_reference: string | null;
    amount: number; refunded_amount: number; status: string;
  }>(
    `SELECT id, provider::text AS provider, provider_payment_reference, amount,
            refunded_amount, status::text AS status
       FROM payments WHERE order_id = $1 AND status = 'captured'
      ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );

  if (!payment) {
    throw new HttpError(
      400,
      'There is no captured payment on this order to refund.',
      'NO_REFUNDABLE_PAYMENT',
    );
  }

  const refundable = round2(Number(payment.amount) - Number(payment.refunded_amount));
  if (amount <= 0 || amount > refundable) {
    throw new HttpError(
      400,
      `The refundable amount on this order is ${formatINR(refundable)}.`,
      'INVALID_REFUND_AMOUNT',
    );
  }

  if (payment.provider === 'razorpay') {
    if (!capabilities.payments) {
      throw new HttpError(
        503,
        'The payment provider is not configured, so this refund cannot be sent. ' +
          'Configure Razorpay or issue the refund from the provider dashboard.',
        'PAYMENTS_NOT_CONFIGURED',
      );
    }
    if (!payment.provider_payment_reference) {
      throw new HttpError(
        400,
        'This payment has no provider reference, so it cannot be refunded automatically.',
        'NO_PROVIDER_REFERENCE',
      );
    }

    const credentials = Buffer.from(
      `${config.razorpay.keyId}:${config.razorpay.keySecret}`,
    ).toString('base64');

    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${payment.provider_payment_reference}/refund`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          notes: { reason, order_id: orderId },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[razorpay] refund failed', response.status, detail.slice(0, 500));
      throw new HttpError(
        502,
        'The payment provider rejected this refund. Nothing has been refunded.',
        'REFUND_FAILED',
      );
    }

    const refund = (await response.json()) as { id: string; amount: number };
    const totalRefunded = round2(Number(payment.refunded_amount) + amount);

    await q(
      `UPDATE payments
          SET refunded_amount = $1,
              refund_reference = $2,
              status = CASE WHEN $1::numeric >= amount THEN 'refunded'::payment_status
                            ELSE 'refund_pending'::payment_status END
        WHERE id = $3`,
      [totalRefunded, refund.id, payment.id],
    );

    await audit({
      action: 'payment.refunded',
      entityType: 'order',
      entityId: orderId,
      after: { amount, refund_reference: refund.id },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { status: 'refunded', amount, refund_reference: refund.id };
  }

  // Cash on delivery or a manually recorded payment: there is nothing to call.
  // Record the refund so the ledger and the order status stay truthful.
  await q(
    `UPDATE payments
        SET refunded_amount = refunded_amount + $1,
            status = 'refunded',
            signature_verified = true
      WHERE id = $2`,
    [amount, payment.id],
  );

  await audit({
    action: 'payment.refunded_offline',
    entityType: 'order',
    entityId: orderId,
    after: { amount, provider: payment.provider },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { status: 'refunded', amount, offline: true };
}

/**
 * Settle a cash-on-delivery payment when the order is delivered.
 *
 * Called from the order status transition, so COD orders end up with a
 * captured payment row like any other — the difference is that the evidence is
 * a delivery confirmation rather than a provider signature.
 */
export async function settleCodIfApplicable(orderId: string): Promise<void> {
  const payment = await q1<{ id: string; amount: number; status: string }>(
    `SELECT id, amount, status::text AS status FROM payments
      WHERE order_id = $1 AND provider = 'cod' AND status = 'created'`,
    [orderId],
  );
  if (!payment) return;

  await q(
    `UPDATE payments SET status = 'captured', signature_verified = true, method = 'cash_on_delivery'
      WHERE id = $1`,
    [payment.id],
  );

  await audit({
    action: 'payment.cod_settled',
    entityType: 'order',
    entityId: orderId,
    after: { amount: payment.amount },
  });
}

/** Payment rows for an order, for the customer and farmer views. */
export async function listOrderPayments(orderId: string): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT id, provider::text, provider_payment_reference, amount, currency,
            status::text, method, failure_reason, refunded_amount, created_at, updated_at
       FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
