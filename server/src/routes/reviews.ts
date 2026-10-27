import { Router } from 'express';
import { HttpError } from '../db/pool.js';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { q, q1 } from '../services/helpers.js';
import * as quality from '../services/quality.js';
import * as reviews from '../services/reviews.js';
import * as storage from '../services/storage.js';
import {
  qualityIssueSchema,
  reportSchema,
  reviewSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const reviewsRouter = Router();

reviewsRouter.get(
  '/farmer/:farmerId',
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ reviews: await reviews.listFarmerReviews(req.params.farmerId!) });
  }),
);

reviewsRouter.get(
  '/product/:productId',
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ reviews: await reviews.listProductReviews(req.params.productId!) });
  }),
);

/** Reviews the caller still owes on delivered orders. */
reviewsRouter.get(
  '/pending',
  requireSession,
  requireRole('customer'),
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ pending: await reviews.pendingReviews(req.session!.sub) });
  }),
);

reviewsRouter.get(
  '/mine',
  requireSession,
  requireRole('customer'),
  generalLimiter,
  withDb(async (req, res) => {
    res.json({ reviews: await reviews.listCustomerReviews(req.session!.sub) });
  }),
);

/**
 * Submit a review.
 *
 * Only a customer who actually received the order can do this: the service
 * checks the order is theirs and is delivered, the reviews_insert_author policy
 * restates it in SQL, and the reviews table's unique index blocks a second
 * review for the same product on the same order.
 */
reviewsRouter.post(
  '/',
  requireSession,
  requireRole('customer'),
  writeLimiter,
  validateBody(reviewSchema),
  withDb(async (req, res) => {
    const created = await reviews.createReview(req.session!.sub, req.body, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ id: created.id, message: 'Thank you for your review.' });
  }),
);

/** Attach a photograph to a review the caller owns. */
reviewsRouter.post(
  '/:id/photo',
  requireSession,
  requireRole('customer'),
  writeLimiter,
  withDb(async (req, res) => {
    const file = (req as typeof req & {
      file?: { buffer: Buffer; originalname: string; mimetype: string; size: number };
    }).file;
    if (!file) throw new HttpError(400, 'No file was uploaded.', 'NO_FILE');

    const review = await q1<{ id: string }>(
      'SELECT id FROM reviews WHERE id = $1 AND customer_id = $2',
      [req.params.id, req.session!.sub],
    );
    if (!review) throw new HttpError(404, 'That review could not be found.', 'REVIEW_NOT_FOUND');

    const stored = await storage.storeUpload(req.session!.sub, file, 'image', 'reviews');
    await q('UPDATE reviews SET photo_path = $1 WHERE id = $2', [stored.key, req.params.id]);

    res.status(201).json({ photo_path: stored.key });
  }),
);

reviewsRouter.post(
  '/:id/report',
  requireSession,
  writeLimiter,
  validateBody(reportSchema.partial({ target_type: true, target_id: true })),
  withDb(async (req, res) => {
    const body = req.body as { reason: string; details?: string | null };
    const created = await reviews.reportReview(
      req.session!.sub,
      req.params.id!,
      body.reason,
      body.details ?? null,
    );
    res.status(201).json({ id: created.id, message: 'Thank you. A moderator will review this.' });
  }),
);

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export const qualityRouter = Router();

qualityRouter.get(
  '/standards',
  generalLimiter,
  withDb(async (_req, res) => {
    // The public explanation of what each badge does and does not mean. Kept
    // server-side so the wording is identical everywhere it appears.
    res.json({
      report_types: quality.REPORT_TYPE_LABELS,
      verification_statuses: quality.QUALITY_STATUS_LABELS,
      ai_disclaimer: quality.AI_DISCLAIMER,
      trust_levels: [
        {
          key: 'registered',
          label: 'Registered user',
          meaning: 'Confirmed their email address. This is the starting point, not a trust signal.',
        },
        {
          key: 'identity_verified',
          label: 'Identity verified',
          meaning: 'An administrator has checked a government identity document.',
        },
        {
          key: 'farmer_verified',
          label: 'Farmer verified',
          meaning:
            'An administrator has reviewed identity and land or farm documents. Shown as a badge on the farm.',
        },
        {
          key: 'quality_inspected',
          label: 'Quality inspected',
          meaning:
            'A specific quality report on a specific listing was reviewed and accepted. It applies to that listing only.',
        },
      ],
      limitations: [
        'RythuDirect does not certify food safety, residues, or nutritional content.',
        'A verified badge applies to the documents reviewed, at the date reviewed.',
        'AI-assisted visual assessment is preliminary and is never an official verification.',
      ],
    });
  }),
);

