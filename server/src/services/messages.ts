import { HttpError } from '../db/pool.js';
import { audit, notify, q, q1, type Page, toPage, type Pagination } from './helpers.js';

/**
 * Conversations and messages.
 *
 * Access is enforced by the RLS policies on `conversations` and `messages`:
 * only the two participants (and an administrator acting on a report) can read
 * a thread. Every query here is written on the assumption that the policy is
 * the real gate, so a bug in this file cannot widen access.
 */

/**
 * The fields the client renders for a conversation, from the caller's point of
 * view.
 *
 * A thread is symmetric in the database but not on screen: each participant
 * sees the *other* person as the counterpart. The CASE expressions pick the
 * far side of the conversation, and the block flags are read from the side that
 * matters to the caller — whether the counterpart has blocked them (which stops
 * sending) and whether they themselves have blocked the counterpart.
 *
 * `$1` is always the caller's user id.
 */
const CONVERSATION_PROJECTION = `
  c.id, c.subject, c.product_id, c.created_at, c.updated_at,
  CASE WHEN c.customer_id = $1 THEN c.farmer_id ELSE c.customer_id END AS other_user_id,
  CASE WHEN c.customer_id = $1 THEN fu.full_name ELSE cu.full_name END AS other_user_name,
  CASE WHEN c.customer_id = $1 THEN fu.profile_photo ELSE cu.profile_photo END AS other_user_photo,
  CASE WHEN c.customer_id = $1 THEN c.farmer_blocked ELSE c.customer_blocked END AS is_blocked,
  CASE WHEN c.customer_id = $1 THEN c.customer_blocked ELSE c.farmer_blocked END AS blocked_by_me,
  p.name AS product_name,
  (SELECT m.body FROM messages m
    WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
  (SELECT m.created_at FROM messages m
    WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
  (SELECT count(*)::int FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_id <> $1
      AND m.read_at IS NULL) AS unread_count`;

const CONVERSATION_JOINS = `
  FROM conversations c
  JOIN profiles cu ON cu.id = c.customer_id
  JOIN profiles fu ON fu.id = c.farmer_id
  LEFT JOIN products p ON p.id = c.product_id`;

/** Find or open the thread between a customer and a farmer, optionally about a product. */
export async function openConversation(
  actor: { userId: string; role: 'farmer' | 'customer' | 'admin' },
  input: { otherUserId: string; productId?: string | null; subject?: string | null; message?: string },
): Promise<Record<string, unknown>> {
  if (input.otherUserId === actor.userId) {
    throw new HttpError(400, 'You cannot start a conversation with yourself.', 'SELF_CONVERSATION');
  }

  const other = await q1<{ id: string; role: string; is_suspended: boolean; full_name: string }>(
    'SELECT id, role::text AS role, is_suspended, full_name FROM profiles WHERE id = $1',
    [input.otherUserId],
  );
  if (!other || other.is_suspended) {
    throw new HttpError(404, 'That person could not be found.', 'USER_NOT_FOUND');
  }

  // A thread is always customer <-> farmer. Work out which side the caller is
  // on rather than trusting a role passed from the client.
  let customerId: string;
  let farmerId: string;

  if (actor.role === 'customer' && other.role === 'farmer') {
    customerId = actor.userId;
    farmerId = other.id;
  } else if (actor.role === 'farmer' && other.role === 'customer') {
    customerId = other.id;
    farmerId = actor.userId;
  } else {
    throw new HttpError(
      400,
      'Conversations are between a customer and a farmer.',
      'INVALID_PARTICIPANTS',
    );
  }

  // If the caller has been blocked by the other party, refuse rather than
  // silently delivering into the void.
  const blocked = await q1<{ blocker_id: string }>(
    'SELECT blocker_id FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [input.otherUserId, actor.userId],
  );
  if (blocked) {
    throw new HttpError(
      403,
      'You cannot send a message to this person.',
      'BLOCKED_BY_RECIPIENT',
    );
  }

  // The unique index on (customer, farmer, product) makes this idempotent, so
  // two taps on "Contact farmer" open one thread, not two.
  const conversation = await q1<{ id: string }>(
    `INSERT INTO conversations (customer_id, farmer_id, product_id, subject)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (customer_id, farmer_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [customerId, farmerId, input.productId ?? null, input.subject ?? null],
  );
  if (!conversation) {
    throw new HttpError(500, 'The conversation could not be opened.', 'CONVERSATION_FAILED');
  }

  if (input.message) {
    await sendMessage(conversation.id, actor.userId, input.message);
  }

  return getConversation(conversation.id, actor.userId);
}

export async function listConversations(
  userId: string,
  p: Pagination,
): Promise<Page<Record<string, unknown>>> {
  const total = await q1<{ n: number }>(
    `SELECT count(*)::int AS n FROM conversations
      WHERE customer_id = $1 OR farmer_id = $1`,
    [userId],
  );

  const items = await q(
    `SELECT ${CONVERSATION_PROJECTION}
       ${CONVERSATION_JOINS}
      WHERE c.customer_id = $1 OR c.farmer_id = $1
      ORDER BY c.updated_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, p.pageSize, p.offset],
  );

  return toPage(items, total?.n ?? 0, p);
}

