import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError } from '../db/pool.js';
import { attachSession, requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, uploadLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { getQuery, validateBody, validateQuery } from '../middleware/validate.js';
import { paginate, q, q1 } from '../services/helpers.js';
import * as products from '../services/products.js';
import * as quality from '../services/quality.js';
import * as storage from '../services/storage.js';
import {
  productFiltersSchema,
  productSchema,
  productStatusSchema,
  productUpdateSchema,
  qualityReportSchema,
} from './schemas.js';

export const productsRouter = Router();

// ---------------------------------------------------------------------------
// Public catalogue.
//
// These read the public_products view, which exposes only active listings from
// non-suspended farmers and only public columns. An anonymous request therefore
// cannot reach a draft, a suspended seller, or a private field even if a
// handler here had a bug.
// ---------------------------------------------------------------------------

productsRouter.get(
  '/',
  generalLimiter,
  validateQuery(productFiltersSchema),
  withDb(async (req, res) => {
    const query = getQuery<Record<string, unknown>>(req);
    const page = await products.listPublicProducts(
      {
        search: query.search as string | undefined,
        category: query.category as string | undefined,
        variety: query.variety as string | undefined,
        farmer: query.farmer as string | undefined,
        state: query.state as string | undefined,
        district: query.district as string | undefined,
        village: query.village as string | undefined,
        minPrice: query.min_price as number | undefined,
        maxPrice: query.max_price as number | undefined,
        grade: query.grade as string | undefined,
        harvestAfter: query.harvest_after as string | undefined,
        harvestBefore: query.harvest_before as string | undefined,
        minQuantity: query.min_quantity as number | undefined,
        offersDelivery: query.offers_delivery as boolean | undefined,
        offersPickup: query.offers_pickup as boolean | undefined,
        verifiedFarmersOnly: query.verified_farmers_only as boolean | undefined,
        nearLat: query.near_lat as number | undefined,
        nearLng: query.near_lng as number | undefined,
        maxDistanceKm: query.max_distance_km as number | undefined,
        sort: query.sort as never,
      },
      paginate(query.page as number, query.page_size as number),
    );
    res.json(page);
  }),
);

productsRouter.get(
  '/categories',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({ categories: await products.listCategories() });
  }),
);

productsRouter.get(
  '/locations/states',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({ states: await products.listActiveStates() });
  }),
);

productsRouter.get(
  '/locations/districts',
  generalLimiter,
  validateQuery(z.object({ state: z.string().trim().min(2).max(80) })),
  withDb(async (req, res) => {
    const { state } = getQuery<{ state: string }>(req);
    res.json({ districts: await products.listDistrictsInState(state) });
  }),
);

// ---------------------------------------------------------------------------
// A farmer's own listings, drafts included. Declared before "/:id" so that
// "/mine" is not parsed as a product identifier.
// ---------------------------------------------------------------------------

productsRouter.get(
  '/mine',
  requireSession,
  requireRole('farmer'),
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await products.listFarmerProducts(
      req.session!.sub,
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
      { status: query.status, search: query.search },
    );
    res.json(page);
  }),
);

productsRouter.post(
  '/',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(productSchema),
  withDb(async (req, res) => {
    const created = await products.createProduct(req.session!.sub, req.body, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    const product = await products.getOwnProduct(created.id, req.session!.sub);
    res.status(201).json({ product });
  }),
);

productsRouter.get(
  '/:id',
  generalLimiter,
  attachSession,
  withDb(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new HttpError(400, 'A product id is required.', 'MISSING_ID');

    // A farmer inspecting their own listing gets the owner view, drafts and
    // all. Everybody else goes through the public view, where a draft simply
    // does not exist.
    if (req.session?.role === 'farmer') {
      try {
        const own = await products.getOwnProduct(id, req.session.sub);
        res.json({ product: own, is_owner: true });
        return;
      } catch {
        // Not theirs — fall through to the public lookup.
      }
    }

    const product = await products.getPublicProduct(id);
    res.json({ product, is_owner: false });
  }),
);

