import { Router } from 'express';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../db/pool.js';
import * as advisor from '../services/advisor.js';
import { referenceDataStatus } from '../services/agronomy.js';
import { capabilities } from '../config.js';
import { advisorAskSchema, advisorSessionSchema } from './schemas.js';

export const advisorRouter = Router();

/**
 * The farmer advisor.
 *
 * Every route here is farmer-only. A customer has no farm to advise on, and an
 * administrator reading a farmer's private consultation is not something the
 * brief asks for — so the role check is `farmer` and nothing else. Support can
 * still reach the data through the audit log, which records that a question was
 * asked without storing the answer twice.
 */

/** Integration state, so the page can render an honest "not configured" notice. */
advisorRouter.get(
  '/status',
  requireSession,
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({
      configured: capabilities.advisor,
      model: capabilities.advisor ? undefined : null,
      weather_available: capabilities.weather,
      reference_data: await referenceDataStatus(),
      disclaimer: advisor.ADVISOR_DISCLAIMER,
    });
  }),
);

/** Sessions the caller has had, newest first. */
advisorRouter.get(
  '/sessions',
  requireSession,
  requireRole('farmer'),
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ sessions: await advisor.listSessions(req.session!.sub) });
  }),
);

advisorRouter.post(
  '/sessions',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(advisorSessionSchema),
  withDb(async (req, res) => {
    const created = await advisor.createSession(req.session!.sub, req.body as never, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json(created);
  }),
);

advisorRouter.get(
  '/sessions/:id',
  requireSession,
  requireRole('farmer'),
  generalLimiter,
  withDb(async (req, res) => {
    const session = await advisor.getSession(req.session!.sub, req.params.id!);
    if (!session) throw new HttpError(404, 'That conversation could not be found.', 'SESSION_NOT_FOUND');
    res.json({ session, messages: await advisor.listMessages(session.id) });
  }),
);

advisorRouter.patch(
  '/sessions/:id',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(advisorSessionSchema),
  withDb(async (req, res) => {
    res.json(await advisor.updateSession(req.session!.sub, req.params.id!, req.body as never));
  }),
);

advisorRouter.delete(
  '/sessions/:id',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  withDb(async (req, res) => {
    await advisor.deleteSession(req.session!.sub, req.params.id!);
    res.json({ message: 'Conversation deleted.' });
  }),
);

/**
 * Ask a question.
 *
 * Rate-limited more tightly than a read: each call reaches a paid provider.
 */
advisorRouter.post(
  '/sessions/:id/ask',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(advisorAskSchema),
  withDb(async (req, res) => {
    const { question } = req.body as { question: string };
    res.json(
      await advisor.ask(req.session!.sub, req.params.id!, question, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      }),
    );
  }),
);
