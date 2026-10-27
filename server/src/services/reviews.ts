import { HttpError } from '../db/pool.js';
import { audit, count, notify, q, q1 } from './helpers.js';

/**
 * Reviews.
 *
 * Two rules carry the trust model, and both are enforced in the database as
 * well as here:
 *   1. Only a verified purchaser may review — the order must belong to the
 *      caller and be in the `delivered` state. See the reviews_insert_author
 *      policy, which re-states this in SQL.
 *   2. One review per product per order. See reviews_order_product_idx.
 */

export interface ReviewInput {
  order_id: string;
  product_id?: string | null;
  product_rating: number;
  seller_rating: number;
  comment?: string | null;
  photo_path?: string | null;
}

export async function createReview(
  customerId: string,
  input: ReviewInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ id: string }> {
  const order = await q1<{
    id: string; order_number: string; farmer_id: string; order_status: string;
  }>(
    `SELECT id, order_number, farmer_id, order_status::text AS order_status
       FROM orders WHERE id = $1 AND customer_id = $2`,
    [input.order_id, customerId],
  );
  if (!order) {
    throw new HttpError(404, 'That order could not be found.', 'ORDER_NOT_FOUND');
  }
  if (order.order_status !== 'delivered') {
    throw new HttpError(
      403,
      'You can review an order once it has been delivered.',
      'ORDER_NOT_DELIVERED',
    );
  }

  // Resolve the product: either named explicitly (a multi-item order) or the
  // only item in the order.
  let productId = input.product_id ?? null;
  if (!productId) {
    const items = await q<{ product_id: string | null }>(
      'SELECT product_id FROM order_items WHERE order_id = $1 ORDER BY created_at',
      [input.order_id],
    );
    if (items.length === 1) {
      productId = items[0]?.product_id ?? null;
    } else {
      throw new HttpError(
        400,
        'Choose which product in this order you are reviewing.',
        'PRODUCT_REQUIRED',
      );
    }
  }

  // The product must genuinely be in this order. Without this check a customer
  // could attach a review to any product they had ever ordered anything near.
  const inOrder = await count(
    'SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND product_id = $2',
    [input.order_id, productId],
  );
  if (inOrder === 0) {
    throw new HttpError(
      400,
      'That product is not part of this order.',
      'PRODUCT_NOT_IN_ORDER',
    );
  }

  if (!Number.isInteger(input.product_rating) || input.product_rating < 1 || input.product_rating > 5) {
    throw new HttpError(422, 'Choose a product rating from 1 to 5.', 'INVALID_RATING', {
      product_rating: 'Choose a rating between 1 and 5.',
    });
  }
  if (!Number.isInteger(input.seller_rating) || input.seller_rating < 1 || input.seller_rating > 5) {
    throw new HttpError(422, 'Choose a seller rating from 1 to 5.', 'INVALID_RATING', {
      seller_rating: 'Choose a rating between 1 and 5.',
    });
  }
  if (input.comment && input.comment.length > 2000) {
    throw new HttpError(422, 'Keep your review under 2000 characters.', 'COMMENT_TOO_LONG');
  }

  const created = await q1<{ id: string }>(
    `INSERT INTO reviews (
       order_id, product_id, farmer_id, customer_id,
       product_rating, seller_rating, comment, photo_path, is_verified_purchase
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id`,
    [
      input.order_id, productId, order.farmer_id, customerId,
      input.product_rating, input.seller_rating,
      input.comment?.trim() || null, input.photo_path ?? null,
    ],
  );
  if (!created) throw new HttpError(500, 'The review could not be saved.', 'CREATE_FAILED');

  // Rating averages are recalculated by the reviews_refresh_* triggers, so
  // products.rating_avg and farmer_profiles.rating_avg are already correct.

  await notify(
    order.farmer_id,
    'review',
    `New ${input.seller_rating}-star review`,
    input.comment?.slice(0, 140) ?? 'A customer left a review on a completed order.',
    '/farmer/profile',
    { reviewId: created.id, orderId: input.order_id },
  );

  await audit({
    action: 'review.create',
    entityType: 'review',
    entityId: created.id,
    after: {
      order_id: input.order_id,
      product_id: productId,
      product_rating: input.product_rating,
      seller_rating: input.seller_rating,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return created;
}

export async function listProductReviews(productId: string, limit = 20): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT id, product_rating, seller_rating, comment, photo_path,
            is_verified_purchase, reviewer_display_name, created_at
       FROM public_reviews
      WHERE product_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [productId, limit],
  );
}

export async function listFarmerReviews(farmerId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT id, product_id, product_rating, seller_rating, comment, photo_path,
            is_verified_purchase, reviewer_display_name, product_name, created_at
       FROM public_reviews
      WHERE farmer_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [farmerId, limit],
  );
}

export async function listCustomerReviews(customerId: string): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT r.id, r.order_id, r.product_id, r.product_rating, r.seller_rating,
            r.comment, r.photo_path, r.is_hidden, r.created_at,
            p.name AS product_name, fu.full_name AS farmer_name
       FROM reviews r
       LEFT JOIN products p ON p.id = r.product_id
       JOIN public_profiles fu ON fu.id = r.farmer_id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC`,
    [customerId],
  );
}

/** Flag a review for moderation. Any signed-in user may do this. */
export async function reportReview(
  reporterId: string,
  reviewId: string,
  reason: string,
  details?: string | null,
): Promise<{ id: string }> {
  const review = await q1<{ id: string }>('SELECT id FROM reviews WHERE id = $1', [reviewId]);
  if (!review) throw new HttpError(404, 'That review could not be found.', 'REVIEW_NOT_FOUND');

  const created = await q1<{ id: string }>(
    `INSERT INTO user_reports (reporter_id, target_type, target_id, reason, details)
     VALUES ($1, 'review', $2, $3, $4)
     RETURNING id`,
    [reporterId, reviewId, reason, details ?? null],
  );
  if (!created) throw new HttpError(500, 'The report could not be submitted.', 'CREATE_FAILED');
  return created;
}

/** Hide or restore a review. Administrator only; recorded in the audit log. */
export async function moderateReview(
  adminId: string,
  reviewId: string,
  hide: boolean,
  note: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const before = await q1<{ is_hidden: boolean }>(
    'SELECT is_hidden FROM reviews WHERE id = $1',
    [reviewId],
  );
  if (!before) throw new HttpError(404, 'That review could not be found.', 'REVIEW_NOT_FOUND');

  await q('UPDATE reviews SET is_hidden = $1, moderation_note = $2 WHERE id = $3', [
    hide,
    note,
    reviewId,
  ]);

  await audit({
    action: hide ? 'review.hide' : 'review.restore',
    entityType: 'review',
    entityId: reviewId,
    before: { is_hidden: before.is_hidden },
    after: { is_hidden: hide, note },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** Reviews the caller is still entitled to leave, for the "awaiting review" prompt. */
export async function pendingReviews(customerId: string): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT o.id AS order_id, o.order_number, o.delivered_at,
            fu.full_name AS farmer_name,
            oi.product_id, oi.product_name_snapshot AS product_name,
            oi.quantity, oi.unit_snapshot
       FROM orders o
       JOIN public_profiles fu ON fu.id = o.farmer_id
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = $1
        AND o.order_status = 'delivered'
        AND NOT EXISTS (
          SELECT 1 FROM reviews r
           WHERE r.order_id = o.id
             AND (r.product_id = oi.product_id OR (r.product_id IS NULL AND oi.product_id IS NULL))
        )
      ORDER BY o.delivered_at DESC NULLS LAST
      LIMIT 20`,
    [customerId],
  );
}
