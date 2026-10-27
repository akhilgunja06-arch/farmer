import { Router } from 'express';
import { HttpError, currentClient } from '../db/pool.js';
import { requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimit.js';
import { paginate, q, q1 } from '../services/helpers.js';
import * as storage from '../services/storage.js';

export const filesRouter = Router();
export const notificationsRouter = Router();

/**
 * Serve a stored file.
 *
 * The access decision is made in the database, not here: the query asks whether
 * the caller may see a row that references this storage key, and the RLS
 * policies on products, quality reports, reviews and verification requests
 * answer it. A key belonging to somebody else's private document therefore
 * returns 404 even though the file exists on disk.
 *
 * Response headers are deliberately restrictive. Images are served inline so
 * product photos render; everything else is an attachment. A PDF is never
 * rendered inline from our own origin.
 */
filesRouter.get(
  '/:ownerId/:scope/:filename',
  generalLimiter,
  requireSession,
  withDb(async (req, res) => {
    const ownerId = req.params.ownerId!;
    const scope = req.params.scope!;
    const filename = req.params.filename!;

    const key = `${ownerId}/${scope}/${filename}`;
    // Rejects any key that escapes the storage root before we touch the disk.
    const absolute = storage.resolveStoragePath(key);

    const allowed = await canReadFile(key, ownerId, scope, req.session!.sub, req.session!.role);
    if (!allowed) {
      throw new HttpError(404, 'That file could not be found.', 'FILE_NOT_FOUND');
    }

    let file: { buffer: Buffer; byteSize: number };
    try {
      const { readFile } = await import('node:fs/promises');
      file = { buffer: await readFile(absolute), byteSize: 0 };
    } catch {
      throw new HttpError(404, 'That file could not be found.', 'FILE_NOT_FOUND');
    }

    const mime = storage.mimeForKey(key);
    const inline = storage.isInlineSafe(key);

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${sanitizeFilename(filename)}"`,
    );
    // No sniffing, and no scripts or plugins from a user-supplied file.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');

    res.send(file.buffer);
  }),
);

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Decide whether the caller may read a stored file.
 *
 * Each branch asks the database a question that the relevant RLS policy
 * answers. The `ownerId` directory is not itself the permission — it is only
 * where the bytes live — so knowing a path is not enough to read it.
 */
async function canReadFile(
  key: string,
  ownerId: string,
  scope: string,
  userId: string,
  role: string,
): Promise<boolean> {
  // An administrator reviewing a report or a verification request needs access.
  if (role === 'admin') return true;

  // Your own uploads: profile photos, verification documents, message images.
  if (ownerId === userId) return true;

  // Product media. The product_images RLS policy already limits a farmer to
  // their own rows and exposes the rest only for active public listings.
  const productImage = await q1<{ id: string }>(
    'SELECT id FROM product_images WHERE storage_path = $1',
    [key],
  );
  if (productImage) return true;

  // A verified quality report document on a listing the caller can see. The
  // policy on crop_quality_reports returns a row only when the report is
  // verified, or when the caller submitted it, or when they are an admin.
  const qualityDoc = await q1<{ id: string }>(
    'SELECT id FROM crop_quality_reports WHERE report_document = $1',
    [key],
  );
  if (qualityDoc) return true;

  // A review photo on a public listing.
  const reviewPhoto = await q1<{ id: string }>(
    `SELECT r.id FROM reviews r
      WHERE r.photo_path = $1
        AND r.is_hidden = false
        AND EXISTS (SELECT 1 FROM public_products p WHERE p.id = r.product_id)`,
    [key],
  );
  if (reviewPhoto) return true;

  // An avatar attached to a public profile.
  if (scope === 'avatars') {
    const publicProfile = await q1<{ id: string }>(
      `SELECT id FROM profiles WHERE profile_photo = $1 AND NOT is_suspended`,
      [key],
    );
    if (publicProfile) return true;
  }

  // A message attachment, readable only by the two participants. The messages
  // policy answers this: it returns the row only for a conversation the caller
  // is part of.
  if (scope.startsWith('messages')) {
    const attachment = await q1<{ id: string }>(
      'SELECT id FROM messages WHERE attachment_path = $1',
      [key],
    );
    if (attachment) return true;
  }

  return false;
}

/**
 * Notifications for the signed-in user.
 *
 * The notifications policy restricts both reads and writes to the caller's own
 * rows, so there is no way to list or clear somebody else's.
 */
notificationsRouter.use(requireSession);

notificationsRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = paginate(Number(query.page ?? 1), Number(query.page_size ?? 30));

    const params: unknown[] = [req.session!.sub];
    let where = 'WHERE n.user_id = $1';
    if (query.unread_only === 'true') {
      where += ' AND n.read_at IS NULL';
    }

    const total = await q1<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications n ${where}`,
      params,
    );

    const limitIdx = params.push(page.pageSize);
    const offsetIdx = params.push(page.offset);

    const items = await q(
      `SELECT n.id, n.kind::text, n.title, n.body, n.link, n.metadata,
              n.read_at, n.created_at
         FROM notifications n
         ${where}
        ORDER BY n.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    res.json({
      items,
      page: page.page,
      page_size: page.pageSize,
      total: total?.n ?? 0,
      total_pages: Math.max(1, Math.ceil((total?.n ?? 0) / page.pageSize)),
    });
  }),
);

notificationsRouter.get(
  '/unread-count',
  generalLimiter,
  withDb(async (req, res) => {
    const row = await q1<{ n: number }>(
      'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.session!.sub],
    );
    res.json({ count: row?.n ?? 0 });
  }),
);

notificationsRouter.post(
  '/:id/read',
  withDb(async (req, res) => {
    // Scoped to the caller. Marking somebody else's notification read is a
    // silent no-op rather than an error, so this cannot be used to probe ids.
    await q('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.session!.sub,
    ]);
    res.json({ message: 'Marked as read.' });
  }),
);

notificationsRouter.post(
  '/read-all',
  withDb(async (req, res) => {
    const updated = await q(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id',
      [req.session!.sub],
    );
    res.json({ marked: updated.length });
  }),
);

/** Lightweight counters for the header, fetched on navigation. */
export const countersRouter = Router();

countersRouter.use(requireSession);

countersRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const userId = req.session!.sub;
    const client = currentClient();

    const result = await client.query<{
      notifications: number;
      messages: number;
      cart_items: number;
      pending_orders: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM notifications
           WHERE user_id = $1 AND read_at IS NULL) AS notifications,
         (SELECT count(*)::int FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
           WHERE (c.customer_id = $1 OR c.farmer_id = $1)
             AND m.sender_id <> $1 AND m.read_at IS NULL) AS messages,
         (SELECT coalesce(count(*), 0)::int FROM cart_items ci
            JOIN carts c ON c.id = ci.cart_id
           WHERE c.customer_id = $1) AS cart_items,
         (SELECT count(*)::int FROM orders
           WHERE (customer_id = $1 OR farmer_id = $1)
             AND order_status = 'pending_confirmation') AS pending_orders`,
      [userId],
    );

    res.json(
      result.rows[0] ?? { notifications: 0, messages: 0, cart_items: 0, pending_orders: 0 },
    );
  }),
);
