import { Router } from 'express';
import { HttpError } from '../db/pool.js';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { count, haversineKm, paginate, q, q1 } from '../services/helpers.js';
import * as products from '../services/products.js';
import * as quality from '../services/quality.js';
import * as reviews from '../services/reviews.js';
import { farmerProfileUpdateSchema, verificationRequestSchema } from './schemas.js';

export const farmersRouter = Router();

/**
 * Public farmer directory.
 *
 * Reads public_farmer_profiles, which exposes only farmers who are not
 * suspended, and only the fields a farmer has agreed to publish. Coordinates
 * appear only when the farmer opted in with location_public, so a farmer who
 * declined is not locatable from the directory.
 */

farmersRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = paginate(Number(query.page ?? 1), Number(query.page_size ?? 20));

    const params: unknown[] = [];
    const clauses: string[] = [];

    if (query.search) {
      params.push(`%${query.search}%`);
      clauses.push(
        `(fp.full_name ILIKE $${params.length} OR fp.farm_name ILIKE $${params.length})`,
      );
    }
    if (query.state) {
      params.push(query.state);
      clauses.push(`fp.state = $${params.length}`);
    }
    if (query.district) {
      params.push(query.district);
      clauses.push(`fp.district = $${params.length}`);
    }
    if (query.verified === 'true') {
      clauses.push(`fp.verification_status = 'verified'`);
    }
    if (query.crop) {
      params.push(`%${query.crop}%`);
      clauses.push(`EXISTS (
        SELECT 1 FROM public_products p
         WHERE p.farmer_id = fp.user_id AND p.name ILIKE $${params.length}
      )`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(
      `SELECT count(*)::int AS n FROM public_farmer_profiles fp ${where}`,
      params,
    );

    const limitIdx = params.push(page.pageSize);
    const offsetIdx = params.push(page.offset);

    const items = await q(
      `SELECT fp.* FROM public_farmer_profiles fp ${where}
        ORDER BY fp.verification_status = 'verified' DESC,
                 fp.rating_avg DESC NULLS LAST,
                 fp.active_listings DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    res.json({
      items,
      page: page.page,
      page_size: page.pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / page.pageSize)),
    });
  }),
);

/**
 * Farmers near a point.
 *
 * Distance comes from Haversine over consented coordinates, so this works with
 * no mapping provider configured. When a farmer has not published their
 * location, they are excluded from distance results rather than shown at an
 * approximate spot — `public_farmer_profiles` returns NULL coordinates unless
 * the farmer opted in with location_public.
 *
 * Declared before `/:id` on purpose: Express matches in registration order, so
 * a later `/nearby-farmers` would be captured by `/:id` and rejected as a
 * malformed id.
 *
 * Both coordinate conventions are accepted, because the catalogue endpoint
 * (`/api/products`) uses `near_lat`/`near_lng`/`max_distance_km` while this
 * endpoint is documented as `lat`/`lng`/`radius_km`.
 */
farmersRouter.get(
  '/nearby-farmers',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;

    const parseCoordinate = (
      raw: string | undefined,
      label: string,
      limit: number,
    ): number | undefined => {
      if (raw === undefined || raw === '') return undefined;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < -limit || value > limit) {
        throw new HttpError(400, `The ${label} is not a valid coordinate.`, 'INVALID_INPUT');
      }
      return value;
    };

    const lat = parseCoordinate(query.lat ?? query.near_lat, 'latitude', 90);
    const lng = parseCoordinate(query.lng ?? query.near_lng, 'longitude', 180);

    const radiusRaw = query.radius_km ?? query.max_distance_km;
    let radius = 100;
    if (radiusRaw !== undefined && radiusRaw !== '') {
      const parsed = Number(radiusRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HttpError(
          400,
          'The search radius must be a positive number of kilometres.',
          'INVALID_INPUT',
        );
      }
      radius = parsed;
    }

    const params: unknown[] = [];
    const clauses: string[] = [];

    if (query.crop) {
      params.push(`%${query.crop}%`);
      clauses.push(`EXISTS (
        SELECT 1 FROM public_products p
         WHERE p.farmer_id = fp.user_id AND p.name ILIKE $${params.length}
      )`);
    }
    if (query.state) {
      params.push(query.state);
      clauses.push(`fp.state = $${params.length}`);
    }
    if (query.district) {
      params.push(query.district);
      clauses.push(`fp.district = $${params.length}`);
    }
    if (query.verified === 'true') {
      clauses.push(`fp.verification_status = 'verified'`);
    }

    const hasPoint = lat !== undefined && lng !== undefined;
    if (hasPoint) {
      // Only farmers who published coordinates can be measured against a point.
      clauses.push('fp.latitude IS NOT NULL AND fp.longitude IS NOT NULL');
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // The full public projection, so the list view and the map both have the
    // coordinates and farm details they render.
    const rows = await q<
      Record<string, unknown> & { latitude: number | null; longitude: number | null }
    >(
      `SELECT fp.*
         FROM public_farmer_profiles fp
        ${where}
        ORDER BY fp.verification_status = 'verified' DESC,
                 fp.rating_avg DESC NULLS LAST,
                 fp.active_listings DESC
        LIMIT 200`,
      params,
    );

    if (!hasPoint) {
      // No reference point: return the directory ordered by activity so the
      // page still has something useful to show.
      res.json({
        farmers: rows,
        reference: null,
        note: 'No location provided, so results are not sorted by distance.',
      });
      return;
    }

    const withDistance = rows
      .map((row) => ({
        ...row,
        distance_km: haversineKm(lat, lng, Number(row.latitude), Number(row.longitude)),
      }))
      .filter((row) => row.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json({
      farmers: withDistance,
      reference: { lat, lng, radius_km: radius },
      note: null,
    });
  }),
);

/**
 * One farmer's public profile, their listings, and their reviews.
 *
 * The farmer id is the profile id, which is also the id customers use when
 * opening a conversation.
 */
farmersRouter.get(
  '/:id',
  generalLimiter,
  withDb(async (req, res) => {
    const farmerId = req.params.id!;

    const farmer = await q1(
      `SELECT user_id, full_name, profile_photo, farm_name, state, district, village,
              farming_type, crops_cultivated, bio, verification_status, verification_note,
              verified_at, rating_avg, rating_count, active_listings,
              offers_delivery, offers_pickup, created_at
         FROM public_farmer_profiles
        WHERE user_id = $1`,
      [farmerId],
    );

    if (!farmer) {
      throw new HttpError(404, 'That farm could not be found.', 'FARMER_NOT_FOUND');
    }

    const listings = await q(
      `SELECT id, name, variety, price, unit::text, stock_quantity, minimum_order_quantity,
              grade::text, harvest_date, state, district, primary_image,
              offers_delivery, offers_pickup, rating_avg, rating_count
         FROM public_products
        WHERE farmer_id = $1
        ORDER BY created_at DESC
        LIMIT 60`,
      [farmerId],
    );

    const farmerReviews = await reviews.listFarmerReviews(farmerId, 30);

    res.json({ farmer, listings, reviews: farmerReviews });
  }),
);

// ---------------------------------------------------------------------------
// The signed-in farmer's own profile
// ---------------------------------------------------------------------------

export const farmerProfileRouter = Router();

farmerProfileRouter.use(requireSession, requireRole('farmer'));

farmerProfileRouter.get(
  '/',
  generalLimiter,
  withDb(async (req, res) => {
    const profile = await q1(
      `SELECT user_id, farm_name, state, district, village, public_address,
              latitude, longitude, location_public, farming_type, crops_cultivated,
              bio, offers_delivery, offers_pickup, verification_status::text,
              verification_note, verified_at, rating_avg, rating_count
         FROM farmer_profiles WHERE user_id = $1`,
      [req.session!.sub],
    );
    if (!profile) throw new HttpError(404, 'Farm profile not found.', 'PROFILE_NOT_FOUND');

    const verificationRequests = await q(
      `SELECT id, status::text, notes, review_note, created_at, reviewed_at
         FROM farmer_verification_requests WHERE farmer_id = $1 ORDER BY created_at DESC`,
      [req.session!.sub],
    );

    res.json({ profile, verification_requests: verificationRequests });
  }),
);

farmerProfileRouter.patch(
  '/',
  writeLimiter,
  validateBody(farmerProfileUpdateSchema),
  withDb(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const columns = [
      'farm_name', 'state', 'district', 'village', 'public_address',
      'latitude', 'longitude', 'location_public', 'farming_type',
      'crops_cultivated', 'bio', 'offers_delivery', 'offers_pickup',
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

    params.push(req.session!.sub);
    const updated = await q(
      `UPDATE farmer_profiles SET ${sets.join(', ')}
        WHERE user_id = $${params.length} RETURNING user_id`,
      params,
    );
    if (updated.length === 0) {
      throw new HttpError(404, 'Farm profile not found.', 'PROFILE_NOT_FOUND');
    }

    res.json({ message: 'Farm profile updated.' });
  }),
);

/**
 * Ask for verification.
 *
 * A request is a claim awaiting review; it never sets verification_status
 * itself. That column only moves through the administrator decision path,
 * which the guard_quality_verification trigger enforces.
 */
farmerProfileRouter.post(
  '/verification-request',
  writeLimiter,
  validateBody(verificationRequestSchema),
  withDb(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const open = await count(
      `SELECT count(*)::int AS n FROM farmer_verification_requests
        WHERE farmer_id = $1 AND status IN ('open', 'under_review')`,
      [req.session!.sub],
    );
    if (open > 0) {
      throw new HttpError(
        409,
        'You already have a verification request awaiting review.',
        'REQUEST_PENDING',
      );
    }

    const profile = await q1<{ farm_name: string | null; verification_status: string }>(
      `SELECT farm_name, verification_status::text AS verification_status
         FROM farmer_profiles WHERE user_id = $1`,
      [req.session!.sub],
    );
    if (profile?.verification_status === 'verified') {
      throw new HttpError(409, 'Your farm is already verified.', 'ALREADY_VERIFIED');
    }

    const created = await q1<{ id: string }>(
      `INSERT INTO farmer_verification_requests
         (farmer_id, farm_name, id_document_path, land_document_path, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        req.session!.sub,
        (body.farm_name as string) ?? profile?.farm_name ?? null,
        (body.id_document_path as string) ?? null,
        (body.land_document_path as string) ?? null,
        (body.notes as string) ?? null,
      ],
    );

    // Put the farm into the pending state so the farmer's own view reflects
    // that something is in flight.
    await q(
      `UPDATE farmer_profiles SET verification_status = 'pending'
        WHERE user_id = $1 AND verification_status = 'unverified'`,
      [req.session!.sub],
    );

    res.status(201).json({
      id: created?.id,
      message: 'Your verification request has been submitted for review.',
    });
  }),
);