/** A farmer asks an administrator to review a quality report. */
qualityRouter.post(
  '/reports/:id/request-review',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  withDb(async (req, res) => {
    await quality.requestQualityReview(req.session!.sub, req.params.id!, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: 'Your report has been sent for review.' });
  }),
);

qualityRouter.get(
  '/reports/mine',
  requireSession,
  requireRole('farmer'),
  generalLimiter,
  withDb(async (req, res) => {
    const reports = await q(
      `SELECT qr.id, qr.product_id, qr.report_type::text, qr.title, qr.summary,
              qr.measurements, qr.ai_findings, qr.ai_disclaimer, qr.report_document,
              qr.inspection_provider, qr.inspection_date, qr.inspector_name,
              qr.verification_status::text, qr.expiry_date, qr.review_note,
              qr.reviewed_at, qr.created_at,
              p.name AS product_name
         FROM crop_quality_reports qr
         LEFT JOIN products p ON p.id = qr.product_id
        WHERE qr.submitted_by = $1
        ORDER BY qr.created_at DESC`,
      [req.session!.sub],
    );
    res.json({
      reports,
      status_labels: quality.QUALITY_STATUS_LABELS,
      report_type_labels: quality.REPORT_TYPE_LABELS,
      ai_disclaimer: quality.AI_DISCLAIMER,
    });
  }),
);

/** Ask for an AI-assisted visual assessment of one of the caller's images. */
qualityRouter.post(
  '/ai-assess',
  requireSession,
  writeLimiter,
  withDb(async (req, res) => {
    const body = req.body as { product_id?: string; image_path?: string };
    if (!body.product_id || !body.image_path) {
      throw new HttpError(400, 'A product and an image are required.', 'MISSING_FIELDS');
    }

    // The image must belong to a listing the caller can see, and the key must
    // resolve inside the storage root.
    storage.resolveStoragePath(body.image_path);

    const result = await quality.analyseCropImage(
      req.session!.sub,
      { product_id: body.product_id, image_path: body.image_path },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
    res.json(result);
  }),
);

/** A customer flags a suspected quality problem on a listing. */
qualityRouter.post(
  '/issues',
  requireSession,
  writeLimiter,
  validateBody(qualityIssueSchema),
  withDb(async (req, res) => {
    const created = await quality.reportQualityIssue(req.session!.sub, req.body as never);
    res.status(201).json({
      id: created.id,
      message: 'Thank you. An administrator will look into this.',
    });
  }),
);

// ---------------------------------------------------------------------------
// General reports (products, reviews, users, messages)
// ---------------------------------------------------------------------------

export const reportsRouter = Router();

reportsRouter.use(requireSession);

reportsRouter.post(
  '/',
  writeLimiter,
  validateBody(reportSchema),
  withDb(async (req, res) => {
    const body = req.body as {
      target_type: 'product' | 'review' | 'user' | 'message';
      target_id: string;
      reason: string;
      details?: string | null;
    };

    // A report about a message must concern a conversation the reporter is in,
    // otherwise the report would leak that the message exists.
    if (body.target_type === 'message') {
      const visible = await q1<{ id: string }>('SELECT id FROM messages WHERE id = $1', [
        body.target_id,
      ]);
      if (!visible) throw new HttpError(404, 'That message could not be found.', 'MESSAGE_NOT_FOUND');
    }

    const created = await q1<{ id: string }>(
      `INSERT INTO user_reports (reporter_id, target_type, target_id, reason, details)
       VALUES ($1, $2::report_target, $3, $4, $5)
       RETURNING id`,
      [req.session!.sub, body.target_type, body.target_id, body.reason, body.details ?? null],
    );

    res.status(201).json({
      id: created?.id,
      message: 'Thank you. An administrator will review this report.',
    });
  }),
);

reportsRouter.get(
  '/mine',
  generalLimiter,
  withDb(async (req, res) => {
    const reports = await q(
      `SELECT id, target_type::text, target_id, reason, status::text, resolution, created_at
         FROM user_reports WHERE reporter_id = $1 ORDER BY created_at DESC`,
      [req.session!.sub],
    );
    res.json({ reports });
  }),
);