export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const conversation = await q1<Record<string, unknown>>(
    `SELECT ${CONVERSATION_PROJECTION}
       ${CONVERSATION_JOINS}
      WHERE c.id = $2`,
    [userId, conversationId],
  );
  if (!conversation) {
    // The RLS policy already hid it if the caller is not a participant, so this
    // 404 is also what a stranger receives.
    throw new HttpError(404, 'That conversation could not be found.', 'CONVERSATION_NOT_FOUND');
  }

  const messages = await q(
    `SELECT id, conversation_id, sender_id, body, attachment_path, is_system,
            read_at, created_at,
            (sender_id = $2) AS is_mine
       FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT 500`,
    [conversationId, userId],
  );

  // The send path checks blocks through `user_blocks`, which RLS keeps private
  // to the blocker, so it cannot read that table directly. `is_blocked` here
  // means "the counterpart has blocked me" and `blocked_by_me` means "I have
  // blocked them" — the send handler refuses in the first case.
  return { ...conversation, messages };
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
  attachmentPath?: string | null,
): Promise<Record<string, unknown>> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new HttpError(400, 'Enter a message before sending.', 'EMPTY_MESSAGE');
  }
  if (trimmed.length > 4000) {
    throw new HttpError(400, 'That message is too long.', 'MESSAGE_TOO_LONG');
  }

  // Read the thread first so we know the counterpart and can honour a block.
  // The block flags live on `conversations` and are readable by both
  // participants, unlike `user_blocks` which RLS keeps private to the blocker.
  const conversation = await q1<{ customer_id: string; farmer_id: string; is_blocked: boolean }>(
    `SELECT customer_id, farmer_id,
            CASE WHEN customer_id = $2 THEN farmer_blocked ELSE customer_blocked END AS is_blocked
       FROM conversations
      WHERE id = $1`,
    [conversationId, senderId],
  );
  if (!conversation) {
    throw new HttpError(404, 'That conversation could not be found.', 'CONVERSATION_NOT_FOUND');
  }

  const recipientId =
    conversation.customer_id === senderId ? conversation.farmer_id : conversation.customer_id;

  if (conversation.is_blocked) {
    throw new HttpError(403, 'This person has stopped accepting messages.', 'USER_BLOCKED');
  }

  const sender = await q1<{ full_name: string }>(
    'SELECT full_name FROM profiles WHERE id = $1',
    [senderId],
  );

  const message = await q1<Record<string, unknown>>(
    `INSERT INTO messages (conversation_id, sender_id, body, attachment_path)
     VALUES ($1, $2, $3, $4)
     RETURNING id, conversation_id, sender_id, body, attachment_path, read_at, created_at`,
    [conversationId, senderId, trimmed, attachmentPath ?? null],
  );

  await notify(
    recipientId,
    'message',
    `New message from ${sender?.full_name ?? 'a user'}`,
    trimmed.slice(0, 140),
    conversation.customer_id === recipientId
      ? `/customer/messages/${conversationId}`
      : `/farmer/messages/${conversationId}`,
    { conversationId },
  );

  return message ?? {};
}