/** Upload a verification document (identity or land). */
farmerProfileRouter.post(
  '/verification-documents',
  writeLimiter,
  withDb(async (req, res) => {
    const file = (req as typeof req & {
      file?: { buffer: Buffer; originalname: string; mimetype: string; size: number };
    }).file;
    if (!file) throw new HttpError(400, 'No file was uploaded.', 'NO_FILE');

    const kind = req.query.kind === 'land' ? 'land' : 'id';
    const { storeUpload } = await import('../services/storage.js');
    const stored = await storeUpload(req.session!.sub, file, 'document', `verification-${kind}`);

    res.status(201).json({ path: stored.key, kind });
  }),
);

// ---------------------------------------------------------------------------
// Farmer dashboard overview
// ---------------------------------------------------------------------------

export const dashboardRouter = Router();

dashboardRouter.get(
  '/farmer',
  requireSession,
  requireRole('farmer'),
  generalLimiter,
  withDb(async (req, res) => {
    const farmerId = req.session!.sub;

    const listingStats = await q1<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE status = 'active')::int AS active_listings,
         count(*) FILTER (WHERE status = 'draft')::int AS draft_listings,
         count(*) FILTER (WHERE status = 'out_of_stock')::int AS out_of_stock,
         coalesce(sum(stock_quantity) FILTER (WHERE status = 'active'), 0) AS available_stock,
         count(*)::int AS total_listings,
         coalesce(sum(view_count), 0)::int AS total_views
       FROM products WHERE farmer_id = $1`,
      [farmerId],
    );

    const orderStats = await q1<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE order_status = 'pending_confirmation')::int AS pending_orders,
         count(*) FILTER (WHERE order_status IN ('accepted','preparing','ready_for_pickup','shipped'))::int AS active_orders,
         count(*) FILTER (WHERE order_status = 'delivered')::int AS completed_orders,
         count(*) FILTER (WHERE order_status = 'cancelled')::int AS cancelled_orders,
         coalesce(sum(total_amount) FILTER (WHERE order_status = 'delivered'), 0) AS total_sales,
         count(*)::int AS total_orders
       FROM orders WHERE farmer_id = $1`,
      [farmerId],
    );

    // Earnings come from captured payments, not from order totals: an unpaid
    // order is not money received.
    const earnings = await q1<Record<string, number>>(
      `SELECT
         coalesce(sum(p.amount) FILTER (WHERE p.status = 'captured'), 0) AS captured,
         coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.status IN ('captured','refund_pending','refunded')), 0) AS net,
         coalesce(sum(p.refunded_amount), 0) AS refunded,
         count(*) FILTER (WHERE p.status = 'captured')::int AS captured_count,
         count(*) FILTER (WHERE p.status = 'failed')::int AS failed_count
       FROM payments p
       JOIN orders o ON o.id = p.order_id
      WHERE o.farmer_id = $1`,
      [farmerId],
    );

    const recentOrders = await q(
      `SELECT o.id, o.order_number, o.total_amount, o.order_status::text, o.payment_status::text,
              o.created_at, cu.full_name AS customer_name
         FROM orders o
         JOIN profiles cu ON cu.id = o.customer_id
        WHERE o.farmer_id = $1
        ORDER BY o.created_at DESC LIMIT 8`,
      [farmerId],
    );

    const recentInquiries = await q(
      `SELECT c.id, c.subject, c.updated_at, cu.full_name AS customer_name,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT count(*)::int FROM messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread_count
         FROM conversations c
         JOIN profiles cu ON cu.id = c.customer_id
        WHERE c.farmer_id = $1
        ORDER BY c.updated_at DESC LIMIT 5`,
      [farmerId],
    );

    // Sales over the last 12 weeks, for the performance chart. Empty weeks
    // return no row, so the client fills the gaps.
    const salesByWeek = await q(
      `SELECT date_trunc('week', o.created_at)::date AS week_start,
              count(*)::int AS order_count,
              coalesce(sum(o.total_amount), 0) AS value
         FROM orders o
        WHERE o.farmer_id = $1
          AND o.order_status <> 'cancelled'
          AND o.created_at >= CURRENT_DATE - 84
        GROUP BY 1 ORDER BY 1`,
      [farmerId],
    );

    const topProducts = await q(
      `SELECT p.id, p.name, p.price, p.unit::text, p.stock_quantity, p.status::text,
              coalesce(sum(oi.quantity), 0) AS quantity_sold,
              coalesce(sum(oi.subtotal), 0) AS revenue,
              (SELECT pi.storage_path FROM product_images pi
                WHERE pi.product_id = p.id AND pi.media_type = 'image'
                ORDER BY pi.sort_order LIMIT 1) AS primary_image
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON o.id = oi.order_id AND o.order_status <> 'cancelled'
        WHERE p.farmer_id = $1
        GROUP BY p.id
        ORDER BY revenue DESC, p.view_count DESC
        LIMIT 6`,
      [farmerId],
    );

    const unreadMessages = await q1<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.farmer_id = $1 AND m.sender_id <> $1 AND m.read_at IS NULL`,
      [farmerId],
    );

    res.json({
      listing_stats: listingStats ?? {},
      order_stats: orderStats ?? {},
      earnings: earnings ?? {},
      recent_orders: recentOrders,
      recent_inquiries: recentInquiries,
      sales_by_week: salesByWeek,
      top_products: topProducts,
      unread_messages: unreadMessages?.n ?? 0,
    });
  }),
);

dashboardRouter.get(
  '/customer',
  requireSession,
  requireRole('customer'),
  generalLimiter,
  withDb(async (req, res) => {
    const customerId = req.session!.sub;

    const orderStats = await q1<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE order_status = 'pending_confirmation')::int AS pending_orders,
         count(*) FILTER (WHERE order_status IN ('accepted','preparing','ready_for_pickup','shipped'))::int AS active_orders,
         count(*) FILTER (WHERE order_status = 'delivered')::int AS completed_orders,
         count(*) FILTER (WHERE order_status = 'cancelled')::int AS cancelled_orders,
         coalesce(sum(total_amount) FILTER (WHERE order_status = 'delivered'), 0) AS total_spent,
         count(*)::int AS total_orders
       FROM orders WHERE customer_id = $1`,
      [customerId],
    );

    const recentOrders = await q(
      `SELECT o.id, o.order_number, o.total_amount, o.order_status::text, o.payment_status::text,
              o.created_at, fu.full_name AS farmer_name,
              (SELECT oi.product_name_snapshot FROM order_items oi
                WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS first_item_name
         FROM orders o
         JOIN profiles fu ON fu.id = o.farmer_id
        WHERE o.customer_id = $1
        ORDER BY o.created_at DESC LIMIT 8`,
      [customerId],
    );

    // The full public projection, not a hand-picked subset: the dashboard
    // renders these through the same ProductCard as the catalogue, which reads
    // village, stock, farmer name and verification. Selecting a narrower set
    // here produced cards with blank locations and no stock.
    const recommended = await q(
      `SELECT *
         FROM public_products
        WHERE state = (SELECT state FROM customer_addresses
                        WHERE customer_id = $1 ORDER BY is_default DESC LIMIT 1)
        ORDER BY rating_avg DESC NULLS LAST, created_at DESC
        LIMIT 6`,
      [customerId],
    );

    const pendingReviews = await reviews.pendingReviews(customerId);
    const unread = await q1<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.customer_id = $1 AND m.sender_id <> $1 AND m.read_at IS NULL`,
      [customerId],
    );

    res.json({
      order_stats: orderStats ?? {},
      recent_orders: recentOrders,
      recommended,
      pending_reviews: pendingReviews,
      unread_messages: unread?.n ?? 0,
    });
  }),
);

export const qualityPublicHelpers = { quality, products };
