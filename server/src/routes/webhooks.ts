import { Router, type Request, type Response } from 'express';
import { HttpError } from '../db/pool.js';
import { capabilities } from '../config.js';
import { withDb } from '../middleware/auth.js';
import * as payments from '../services/payments.js';

export const webhookRouter = Router();

/**
 * Payment provider webhooks.
 *
 * This router is mounted before express.json() in index.ts, so `req.body` here
 * is the raw Buffer. That matters: Razorpay signs the exact bytes it sent, and
 * re-serialising parsed JSON would produce a different string and fail
 * verification for legitimate events.
 *
 * The raw body is captured explicitly so this works whether or not any earlier
 * middleware has touched the stream.
 */
webhookRouter.use(
  (req: Request & { rawBody?: Buffer }, _res: Response, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
      next();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', next);
  },
);

webhookRouter.post(
  '/razorpay',
  withDb(async (req: Request & { rawBody?: Buffer }, res: Response) => {
    if (!capabilities.paymentsWebhook) {
      // Answer 503 rather than 200: the provider should retry once an operator
      // has configured the secret, instead of the event being dropped.
      res.status(503).json({
        error: {
          message: 'Webhooks are not configured on this deployment.',
          code: 'WEBHOOK_NOT_CONFIGURED',
        },
      });
      return;
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new HttpError(400, 'The webhook body was empty.', 'EMPTY_BODY');
    }

    const signature = req.get('x-razorpay-signature');
    const result = await payments.handleWebhook(raw, signature);

    // Always 200 for an accepted or duplicate event, so the provider stops
    // retrying. A verification failure throws and becomes a 4xx, which is the
    // correct signal that this delivery should not be trusted.
    res.json({ received: true, ...result });
  }),
);