/**
 * Mark the other party's messages as read.
 *
 * Only messages the caller did *not* send are touched, so opening a thread
 * cannot mark your own outgoing message as read by the recipient.
 */
export async function markConversationRead(
  conversationId: string,
  userId: string,
): Promise<{ markedRead: number }> {
  const conversation = await q1<{ customer_id: string; farmer_id: string }>(
    'SELECT customer_id, farmer_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (!conversation) {
    throw new HttpError(404, 'That conversation could not be found.', 'CONVERSATION_NOT_FOUND');
  }

  const marked = await q(
    `UPDATE messages SET read_at = now()
      WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL
      RETURNING id`,
    [conversationId, userId],
  );

  const column = conversation.customer_id === userId ? 'customer_last_read_at' : 'farmer_last_read_at';
  await q(`UPDATE conversations SET ${column} = now() WHERE id = $1`, [conversationId]);

  return { markedRead: marked.length };
}

export async function unreadMessageCount(userId: string): Promise<number> {
  const row = await q1<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE (c.customer_id = $1 OR c.farmer_id = $1)
        AND m.sender_id <> $1
        AND m.read_at IS NULL`,
    [userId],
  );
  return row?.n ?? 0;
}

/**
 * Block the other party in a thread.
 *
 * A block is one-directional and stops the blocked user from sending further
 * messages. Existing history is preserved for the record.
 */
export async function blockCounterpart(
  conversationId: string,
  userId: string,
  reason?: string | null,
): Promise<void> {
  const conversation = await q1<{ customer_id: string; farmer_id: string }>(
    'SELECT customer_id, farmer_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (!conversation) {
    throw new HttpError(404, 'That conversation could not be found.', 'CONVERSATION_NOT_FOUND');
  }

  const counterpartId =
    conversation.customer_id === userId ? conversation.farmer_id : conversation.customer_id;

  await q(
    `INSERT INTO user_blocks (blocker_id, blocked_id, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [userId, counterpartId, reason ?? null],
  );

  const column = conversation.customer_id === userId ? 'customer_blocked' : 'farmer_blocked';
  await q(`UPDATE conversations SET ${column} = true WHERE id = $1`, [conversationId]);

  await audit({
    action: 'user.block',
    entityType: 'user',
    entityId: counterpartId,
    after: { conversationId },
  });
}

export async function unblockCounterpart(conversationId: string, userId: string): Promise<void> {
  const conversation = await q1<{ customer_id: string; farmer_id: string }>(
    'SELECT customer_id, farmer_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (!conversation) {
    throw new HttpError(404, 'That conversation could not be found.', 'CONVERSATION_NOT_FOUND');
  }

  const counterpartId =
    conversation.customer_id === userId ? conversation.farmer_id : conversation.customer_id;

  await q('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [
    userId,
    counterpartId,
  ]);

  const column = conversation.customer_id === userId ? 'customer_blocked' : 'farmer_blocked';
  await q(`UPDATE conversations SET ${column} = false WHERE id = $1`, [conversationId]);
}

/** Insert a system note into a thread (an order update, for example). */
export async function postSystemMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<void> {
  await q(
    `INSERT INTO messages (conversation_id, sender_id, body, is_system)
     VALUES ($1, $2, $3, true)`,
    [conversationId, senderId, body],
  );
}
