import { Router } from 'express';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import * as market from '../services/market.js';
import { marketObservationSchema } from './schemas.js';

export const marketRouter = Router();

/**
 * Market insights.
 *
 * Read endpoints are public: a farmer comparing their price should not have to
 * sign in. Every response states where the numbers came from and how old they
 * are, and the marketplace figures are labelled as farmer-listed prices rather
 * than market prices.
 */

marketRouter.get(
  '/compare',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    if (!query.commodity || !query.state) {
      res.status(400).json({
        error: {
          message: 'Provide a commodity and a state to compare prices.',
          code: 'MISSING_FIELDS',
        },
      });
      return;
    }

    res.json(
      await market.comparePrices({
        commodity: query.commodity,
        state: query.state,
        district: query.district ?? null,
        unit: query.unit,
      }),
    );
  }),
);

marketRouter.get(
  '/history',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    if (!query.commodity || !query.state) {
      res.status(400).json({
        error: {
          message: 'Provide a commodity and a state to see price history.',
          code: 'MISSING_FIELDS',
        },
      });
      return;
    }

    res.json({
      history: await market.priceHistory({
        commodity: query.commodity,
        state: query.state,
        district: query.district ?? null,
        months: query.months ? Number(query.months) : 6,
      }),
    });
  }),
);

marketRouter.get(
  '/commodities',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({ commodities: await market.listObservedCommodities() });
  }),
);

/** Record an official or manual observation. Administrator only. */
marketRouter.post(
  '/observations',
  requireSession,
  requireRole('admin'),
  writeLimiter,
  validateBody(marketObservationSchema),
  withDb(async (req, res) => {
    const created = await market.recordObservation(req.session!.sub, req.body as never, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ id: created.id, message: 'Observation recorded.' });
  }),
);

/**
 * Integration status, for the administrator dashboard.
 *
 * Reports which external services are configured, so "not configured" is
 * visible rather than something an operator has to discover by clicking.
 */
marketRouter.get(
  '/integration-status',
  requireSession,
  requireRole('admin'),
  generalLimiter,
  withDb(async (_req, res) => {
    res.json(await market.integrationStatus());
  }),
);
