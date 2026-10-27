import { HttpError } from '../db/pool.js';
import { audit, count, haversineKm, likeTerm, notify, q, q1, type Page, toPage, type Pagination } from './helpers.js';

export interface ProductInput {
  name: string;
  category_id?: number | null;
  variety?: string | null;
  description?: string | null;
  price: number;
  unit: string;
  custom_unit?: string | null;
  stock_quantity: number;
  minimum_order_quantity: number;
  bulk_min_quantity?: number | null;
  bulk_price_per_unit?: number | null;
  price_negotiable?: boolean;
  delivery_charge?: number;
  harvest_date?: string | null;
  grade?: 'A' | 'B' | 'C' | 'ungraded';
  moisture_content?: number | null;
  visible_defects?: string | null;
  size_appearance?: string | null;
  storage_conditions?: string | null;
  pesticide_info?: string | null;
  organic_certified?: boolean;
  organic_cert_number?: string | null;
  offers_delivery?: boolean;
  offers_pickup?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  status?: 'draft' | 'active' | 'out_of_stock' | 'inactive';
}

export interface ProductFilters {
  search?: string;
  category?: string;
  variety?: string;
  farmer?: string;
  state?: string;
  district?: string;
  village?: string;
  minPrice?: number;
  maxPrice?: number;
  grade?: string;
  harvestAfter?: string;
  harvestBefore?: string;
  minQuantity?: number;
  offersDelivery?: boolean;
  offersPickup?: boolean;
  verifiedFarmersOnly?: boolean;
  nearLat?: number;
  nearLng?: number;
  maxDistanceKm?: number;
  sort?: 'recent' | 'price_asc' | 'price_desc' | 'nearest' | 'rating';
  status?: 'active' | 'draft' | 'out_of_stock' | 'inactive';
}

/**
 * Build the WHERE clause shared by the listing and count queries.
 *
 * Values are always passed as bound parameters. The only strings interpolated
 * into SQL are chosen from a fixed allow-list (sort direction), never taken
 * from user input directly.
 */
