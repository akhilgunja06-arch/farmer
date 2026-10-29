import { Router } from 'express';
import { requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { paginate } from '../services/helpers.js';
import * as messages from '../services/messages.js';
import { blockSchema, conversationSchema, messageSchema } from './schemas.js';

export const messagesRouter = Router();

messagesRouter.use(requireSession);

/**
 * Every handler here relies on the conversations and messages RLS policies for
 * access control. A user who is not a participant gets a 404 from the same code
 * path as a thread that does not exist, so the API cannot be used to probe for
 * conversations.
 */

messagesRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await messages.listConversations(
      req.session!.sub,
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
    );
    res.json(page);
  }),
);

messagesRouter.get(
  '/unread-count',
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ count: await messages.unreadMessageCount(req.session!.sub) });
  }),
);

/** Open (or reuse) a thread, optionally sending a first message. */
messagesRouter.post(
  '/',
  writeLimiter,
  validateBody(conversationSchema),
  withDb(async (req, res) => {
    const body = req.body as {
      other_user_id: string; product_id?: string | null;
      subject?: string | null; message?: string;
    };
    const conversation = await messages.openConversation(
      { userId: req.session!.sub, role: req.session!.role },
      {
        otherUserId: body.other_user_id,
        productId: body.product_id ?? null,
        subject: body.subject ?? null,
        ...(body.message ? { message: body.message } : {}),
      },
    );
    res.status(201).json({ conversation });
  }),
);

messagesRouter.get(
  '/:id',
  generalLimiter,
  withDb(async (req, res) => {
    const thread = await messages.getConversation(req.params.id!, req.session!.sub);
    // `messages` is a sibling of `conversation`, not a property of it, so the
    // client can read the thread and its rows independently.
    const { messages: rows, ...conversation } = thread as {
      messages: unknown[];
    } & Record<string, unknown>;
    res.json({ conversation, messages: rows });
  }),
);

messagesRouter.post(
  '/:id/messages',
  writeLimiter,
  validateBody(messageSchema),
  withDb(async (req, res) => {
    const body = req.body as { body: string; attachment_path?: string | null };
    const message = await messages.sendMessage(
      req.params.id!,
      req.session!.sub,
      body.body,
      body.attachment_path ?? null,
    );
    res.status(201).json({ message });
  }),
);

messagesRouter.post(
  '/:id/read',
  writeLimiter,
  withDb(async (req, res) => {
    const result = await messages.markConversationRead(req.params.id!, req.session!.sub);
    res.json(result);
  }),
);

messagesRouter.post(
  '/:id/block',
  writeLimiter,
  validateBody(blockSchema),
  withDb(async (req, res) => {
    await messages.blockCounterpart(
      req.params.id!,
      req.session!.sub,
      (req.body as { reason?: string | null }).reason ?? null,
    );
    res.json({ message: 'This person can no longer send you messages.' });
  }),
);

messagesRouter.delete(
  '/:id/block',
  writeLimiter,
  withDb(async (req, res) => {
    await messages.unblockCounterpart(req.params.id!, req.session!.sub);
    res.json({ message: 'You can receive messages from this person again.' });
  }),
);