productsRouter.patch(
  '/:id',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(productUpdateSchema),
  withDb(async (req, res) => {
    await products.updateProduct(
      req.params.id!,
      req.session!.sub,
      req.body,
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
    const product = await products.getOwnProduct(req.params.id!, req.session!.sub);
    res.json({ product });
  }),
);

productsRouter.put(
  '/:id/status',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(productStatusSchema),
  withDb(async (req, res) => {
    await products.setProductStatus(
      req.params.id!,
      req.session!.sub,
      (req.body as { status: 'draft' | 'active' | 'out_of_stock' | 'inactive' }).status,
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
    res.json({ message: 'Listing updated.' });
  }),
);

productsRouter.delete(
  '/:id',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  withDb(async (req, res) => {
    await products.deleteProduct(req.params.id!, req.session!.sub, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: 'Listing deleted.' });
  }),
);

// ---------------------------------------------------------------------------
// Product media
// ---------------------------------------------------------------------------

productsRouter.post(
  '/:id/images',
  requireSession,
  requireRole('farmer'),
  uploadLimiter,
  withDb(async (req, res) => {
    const file = readUpload(req);
    const kind: storage.UploadKind = req.query.kind === 'video' ? 'video' : 'image';

    // Ownership check first: getOwnProduct throws 404 for anything that is not
    // the caller's, which covers a nonexistent id as well.
    await products.getOwnProduct(req.params.id!, req.session!.sub);

    const stored = await storage.storeUpload(req.session!.sub, file, kind, 'products');

    const row = await q1<{ id: string; sort_order: number }>(
      `INSERT INTO product_images
         (product_id, storage_path, caption, media_type, byte_size, mime_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6,
               coalesce((SELECT max(sort_order) + 1 FROM product_images WHERE product_id = $1), 0))
       RETURNING id, sort_order`,
      [
        req.params.id,
        stored.key,
        (req.query.caption as string | undefined) ?? null,
        kind === 'video' ? 'video' : 'image',
        stored.byteSize,
        stored.mimeType,
      ],
    );

    res.status(201).json({
      image: {
        id: row?.id,
        storage_path: stored.key,
        media_type: kind === 'video' ? 'video' : 'image',
        byte_size: stored.byteSize,
        mime_type: stored.mimeType,
      },
    });
  }),
);

productsRouter.delete(
  '/:id/images/:imageId',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  withDb(async (req, res) => {
    await products.getOwnProduct(req.params.id!, req.session!.sub);

    const image = await q1<{ storage_path: string }>(
      'SELECT storage_path FROM product_images WHERE id = $1 AND product_id = $2',
      [req.params.imageId, req.params.id],
    );
    if (!image) throw new HttpError(404, 'That image could not be found.', 'IMAGE_NOT_FOUND');

    // The row goes first: an orphaned file is harmless, whereas a row pointing
    // at a deleted file is a broken image on a live listing.
    await q('DELETE FROM product_images WHERE id = $1', [req.params.imageId]);
    await storage.deleteStoredFile(image.storage_path);

    res.json({ message: 'Image removed.' });
  }),
);

// ---------------------------------------------------------------------------
// Quality information on a listing
// ---------------------------------------------------------------------------

productsRouter.get(
  '/:id/quality-reports',
  generalLimiter,
  withDb(async (req, res) => {
    // publicOnly reads the view, which releases an attached document only once
    // a reviewer has verified it.
    const reports = await quality.listQualityReportsForProduct(req.params.id!, {
      publicOnly: true,
    });
    res.json({
      reports,
      report_type_labels: quality.REPORT_TYPE_LABELS,
      status_labels: quality.QUALITY_STATUS_LABELS,
      ai_disclaimer: quality.AI_DISCLAIMER,
    });
  }),
);

productsRouter.post(
  '/:id/quality-reports',
  requireSession,
  requireRole('farmer'),
  writeLimiter,
  validateBody(qualityReportSchema),
  withDb(async (req, res) => {
    const body = req.body as { product_id: string };
    if (body.product_id !== req.params.id) {
      throw new HttpError(400, 'The product id in the body does not match the URL.', 'ID_MISMATCH');
    }
    const created = await quality.createFarmerQualityReport(
      req.session!.sub,
      req.body as never,
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
    res.status(201).json({ id: created.id, message: 'Quality information saved.' });
  }),
);

/**
 * Read the multipart upload that multer already buffered.
 *
 * multer runs in index.ts with a memory limit, so by the time a handler is
 * reached the file is in memory and its size has been enforced.
 */
function readUpload(req: Request): {
  buffer: Buffer; originalname: string; mimetype: string; size: number;
} {
  const file = (req as Request & { file?: { buffer: Buffer; originalname: string; mimetype: string; size: number } }).file;
  if (!file) throw new HttpError(400, 'No file was uploaded.', 'NO_FILE');
  return file;
}