function buildProductFilter(filters: ProductFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.search) {
    const term = likeTerm(filters.search);
    const a = add(term);
    const b = add(term);
    const c = add(term);
    const d = add(term);
    clauses.push(
      `(p.name ILIKE ${a} OR p.variety ILIKE ${b} OR p.description ILIKE ${c} OR p.farmer_name ILIKE ${d})`,
    );
  }
  if (filters.category) {
    clauses.push(`p.category_slug = ${add(filters.category)}`);
  }
  if (filters.variety) {
    clauses.push(`p.variety ILIKE ${add(likeTerm(filters.variety))}`);
  }
  if (filters.farmer) {
    clauses.push(`p.farmer_name ILIKE ${add(likeTerm(filters.farmer))}`);
  }
  if (filters.state) clauses.push(`p.state = ${add(filters.state)}`);
  if (filters.district) clauses.push(`p.district = ${add(filters.district)}`);
  if (filters.village) clauses.push(`p.village ILIKE ${add(likeTerm(filters.village))}`);
  if (filters.minPrice !== undefined) clauses.push(`p.price >= ${add(filters.minPrice)}`);
  if (filters.maxPrice !== undefined) clauses.push(`p.price <= ${add(filters.maxPrice)}`);
  if (filters.grade) clauses.push(`p.grade = ${add(filters.grade)}::quality_grade`);
  if (filters.harvestAfter) clauses.push(`p.harvest_date >= ${add(filters.harvestAfter)}::date`);
  if (filters.harvestBefore) clauses.push(`p.harvest_date <= ${add(filters.harvestBefore)}::date`);
  if (filters.minQuantity !== undefined) {
    clauses.push(`p.stock_quantity >= ${add(filters.minQuantity)}`);
  }
  if (filters.offersDelivery) clauses.push(`p.offers_delivery = true`);
  if (filters.offersPickup) clauses.push(`p.offers_pickup = true`);
  if (filters.verifiedFarmersOnly) clauses.push(`p.farmer_verification_status = 'verified'`);

  // Restrict to the caller's own rows when browsing their own listings.
  if (filters.status) clauses.push(`p.status = ${add(filters.status)}::product_status`);

  // Bounding box for proximity search. The exact Haversine cut happens after
  // the query, because it cannot use an index. A box alone would let in the
  // corners, so both stages are needed.
  if (
    filters.nearLat !== undefined &&
    filters.nearLng !== undefined &&
    filters.maxDistanceKm !== undefined
  ) {
    const latDelta = filters.maxDistanceKm / 111;
    const lngDelta =
      filters.maxDistanceKm / (111 * Math.max(0.05, Math.cos((filters.nearLat * Math.PI) / 180)));
    const lo = add(filters.nearLat - latDelta);
    const hi = add(filters.nearLat + latDelta);
    const loLng = add(filters.nearLng - lngDelta);
    const hiLng = add(filters.nearLng + lngDelta);
    clauses.push(
      `p.latitude IS NOT NULL AND p.longitude IS NOT NULL
       AND p.latitude BETWEEN ${lo} AND ${hi}
       AND p.longitude BETWEEN ${loLng} AND ${hiLng}`,
    );
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function orderByClause(sort: ProductFilters['sort']): string {
  switch (sort) {
    case 'price_asc':
      return 'ORDER BY p.price ASC, p.created_at DESC';
    case 'price_desc':
      return 'ORDER BY p.price DESC, p.created_at DESC';
    case 'rating':
      return 'ORDER BY p.rating_avg DESC, p.rating_count DESC, p.created_at DESC';
    case 'nearest':
      // Sorted in JS after the distance filter, because the reference point is
      // a parameter. Falls back to recency when no point was supplied.
      return 'ORDER BY p.created_at DESC';
    case 'recent':
    default:
      return 'ORDER BY p.created_at DESC';
  }
}

interface ProductRow extends Record<string, unknown> {
  id: string;
  price: number;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Browse the public catalogue.
 *
 * Reads from the public_products view, so even a signed-in customer is filtered
 * to active listings from non-suspended farmers. Drafts are unreachable here.
 */
export async function listPublicProducts(
  filters: ProductFilters,
  p: Pagination,
): Promise<Page<Record<string, unknown>>> {
  const { where, params } = buildProductFilter(filters);

  // Reads the view alone. The view is owned by the schema owner and bypasses
  // RLS, exposing only active listings from non-suspended farmers; re-joining
  // the base tables here would put those rows back behind their own policies.
  const fromClause = `FROM public_products p ${where}`;

  // The count query references only the filter parameters, so it gets its own
  // copy. Supplying unused parameters to a prepared statement is an error in
  // PostgreSQL, not a no-op.
  const total = await count(`SELECT count(*)::int AS n ${fromClause}`, [...params]);

  // Pagination parameters are appended last so their placeholders are stable
  // no matter how many filters were applied.
  const limitIdx = params.push(p.pageSize);
  const offsetIdx = params.push(p.offset);

  const rows = await q<ProductRow>(
    `SELECT p.* ${fromClause} ${orderByClause(filters.sort)} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  let items: Array<Record<string, unknown>> = rows;

  const hasReferencePoint = filters.nearLat !== undefined && filters.nearLng !== undefined;
  if (hasReferencePoint) {
    // Exact distance for display, and for the final radius cut that removes the
    // corners of the SQL bounding box.
    const radius = filters.maxDistanceKm;
    items = rows
      .map((row) => ({
        ...row,
        distance_km:
          row.latitude !== null && row.longitude !== null
            ? haversineKm(filters.nearLat!, filters.nearLng!, row.latitude, row.longitude)
            : null,
      }))
      .filter((row) => radius === undefined || row.distance_km === null || row.distance_km <= radius);

    if (filters.sort === 'nearest') {
      items.sort((a, b) => {
        const da = (a.distance_km as number | null) ?? Number.POSITIVE_INFINITY;
        const db = (b.distance_km as number | null) ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
  }

  return toPage(items, total, p);
}

/** Full public detail for one product. 404s for drafts and missing rows alike. */
export async function getPublicProduct(id: string): Promise<Record<string, unknown>> {
  const product = await q1<Record<string, unknown>>(
    'SELECT * FROM public_products WHERE id = $1',
    [id],
  );
  if (!product) {
    throw new HttpError(404, 'That product is not available.', 'PRODUCT_NOT_FOUND');
  }

  const images = await q(
    'SELECT id, storage_path, caption, media_type, sort_order FROM public_product_images WHERE product_id = $1 ORDER BY sort_order, id',
    [id],
  );

  // Quality reports are filtered to what the view permits: measurements are
  // always visible, the attached document only once a reviewer verified it.
  const qualityReports = await q(
    `SELECT id, report_type, title, summary, measurements, ai_findings, ai_disclaimer,
            inspection_provider, inspection_date, inspector_name,
            verification_status, expiry_date, reviewed_at, report_document, created_at
       FROM public_quality_reports
      WHERE product_id = $1
      ORDER BY created_at DESC`,
    [id],
  );

  const reviews = await q(
    `SELECT id, product_rating, seller_rating, comment, photo_path,
            is_verified_purchase, reviewer_display_name, created_at
       FROM public_reviews
      WHERE product_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [id],
  );

  const similar = await q(
    `SELECT id, name, variety, price, unit, state, district, primary_image,
            rating_avg, rating_count, grade
       FROM public_products
      WHERE category_id = (SELECT category_id FROM public_products WHERE id = $1)
        AND id <> $1
      ORDER BY rating_avg DESC, created_at DESC
      LIMIT 6`,
    [id],
  );

  const farmer = await q1(
    `SELECT user_id, full_name, profile_photo, farm_name, state, district, village,
            verification_status, rating_avg, rating_count, active_listings,
            offers_delivery, offers_pickup, bio, farming_type, crops_cultivated, created_at
       FROM public_farmer_profiles
      WHERE user_id = $1`,
    [product.farmer_id],
  );

  // Count a view. Goes through a SECURITY DEFINER function because the runtime
  // role has no UPDATE privilege on products, and fire-and-forget because a
  // counter failure must never break the page.
  await q('SELECT increment_product_view($1)', [id]).catch(() => {});

  return { ...product, images, qualityReports, reviews, similar, farmer };
}

/** A farmer's own listings, including drafts and out-of-stock rows. */
export async function listFarmerProducts(
  farmerId: string,
  p: Pagination,
  options: { status?: string; search?: string } = {},
): Promise<Page<Record<string, unknown>>> {
  const params: unknown[] = [farmerId];
  const clauses = ['p.farmer_id = $1'];
  if (options.status) {
    params.push(options.status);
    clauses.push(`p.status = $${params.length}::product_status`);
  }
  if (options.search) {
    params.push(likeTerm(options.search));
    clauses.push(`p.name ILIKE $${params.length}`);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const total = await count(`SELECT count(*)::int AS n FROM products p ${where}`, params);

  const items = await q(
    `SELECT p.*, cc.name AS category_name, cc.slug AS category_slug,
            (SELECT pi.storage_path FROM product_images pi
              WHERE pi.product_id = p.id AND pi.media_type = 'image'
              ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS primary_image,
            (SELECT count(*)::int FROM product_images pi WHERE pi.product_id = p.id) AS image_count,
            (SELECT count(*)::int FROM order_items oi WHERE oi.product_id = p.id) AS times_ordered
       FROM products p
       LEFT JOIN crop_categories cc ON cc.id = p.category_id
       ${where}
       ORDER BY p.updated_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, p.pageSize, p.offset],
  );

  return toPage(items, total, p);
}

/** A single product owned by the caller, with everything needed to edit it. */
export async function getOwnProduct(
  productId: string,
  farmerId: string,
): Promise<Record<string, unknown>> {
  const product = await q1<Record<string, unknown>>(
    'SELECT * FROM products WHERE id = $1 AND farmer_id = $2',
    [productId, farmerId],
  );
  if (!product) {
    throw new HttpError(404, 'That product could not be found.', 'PRODUCT_NOT_FOUND');
  }
  const images = await q(
    'SELECT id, storage_path, caption, media_type, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order, id',
    [productId],
  );
  const qualityReports = await q(
    `SELECT id, report_type, title, summary, measurements, ai_findings, ai_disclaimer,
            report_document, inspection_provider, inspection_date, inspector_name,
            verification_status, expiry_date, review_note, reviewed_at, created_at
       FROM crop_quality_reports
      WHERE product_id = $1
      ORDER BY created_at DESC`,
    [productId],
  );
  return { ...product, images, qualityReports };
}

export async function createProduct(
  farmerId: string,
  input: ProductInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ id: string }> {
  const location = await q1<{ state: string; district: string; village: string; latitude: number | null; longitude: number | null }>(
    'SELECT state, district, village, latitude, longitude FROM farmer_profiles WHERE user_id = $1',
    [farmerId],
  );
  if (!location) {
    throw new HttpError(400, 'Complete your farm profile before listing a crop.', 'PROFILE_INCOMPLETE');
  }

  validatePricing(input);

  // A listing published with no stock would appear in the catalogue and then
  // reject every order. Saving it as a draft keeps the farmer's work without
  // exposing an unorderable listing.
  if (input.status === 'active' && input.stock_quantity <= 0) {
    throw new HttpError(
      422,
      'Add stock before publishing this listing. Save it as a draft instead.',
      'NO_STOCK',
      { stock_quantity: 'Set the available quantity before publishing.' },
    );
  }

  const created = await q1<{ id: string }>(
    `INSERT INTO products (
       farmer_id, name, category_id, variety, description,
       state, district, village,
       price, unit, custom_unit, stock_quantity, minimum_order_quantity,
       bulk_min_quantity, bulk_price_per_unit, price_negotiable, delivery_charge,
       harvest_date, grade, moisture_content, visible_defects, size_appearance,
       storage_conditions, pesticide_info, organic_certified, organic_cert_number,
       offers_delivery, offers_pickup, latitude, longitude, status
     ) VALUES (
       $1,$2,$3,$4,$5,
       $6,$7,$8,
       $9,$10,$11,$12,$13,
       $14,$15,$16,$17,
       $18,$19,$20,$21,$22,
       $23,$24,$25,$26,
       $27,$28,$29,$30,$31
     ) RETURNING id`,
    [
      farmerId, input.name, input.category_id ?? null, input.variety ?? null, input.description ?? null,
      location.state, location.district, location.village,
      input.price, input.unit, input.custom_unit ?? null,
      input.stock_quantity, input.minimum_order_quantity,
      input.bulk_min_quantity ?? null, input.bulk_price_per_unit ?? null,
      input.price_negotiable ?? false, input.delivery_charge ?? 0,
      input.harvest_date ?? null, input.grade ?? 'ungraded',
      input.moisture_content ?? null, input.visible_defects ?? null,
      input.size_appearance ?? null, input.storage_conditions ?? null,
      input.pesticide_info ?? null, input.organic_certified ?? false,
      input.organic_cert_number ?? null,
      input.offers_delivery ?? true, input.offers_pickup ?? true,
      input.latitude ?? location.latitude, input.longitude ?? location.longitude,
      input.status ?? 'draft',
    ],
  );
  if (!created) throw new HttpError(500, 'The listing could not be created.', 'CREATE_FAILED');

  await audit({
    action: 'product.create',
    entityType: 'product',
    entityId: created.id,
    after: { name: input.name, price: input.price, status: input.status ?? 'draft' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return created;
}

export async function updateProduct(
  productId: string,
  farmerId: string,
  input: Partial<ProductInput>,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const before = await q1<Record<string, unknown>>(
    'SELECT * FROM products WHERE id = $1 AND farmer_id = $2',
    [productId, farmerId],
  );
  if (!before) throw new HttpError(404, 'That product could not be found.', 'PRODUCT_NOT_FOUND');

  const merged: ProductInput = { ...(before as unknown as ProductInput), ...input };
  validatePricing(merged);

  // Only the columns the caller actually sent are updated, so a partial save
  // from the edit form cannot blank a field the form did not render.
  const writable: Array<[keyof ProductInput, string, (v: unknown) => unknown]> = [
    ['name', 'name', (v) => v],
    ['category_id', 'category_id', (v) => v ?? null],
    ['variety', 'variety', (v) => v ?? null],
    ['description', 'description', (v) => v ?? null],
    ['price', 'price', (v) => v],
    ['unit', 'unit', (v) => v],
    ['custom_unit', 'custom_unit', (v) => v ?? null],
    ['stock_quantity', 'stock_quantity', (v) => v],
    ['minimum_order_quantity', 'minimum_order_quantity', (v) => v],
    ['bulk_min_quantity', 'bulk_min_quantity', (v) => v ?? null],
    ['bulk_price_per_unit', 'bulk_price_per_unit', (v) => v ?? null],
    ['price_negotiable', 'price_negotiable', (v) => v ?? false],
    ['delivery_charge', 'delivery_charge', (v) => v ?? 0],
    ['harvest_date', 'harvest_date', (v) => v ?? null],
    ['grade', 'grade', (v) => v ?? 'ungraded'],
    ['moisture_content', 'moisture_content', (v) => v ?? null],
    ['visible_defects', 'visible_defects', (v) => v ?? null],
    ['size_appearance', 'size_appearance', (v) => v ?? null],
    ['storage_conditions', 'storage_conditions', (v) => v ?? null],
    ['pesticide_info', 'pesticide_info', (v) => v ?? null],
    ['organic_certified', 'organic_certified', (v) => v ?? false],
    ['organic_cert_number', 'organic_cert_number', (v) => v ?? null],
    ['offers_delivery', 'offers_delivery', (v) => v ?? true],
    ['offers_pickup', 'offers_pickup', (v) => v ?? true],
    ['latitude', 'latitude', (v) => v ?? null],
    ['longitude', 'longitude', (v) => v ?? null],
    ['status', 'status', (v) => v ?? 'draft'],
  ];

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column, coerce] of writable) {
    if (!(key in input)) continue;
    params.push(coerce(input[key]));
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return;

  params.push(productId, farmerId);
  const updated = await q(
    `UPDATE products SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND farmer_id = $${params.length}
      RETURNING id`,
    params,
  );
  if (updated.length === 0) {
    throw new HttpError(403, 'You can only edit your own listings.', 'NOT_OWNER');
  }

  await audit({
    action: 'product.update',
    entityType: 'product',
    entityId: productId,
    before: { price: before.price, status: before.status, stock_quantity: before.stock_quantity },
    after: {
      price: input.price ?? before.price,
      status: input.status ?? before.status,
      stock_quantity: input.stock_quantity ?? before.stock_quantity,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/**
 * Reject pricing that the schema would reject anyway, but with a message that
 * points at the field. The database constraints remain the real guarantee.
 */
function validatePricing(input: ProductInput): void {
  const errors: Record<string, string> = {};

  if (!(input.price > 0)) errors.price = 'Enter a price greater than zero.';
  if (input.stock_quantity < 0) errors.stock_quantity = 'Stock cannot be negative.';
  if (input.minimum_order_quantity <= 0) {
    errors.minimum_order_quantity = 'Minimum order quantity must be greater than zero.';
  }
  if (input.minimum_order_quantity > input.stock_quantity && input.stock_quantity > 0) {
    errors.minimum_order_quantity =
      'Minimum order quantity cannot exceed the available stock.';
  }
  if (input.bulk_min_quantity && !input.bulk_price_per_unit) {
    errors.bulk_price_per_unit = 'Enter the bulk price, or clear the bulk quantity.';
  }
  if (!input.bulk_min_quantity && input.bulk_price_per_unit) {
    errors.bulk_min_quantity = 'Enter the bulk quantity, or clear the bulk price.';
  }
  if (
    input.bulk_min_quantity &&
    input.bulk_price_per_unit &&
    input.bulk_price_per_unit >= input.price
  ) {
    errors.bulk_price_per_unit =
      'The bulk price should be lower than the regular price to be useful.';
  }
  if (input.organic_certified && !input.organic_cert_number) {
    errors.organic_cert_number =
      'Enter the certification number, or turn off the organic claim.';
  }
  if (input.unit === 'other' && !input.custom_unit) {
    errors.custom_unit = 'Name the unit you are using.';
  }
  if (input.delivery_charge !== undefined && input.delivery_charge < 0) {
    errors.delivery_charge = 'Delivery charge cannot be negative.';
  }
  if (input.moisture_content !== undefined && input.moisture_content !== null) {
    if (input.moisture_content < 0 || input.moisture_content > 100) {
      errors.moisture_content = 'Moisture content is a percentage between 0 and 100.';
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new HttpError(422, 'Please correct the highlighted fields.', 'VALIDATION_FAILED', errors);
  }
}

export async function setProductStatus(
  productId: string,
  farmerId: string,
  status: 'draft' | 'active' | 'out_of_stock' | 'inactive',
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const product = await q1<{ id: string; stock_quantity: number; status: string }>(
    'SELECT id, stock_quantity, status FROM products WHERE id = $1 AND farmer_id = $2',
    [productId, farmerId],
  );
  if (!product) throw new HttpError(404, 'That product could not be found.', 'PRODUCT_NOT_FOUND');

  // Publishing an empty listing would put a card in the catalogue that can
  // never be ordered.
  if (status === 'active' && Number(product.stock_quantity) <= 0) {
    throw new HttpError(
      400,
      'Add stock before publishing this listing.',
      'NO_STOCK',
      { stock_quantity: 'Set the available quantity first.' },
    );
  }

  await q('UPDATE products SET status = $1::product_status WHERE id = $2', [status, productId]);

  await audit({
    action: 'product.status_change',
    entityType: 'product',
    entityId: productId,
    before: { status: product.status },
    after: { status },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function deleteProduct(
  productId: string,
  farmerId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  // A product referenced by a delivered or in-flight order must stay, because
  // order history and reviews point at it. Deactivate instead.
  const ordered = await count(
    `SELECT count(*)::int AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1
        AND o.order_status NOT IN ('cancelled', 'refunded')`,
    [productId],
  );
  if (ordered > 0) {
    throw new HttpError(
      409,
      'This listing has orders against it, so it cannot be deleted. Mark it inactive instead.',
      'PRODUCT_HAS_ORDERS',
    );
  }

  const removed = await q(
    'DELETE FROM products WHERE id = $1 AND farmer_id = $2 RETURNING id',
    [productId, farmerId],
  );
  if (removed.length === 0) {
    throw new HttpError(404, 'That product could not be found.', 'PRODUCT_NOT_FOUND');
  }

  await audit({
    action: 'product.delete',
    entityType: 'product',
    entityId: productId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function listCategories(): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT id, slug, name, localized_names, description, icon
       FROM crop_categories
      WHERE is_active
      ORDER BY sort_order, name`,
  );
}

/** Distinct states that currently have at least one active listing. */
export async function listActiveStates(): Promise<string[]> {
  const rows = await q<{ state: string }>(
    `SELECT DISTINCT state FROM public_products WHERE state IS NOT NULL ORDER BY state`,
  );
  return rows.map((r) => r.state);
}

export async function listDistrictsInState(state: string): Promise<string[]> {
  const rows = await q<{ district: string }>(
    `SELECT DISTINCT district FROM public_products
      WHERE state = $1 AND district IS NOT NULL ORDER BY district`,
    [state],
  );
  return rows.map((r) => r.district);
}

/**
 * Land in a customer's inbox when a farmer replies. Kept here rather than in
 * the message service so both chat and order updates can reuse it.
 */
export async function notifyNewMessage(
  recipientId: string,
  senderName: string,
  preview: string,
  conversationId: string,
): Promise<void> {
  await notify(
    recipientId,
    'message',
    `New message from ${senderName}`,
    preview.slice(0, 140),
    `/messages/${conversationId}`,
    { conversationId },
  );
}
