import { HttpError, asVerifiedAdmin } from '../db/pool.js';
import { audit, count, notify, q, q1, type Page, toPage, type Pagination } from './helpers.js';

/**
 * Administrator operations.
 *
 * Every function here is wrapped in asVerifiedAdmin(), which re-reads the
 * caller's role from the database inside the current transaction before setting
 * the privileged flag. Two consequences matter:
 *
 *   - A JWT issued while somebody was an admin stops working the moment their
 *     role changes, because the role is read from the row, not the token.
 *   - The privileged flag is what the guard triggers check, so a privilege
 *     escalation attempted through any other code path fails at the database.
 */

export interface AdminOverview {
  counts: Record<string, number>;
  recentOrders: Array<Record<string, unknown>>;
  pendingVerifications: number;
  openReports: number;
  pendingQualityReviews: number;
}

export async function adminOverview(): Promise<AdminOverview> {
  return asVerifiedAdmin(async () => {
    const counts = await q1<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM profiles WHERE role = 'farmer')   AS farmers,
         (SELECT count(*)::int FROM profiles WHERE role = 'customer') AS customers,
         (SELECT count(*)::int FROM profiles WHERE is_suspended)      AS suspended_accounts,
         (SELECT count(*)::int FROM products WHERE status = 'active') AS active_listings,
         (SELECT count(*)::int FROM products WHERE status = 'draft')  AS draft_listings,
         (SELECT count(*)::int FROM orders)                           AS total_orders,
         (SELECT count(*)::int FROM orders WHERE order_status = 'pending_confirmation') AS pending_orders,
         (SELECT count(*)::int FROM orders WHERE order_status = 'delivered') AS delivered_orders,
         (SELECT coalesce(sum(total_amount), 0) FROM orders WHERE order_status = 'delivered') AS gross_sales,
         (SELECT count(*)::int FROM payments WHERE status = 'captured') AS captured_payments,
         (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'captured') AS captured_amount,
         (SELECT count(*)::int FROM payments WHERE status = 'failed') AS failed_payments,
         (SELECT count(*)::int FROM farmer_verification_requests WHERE status IN ('open','under_review')) AS pending_verifications,
         (SELECT count(*)::int FROM crop_quality_reports WHERE verification_status = 'pending') AS pending_quality_reviews,
         (SELECT count(*)::int FROM user_reports WHERE status IN ('open','under_review')) AS open_reports,
         (SELECT count(*)::int FROM reviews WHERE is_hidden) AS hidden_reviews,
         (SELECT count(*)::int FROM conversations) AS conversations,
         (SELECT count(*)::int FROM market_price_observations) AS market_observations`,
    );

    const recentOrders = await q(
      `SELECT o.id, o.order_number, o.total_amount, o.order_status::text, o.payment_status::text,
              o.created_at, cu.full_name AS customer_name, fu.full_name AS farmer_name
         FROM orders o
         JOIN profiles cu ON cu.id = o.customer_id
         JOIN profiles fu ON fu.id = o.farmer_id
        ORDER BY o.created_at DESC
        LIMIT 10`,
    );

    return {
      counts: counts ?? {},
      recentOrders,
      pendingVerifications: counts?.pending_verifications ?? 0,
      openReports: counts?.open_reports ?? 0,
      pendingQualityReviews: counts?.pending_quality_reviews ?? 0,
    };
  });
}

export async function listUsers(
  p: Pagination,
  filters: { role?: string; search?: string; suspended?: boolean } = {},
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filters.role) {
      params.push(filters.role);
      clauses.push(`pr.role = $${params.length}::user_role`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      clauses.push(`(pr.full_name ILIKE $${params.length} OR pr.email::text ILIKE $${params.length})`);
    }
    if (filters.suspended !== undefined) {
      params.push(filters.suspended);
      clauses.push(`pr.is_suspended = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(`SELECT count(*)::int AS n FROM profiles pr ${where}`, params);

    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT pr.id, pr.full_name, pr.email, pr.phone, pr.role::text, pr.preferred_language::text,
              pr.profile_photo, pr.email_verified, pr.identity_verified, pr.is_suspended,
              pr.suspended_reason, pr.last_login_at, pr.created_at,
              fp.verification_status::text AS farmer_verification,
              fp.state, fp.district,
              (SELECT count(*)::int FROM products p WHERE p.farmer_id = pr.id) AS listing_count,
              (SELECT count(*)::int FROM orders o WHERE o.customer_id = pr.id OR o.farmer_id = pr.id) AS order_count
         FROM profiles pr
         LEFT JOIN farmer_profiles fp ON fp.user_id = pr.id
         ${where}
        ORDER BY pr.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

export async function getUserDetail(userId: string): Promise<Record<string, unknown>> {
  return asVerifiedAdmin(async () => {
    const profile = await q1(
      `SELECT pr.id, pr.full_name, pr.email, pr.phone, pr.role::text, pr.preferred_language::text,
              pr.profile_photo, pr.email_verified, pr.identity_verified, pr.is_suspended,
              pr.suspended_reason, pr.last_login_at, pr.created_at, pr.updated_at,
              fp.farm_name, fp.state, fp.district, fp.village, fp.public_address,
              fp.farming_type, fp.crops_cultivated, fp.verification_status::text AS farmer_verification,
              fp.verification_note, fp.verified_at, fp.rating_avg, fp.rating_count
         FROM profiles pr
         LEFT JOIN farmer_profiles fp ON fp.user_id = pr.id
        WHERE pr.id = $1`,
      [userId],
    );
    if (!profile) throw new HttpError(404, 'That account could not be found.', 'USER_NOT_FOUND');

    const [products, orders, reports, consents, verificationRequests] = await Promise.all([
      q(
        `SELECT id, name, price, unit::text, stock_quantity, status::text, is_flagged, created_at
           FROM products WHERE farmer_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      ),
      q(
        `SELECT id, order_number, total_amount, order_status::text, payment_status::text, created_at
           FROM orders WHERE customer_id = $1 OR farmer_id = $1
          ORDER BY created_at DESC LIMIT 50`,
        [userId],
      ),
      q(
        `SELECT id, target_type::text, target_id, reason, status::text, created_at
           FROM user_reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [userId],
      ),
      q(
        `SELECT consent_type, version, granted, created_at
           FROM user_consents WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      ),
      q(
        `SELECT id, status::text, notes, review_note, created_at, reviewed_at
           FROM farmer_verification_requests WHERE farmer_id = $1 ORDER BY created_at DESC`,
        [userId],
      ),
    ]);

    return { profile, products, orders, reports, consents, verificationRequests };
  });
}

/** Suspend or reinstate an account. */
export async function setUserSuspended(
  userId: string,
  suspended: boolean,
  reason: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const before = await q1<{ is_suspended: boolean; role: string }>(
      'SELECT is_suspended, role::text AS role FROM profiles WHERE id = $1',
      [userId],
    );
    if (!before) throw new HttpError(404, 'That account could not be found.', 'USER_NOT_FOUND');

    // An administrator locking themselves out is a support incident, and
    // locking out the last administrator is an outage.
    if (userId === (await currentUserId()) && suspended) {
      throw new HttpError(400, 'You cannot suspend your own account.', 'CANNOT_SUSPEND_SELF');
    }
    if (before.role === 'admin' && suspended) {
      const remaining = await count(
        `SELECT count(*)::int AS n FROM profiles WHERE role = 'admin' AND NOT is_suspended AND id <> $1`,
        [userId],
      );
      if (remaining === 0) {
        throw new HttpError(
          400,
          'This is the only active administrator. Promote another account first.',
          'LAST_ADMIN',
        );
      }
    }

    await q('UPDATE profiles SET is_suspended = $1, suspended_reason = $2 WHERE id = $3', [
      suspended,
      suspended ? reason : null,
      userId,
    ]);

    if (suspended) {
      // Deactivate their listings so the catalogue does not advertise produce
      // nobody can buy. Stock is untouched, so reinstating restores the state.
      await q(
        `UPDATE products SET status = 'inactive'
          WHERE farmer_id = $1 AND status IN ('active', 'out_of_stock')`,
        [userId],
      );
      await notify(
        userId,
        'system',
        'Your account has been suspended',
        reason ?? 'Contact support for details.',
        '/help',
      );
    }

    await audit({
      action: suspended ? 'admin.user_suspend' : 'admin.user_reinstate',
      entityType: 'profile',
      entityId: userId,
      before: { is_suspended: before.is_suspended },
      after: { is_suspended: suspended, reason },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

async function currentUserId(): Promise<string | null> {
  const row = await q1<{ uid: string | null }>(
    `SELECT NULLIF(current_setting('rythudirect.user_id', true), '')::uuid AS uid`,
  );
  return row?.uid ?? null;
}

/**
 * Change a user's role.
 *
 * The privileged context is what lets the guard_profile_role trigger accept the
 * write. Without it the UPDATE raises, which is the defence against a
 * privilege-escalation bug anywhere else in the codebase.
 */
export async function setUserRole(
  userId: string,
  role: 'farmer' | 'customer' | 'admin',
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const before = await q1<{ role: string }>(
      'SELECT role::text AS role FROM profiles WHERE id = $1',
      [userId],
    );
    if (!before) throw new HttpError(404, 'That account could not be found.', 'USER_NOT_FOUND');

    if (before.role === 'admin' && role !== 'admin') {
      const remaining = await count(
        `SELECT count(*)::int AS n FROM profiles WHERE role = 'admin' AND id <> $1`,
        [userId],
      );
      if (remaining === 0) {
        throw new HttpError(400, 'You cannot demote the only administrator.', 'LAST_ADMIN');
      }
    }

    await q('UPDATE profiles SET role = $1::user_role WHERE id = $2', [role, userId]);

    // A farmer without a farmer_profiles row would break every product write.
    if (role === 'farmer') {
      const hasProfile = await count(
        'SELECT count(*)::int AS n FROM farmer_profiles WHERE user_id = $1',
        [userId],
      );
      if (hasProfile === 0) {
        throw new HttpError(
          400,
          'This account has no farm profile. Have them register as a farmer instead.',
          'FARM_PROFILE_MISSING',
        );
      }
    }

    await audit({
      action: 'admin.user_role_change',
      entityType: 'profile',
      entityId: userId,
      before: { role: before.role },
      after: { role },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export async function listAllProducts(
  p: Pagination,
  filters: { status?: string; search?: string; flagged?: boolean } = {},
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filters.status) {
      params.push(filters.status);
      clauses.push(`p.status = $${params.length}::product_status`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      clauses.push(`p.name ILIKE $${params.length}`);
    }
    if (filters.flagged !== undefined) {
      params.push(filters.flagged);
      clauses.push(`p.is_flagged = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(`SELECT count(*)::int AS n FROM products p ${where}`, params);
    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT p.id, p.name, p.variety, p.price, p.unit::text, p.stock_quantity,
              p.status::text, p.grade::text, p.is_flagged, p.created_at,
              p.state, p.district, cc.name AS category_name,
              pr.id AS farmer_id, pr.full_name AS farmer_name,
              fp.verification_status::text AS farmer_verification,
              (SELECT pi.storage_path FROM product_images pi
                WHERE pi.product_id = p.id AND pi.media_type = 'image'
                ORDER BY pi.sort_order LIMIT 1) AS primary_image
         FROM products p
         JOIN profiles pr ON pr.id = p.farmer_id
         LEFT JOIN farmer_profiles fp ON fp.user_id = p.farmer_id
         LEFT JOIN crop_categories cc ON cc.id = p.category_id
         ${where}
        ORDER BY p.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

/** Flag or clear a listing after a report. */
export async function setProductFlagged(
  productId: string,
  flagged: boolean,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const before = await q1<{ is_flagged: boolean; farmer_id: string; name: string }>(
      'SELECT is_flagged, farmer_id, name FROM products WHERE id = $1',
      [productId],
    );
    if (!before) throw new HttpError(404, 'That listing could not be found.', 'PRODUCT_NOT_FOUND');

    await q(
      `UPDATE products
          SET is_flagged = $1,
              status = CASE WHEN $1 THEN 'inactive'::product_status ELSE status END
        WHERE id = $2`,
      [flagged, productId],
    );

    if (flagged) {
      await notify(
        before.farmer_id,
        'system',
        `Your listing "${before.name}" has been taken down`,
        'An administrator reviewed a report about this listing. Contact support for details.',
        '/farmer/products',
      );
    }

    await audit({
      action: flagged ? 'admin.product_flag' : 'admin.product_unflag',
      entityType: 'product',
      entityId: productId,
      before: { is_flagged: before.is_flagged },
      after: { is_flagged: flagged },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

/** Review a farmer's request for verification. */
export async function decideFarmerVerification(
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const request = await q1<{ id: string; farmer_id: string; status: string }>(
      'SELECT id, farmer_id, status::text AS status FROM farmer_verification_requests WHERE id = $1',
      [requestId],
    );
    if (!request) throw new HttpError(404, 'That request could not be found.', 'REQUEST_NOT_FOUND');

    const newStatus = decision === 'approved' ? 'resolved' : 'dismissed';
    const verification = decision === 'approved' ? 'verified' : 'rejected';

    await q(
      `UPDATE farmer_verification_requests
          SET status = $1::report_status, reviewed_by = $2, reviewed_at = now(), review_note = $3
        WHERE id = $4`,
      [newStatus, await currentUserId(), note, requestId],
    );

    await q(
      `UPDATE farmer_profiles
          SET verification_status = $1::verification_status,
              verification_note = $2,
              verified_at = CASE WHEN $1 = 'verified' THEN now() ELSE NULL END
        WHERE user_id = $3`,
      [verification, note, request.farmer_id],
    );

    await notify(
      request.farmer_id,
      'verification',
      decision === 'approved' ? 'Your farm is now verified' : 'Verification was not approved',
      note ??
        (decision === 'approved'
          ? 'Customers will now see a verified badge on your listings.'
          : 'You can submit a new request with additional documents.'),
      '/farmer/profile',
    );

    await audit({
      action: `admin.farmer_verification_${decision}`,
      entityType: 'farmer_verification_request',
      entityId: requestId,
      before: { status: request.status },
      after: { status: newStatus, verification_status: verification, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export async function listVerificationRequests(
  p: Pagination,
  status?: string,
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (status) {
      params.push(status);
      clauses.push(`vr.status = $${params.length}::report_status`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(
      `SELECT count(*)::int AS n FROM farmer_verification_requests vr ${where}`,
      params,
    );
    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT vr.id, vr.farmer_id, vr.farm_name, vr.notes, vr.status::text,
              vr.id_document_path, vr.land_document_path, vr.review_note,
              vr.created_at, vr.reviewed_at,
              pr.full_name AS farmer_name, pr.email AS farmer_email,
              fp.state, fp.district, fp.village,
              fp.verification_status::text AS current_verification,
              rv.full_name AS reviewer_name
         FROM farmer_verification_requests vr
         JOIN profiles pr ON pr.id = vr.farmer_id
         LEFT JOIN farmer_profiles fp ON fp.user_id = vr.farmer_id
         LEFT JOIN profiles rv ON rv.id = vr.reviewed_by
         ${where}
        ORDER BY vr.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

/** Approve or reject a quality report. The trigger requires this context. */
export async function decideQualityReport(
  reportId: string,
  decision: 'verified' | 'rejected',
  note: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const report = await q1<{
      id: string; product_id: string | null; submitted_by: string; verification_status: string;
    }>(
      `SELECT id, product_id, submitted_by, verification_status::text AS verification_status
         FROM crop_quality_reports WHERE id = $1`,
      [reportId],
    );
    if (!report) throw new HttpError(404, 'That quality report could not be found.', 'REPORT_NOT_FOUND');

    await q(
      `UPDATE crop_quality_reports
          SET verification_status = $1::verification_status,
              report_type = CASE WHEN $1 = 'verified' THEN 'verified_inspection'::quality_report_type
                                 ELSE 'rejected'::quality_report_type END,
              reviewed_by = $2,
              reviewed_at = now(),
              review_note = $3
        WHERE id = $4`,
      [decision, await currentUserId(), note, reportId],
    );

    await notify(
      report.submitted_by,
      'quality',
      decision === 'verified'
        ? 'Your quality report was verified'
        : 'Your quality report was not verified',
      note ?? (decision === 'verified'
        ? 'It now shows as a verified inspection on your listing.'
        : 'You can submit a corrected report with supporting documents.'),
      '/farmer/quality-reports',
    );

    await audit({
      action: `admin.quality_report_${decision}`,
      entityType: 'crop_quality_report',
      entityId: reportId,
      before: { verification_status: report.verification_status },
      after: { verification_status: decision, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export async function listQualityReportsForReview(
  p: Pagination,
  status?: string,
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (status) {
      params.push(status);
      clauses.push(`qr.verification_status = $${params.length}::verification_status`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(
      `SELECT count(*)::int AS n FROM crop_quality_reports qr ${where}`,
      params,
    );
    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT qr.id, qr.product_id, qr.report_type::text, qr.title, qr.summary,
              qr.measurements, qr.report_document, qr.inspection_provider,
              qr.inspection_date, qr.inspector_name, qr.verification_status::text,
              qr.expiry_date, qr.review_note, qr.created_at,
              p.name AS product_name,
              pr.full_name AS submitted_by_name, pr.id AS submitted_by_id
         FROM crop_quality_reports qr
         LEFT JOIN products p ON p.id = qr.product_id
         JOIN profiles pr ON pr.id = qr.submitted_by
         ${where}
        ORDER BY CASE qr.verification_status WHEN 'pending' THEN 0 ELSE 1 END, qr.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

export async function listReports(
  p: Pagination,
  status?: string,
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (status) {
      params.push(status);
      clauses.push(`ur.status = $${params.length}::report_status`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(`SELECT count(*)::int AS n FROM user_reports ur ${where}`, params);
    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT ur.id, ur.target_type::text, ur.target_id, ur.reason, ur.details,
              ur.status::text, ur.resolution, ur.created_at, ur.reviewed_at,
              rp.full_name AS reporter_name, rp.id AS reporter_id,
              rv.full_name AS reviewer_name,
              CASE ur.target_type
                WHEN 'product' THEN (SELECT name FROM products WHERE id = ur.target_id)
                WHEN 'review'  THEN (SELECT left(coalesce(comment, '(no comment)'), 120) FROM reviews WHERE id = ur.target_id)
                WHEN 'user'    THEN (SELECT full_name FROM profiles WHERE id = ur.target_id)
                ELSE NULL
              END AS target_summary
         FROM user_reports ur
         JOIN profiles rp ON rp.id = ur.reporter_id
         LEFT JOIN profiles rv ON rv.id = ur.reviewed_by
         ${where}
        ORDER BY CASE ur.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
                 ur.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

export async function resolveReport(
  reportId: string,
  status: 'under_review' | 'resolved' | 'dismissed',
  resolution: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const before = await q1<{ status: string }>(
      'SELECT status::text AS status FROM user_reports WHERE id = $1',
      [reportId],
    );
    if (!before) throw new HttpError(404, 'That report could not be found.', 'REPORT_NOT_FOUND');

    await q(
      `UPDATE user_reports
          SET status = $1::report_status, resolution = $2,
              reviewed_by = $3, reviewed_at = now()
        WHERE id = $4`,
      [status, resolution, await currentUserId(), reportId],
    );

    await audit({
      action: 'admin.report_resolve',
      entityType: 'user_report',
      entityId: reportId,
      before: { status: before.status },
      after: { status, resolution },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export async function listAllOrders(
  p: Pagination,
  filters: { status?: string; paymentStatus?: string; search?: string } = {},
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filters.status) {
      params.push(filters.status);
      clauses.push(`o.order_status = $${params.length}::order_status`);
    }
    if (filters.paymentStatus) {
      params.push(filters.paymentStatus);
      clauses.push(`o.payment_status = $${params.length}::payment_status`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      clauses.push(
        `(o.order_number ILIKE $${params.length} OR cu.full_name ILIKE $${params.length} OR fu.full_name ILIKE $${params.length})`,
      );
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(
      `SELECT count(*)::int AS n FROM orders o
         JOIN profiles cu ON cu.id = o.customer_id
         JOIN profiles fu ON fu.id = o.farmer_id
       ${where}`,
      params,
    );
    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT o.id, o.order_number, o.total_amount, o.items_subtotal, o.delivery_charge,
              o.order_status::text, o.payment_status::text, o.fulfilment_method::text,
              o.created_at, o.delivered_at, o.cancelled_at, o.cancel_reason,
              cu.full_name AS customer_name, fu.full_name AS farmer_name,
              (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              (SELECT p.status::text FROM payments p
                WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS latest_payment_status,
              (SELECT p.provider::text FROM payments p
                WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS latest_payment_provider
         FROM orders o
         JOIN profiles cu ON cu.id = o.customer_id
         JOIN profiles fu ON fu.id = o.farmer_id
         ${where}
        ORDER BY o.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

export async function listAuditLogs(
  p: Pagination,
  filters: { action?: string; actorId?: string } = {},
): Promise<Page<Record<string, unknown>>> {
  return asVerifiedAdmin(async () => {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filters.action) {
      params.push(`%${filters.action}%`);
      clauses.push(`al.action ILIKE $${params.length}`);
    }
    if (filters.actorId) {
      params.push(filters.actorId);
      clauses.push(`al.actor_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = await count(`SELECT count(*)::int AS n FROM audit_logs al ${where}`, params);
    const limitIdx = params.push(p.pageSize);
    const offsetIdx = params.push(p.offset);

    const items = await q(
      `SELECT al.id, al.action, al.entity_type, al.entity_id,
              al.before_data, al.after_data, al.actor_role::text,
              al.ip_address::text, al.created_at,
              pr.full_name AS actor_name, pr.email AS actor_email
         FROM audit_logs al
         LEFT JOIN profiles pr ON pr.id = al.actor_id
         ${where}
        ORDER BY al.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return toPage(items, total, p);
  });
}

export async function listCategoriesForAdmin(): Promise<Array<Record<string, unknown>>> {
  return asVerifiedAdmin(async () =>
    q(
      `SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count
         FROM crop_categories c
        ORDER BY c.sort_order, c.name`,
    ),
  );
}

export async function upsertCategory(
  input: {
    id?: number;
    slug: string;
    name: string;
    localized_names?: Record<string, string>;
    description?: string | null;
    icon?: string | null;
    is_active?: boolean;
    sort_order?: number;
  },
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ id: number }> {
  return asVerifiedAdmin(async () => {
    if (input.id) {
      const updated = await q1<{ id: number }>(
        `UPDATE crop_categories
            SET slug = $1, name = $2, localized_names = $3::jsonb, description = $4,
                icon = $5, is_active = $6, sort_order = $7
          WHERE id = $8
          RETURNING id`,
        [
          input.slug, input.name, JSON.stringify(input.localized_names ?? {}),
          input.description ?? null, input.icon ?? null,
          input.is_active ?? true, input.sort_order ?? 100, input.id,
        ],
      );
      if (!updated) throw new HttpError(404, 'That category could not be found.', 'NOT_FOUND');

      await audit({
        action: 'admin.category_update',
        entityType: 'crop_category',
        entityId: String(input.id),
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return updated;
    }

    const created = await q1<{ id: number }>(
      `INSERT INTO crop_categories (slug, name, localized_names, description, icon, is_active, sort_order)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.slug, input.name, JSON.stringify(input.localized_names ?? {}),
        input.description ?? null, input.icon ?? null,
        input.is_active ?? true, input.sort_order ?? 100,
      ],
    );
    if (!created) throw new HttpError(500, 'The category could not be created.', 'CREATE_FAILED');

    await audit({
      action: 'admin.category_create',
      entityType: 'crop_category',
      entityId: String(created.id),
      after: input,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return created;
  });
}

export async function listAppSettings(): Promise<Array<Record<string, unknown>>> {
  return asVerifiedAdmin(async () =>
    q('SELECT key, value, description, updated_at FROM app_settings ORDER BY key'),
  );
}

export async function setAppSetting(
  key: string,
  value: unknown,
  description: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await asVerifiedAdmin(async () => {
    const before = await q1<{ value: unknown }>(
      'SELECT value FROM app_settings WHERE key = $1',
      [key],
    );

    await q(
      `INSERT INTO app_settings (key, value, description, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             description = COALESCE(EXCLUDED.description, app_settings.description),
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [key, JSON.stringify(value), description, await currentUserId()],
    );

    await audit({
      action: 'admin.setting_update',
      entityType: 'app_setting',
      entityId: key,
      before: before?.value ?? null,
      after: value,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

/** Platform-wide analytics for the admin dashboard charts. */
export async function adminAnalytics(days = 30): Promise<Record<string, unknown>> {
  return asVerifiedAdmin(async () => {
    const signups = await q(
      `SELECT date_trunc('day', created_at)::date AS day,
              count(*) FILTER (WHERE role = 'farmer')::int AS farmers,
              count(*) FILTER (WHERE role = 'customer')::int AS customers
         FROM profiles
        WHERE created_at >= CURRENT_DATE - $1::int
        GROUP BY 1 ORDER BY 1`,
      [days],
    );

    const orderVolume = await q(
      `SELECT date_trunc('day', created_at)::date AS day,
              count(*)::int AS orders,
              coalesce(sum(total_amount), 0) AS value
         FROM orders
        WHERE created_at >= CURRENT_DATE - $1::int
        GROUP BY 1 ORDER BY 1`,
      [days],
    );

    const topCrops = await q(
      `SELECT p.name,
              count(DISTINCT o.id)::int AS order_count,
              coalesce(sum(oi.quantity), 0) AS quantity_sold,
              coalesce(sum(oi.subtotal), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
        WHERE o.order_status <> 'cancelled'
        GROUP BY p.name
        ORDER BY revenue DESC
        LIMIT 10`,
    );

    const byState = await q(
      `SELECT fp.state,
              count(DISTINCT fp.user_id)::int AS farmers,
              count(DISTINCT p.id)::int AS listings
         FROM farmer_profiles fp
         LEFT JOIN products p ON p.farmer_id = fp.user_id AND p.status = 'active'
        GROUP BY fp.state
        ORDER BY farmers DESC
        LIMIT 15`,
    );

    return { signups, orderVolume, topCrops, byState };
  });
}
