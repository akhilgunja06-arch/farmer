import { Router } from 'express';
import { requireRole, requireSession, withDb } from '../middleware/auth.js';
import { generalLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { paginate } from '../services/helpers.js';
import * as admin from '../services/admin.js';
import * as market from '../services/market.js';
import * as reviews from '../services/reviews.js';
import {
  appSettingSchema,
  categorySchema,
  productFlagSchema,
  qualityDecisionSchema,
  reportResolutionSchema,
  setRoleSchema,
  suspendUserSchema,
  verificationDecisionSchema,
} from './schemas.js';

export const adminRouter = Router();

/**
 * Everything below requires the admin role.
 *
 * requireRole rejects a token whose role claim is not admin, and every service
 * function then calls asVerifiedAdmin(), which re-reads the role from the
 * database and sets the privileged flag. Changing a URL or editing frontend
 * state therefore achieves nothing: the database refuses the operation.
 */
adminRouter.use(requireSession, requireRole('admin'));

adminRouter.get(
  '/overview',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json(await admin.adminOverview());
  }),
);

adminRouter.get(
  '/analytics',
  generalLimiter,
  withDb(async (req, res) => {
    const days = Number((req.query as { days?: string }).days ?? 30);
    res.json(await admin.adminAnalytics(Math.min(365, Math.max(1, days))));
  }),
);

// --- Users -----------------------------------------------------------------

adminRouter.get(
  '/users',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listUsers(paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)), {
      role: query.role,
      search: query.search,
      suspended: query.suspended === undefined ? undefined : query.suspended === 'true',
    });
    res.json(page);
  }),
);

adminRouter.get(
  '/users/:id',
  generalLimiter,
  withDb(async (req, res) => {
    res.json(await admin.getUserDetail(req.params.id!));
  }),
);

adminRouter.put(
  '/users/:id/suspension',
  writeLimiter,
  validateBody(suspendUserSchema),
  withDb(async (req, res) => {
    const body = req.body as { suspended: boolean; reason?: string | null };
    await admin.setUserSuspended(req.params.id!, body.suspended, body.reason ?? null, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({
      message: body.suspended ? 'Account suspended.' : 'Account reinstated.',
    });
  }),
);

adminRouter.put(
  '/users/:id/role',
  writeLimiter,
  validateBody(setRoleSchema),
  withDb(async (req, res) => {
    const { role } = req.body as { role: 'farmer' | 'customer' | 'admin' };
    await admin.setUserRole(req.params.id!, role, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: `Role changed to ${role}.` });
  }),
);

// --- Products --------------------------------------------------------------

adminRouter.get(
  '/products',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listAllProducts(
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
      {
        status: query.status,
        search: query.search,
        flagged: query.flagged === undefined ? undefined : query.flagged === 'true',
      },
    );
    res.json(page);
  }),
);

adminRouter.put(
  '/products/:id/flag',
  writeLimiter,
  validateBody(productFlagSchema),
  withDb(async (req, res) => {
    const { flagged } = req.body as { flagged: boolean };
    await admin.setProductFlagged(req.params.id!, flagged, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: flagged ? 'Listing taken down.' : 'Listing restored.' });
  }),
);

// --- Orders ----------------------------------------------------------------

adminRouter.get(
  '/orders',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listAllOrders(
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
      {
        status: query.status,
        paymentStatus: query.payment_status,
        search: query.search,
      },
    );
    res.json(page);
  }),
);

// --- Farmer verification ---------------------------------------------------

adminRouter.get(
  '/verification-requests',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listVerificationRequests(
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
      query.status,
    );
    res.json(page);
  }),
);

adminRouter.put(
  '/verification-requests/:id',
  writeLimiter,
  validateBody(verificationDecisionSchema),
  withDb(async (req, res) => {
    const body = req.body as { decision: 'approved' | 'rejected'; note?: string | null };
    await admin.decideFarmerVerification(req.params.id!, body.decision, body.note ?? null, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: `Verification ${body.decision}.` });
  }),
);

// --- Quality reports -------------------------------------------------------

adminRouter.get(
  '/quality-reports',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listQualityReportsForReview(
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
      query.status,
    );
    res.json(page);
  }),
);

adminRouter.put(
  '/quality-reports/:id',
  writeLimiter,
  validateBody(qualityDecisionSchema),
  withDb(async (req, res) => {
    const body = req.body as { decision: 'verified' | 'rejected'; note?: string | null };
    await admin.decideQualityReport(req.params.id!, body.decision, body.note ?? null, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: `Quality report ${body.decision}.` });
  }),
);

// --- Reports ---------------------------------------------------------------

adminRouter.get(
  '/reports',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listReports(
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 20)),
      query.status,
    );
    res.json(page);
  }),
);

adminRouter.put(
  '/reports/:id',
  writeLimiter,
  validateBody(reportResolutionSchema),
  withDb(async (req, res) => {
    const body = req.body as {
      status: 'under_review' | 'resolved' | 'dismissed';
      resolution?: string | null;
    };
    await admin.resolveReport(req.params.id!, body.status, body.resolution ?? null, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: 'Report updated.' });
  }),
);

// --- Review moderation -----------------------------------------------------

adminRouter.put(
  '/reviews/:id/moderation',
  writeLimiter,
  withDb(async (req, res) => {
    const body = req.body as { hide?: boolean; note?: string | null };
    await reviews.moderateReview(
      req.session!.sub,
      req.params.id!,
      body.hide !== false,
      body.note ?? null,
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
    res.json({ message: body.hide === false ? 'Review restored.' : 'Review hidden.' });
  }),
);

// --- Categories ------------------------------------------------------------

adminRouter.get(
  '/categories',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({ categories: await admin.listCategoriesForAdmin() });
  }),
);

adminRouter.put(
  '/categories',
  writeLimiter,
  validateBody(categorySchema),
  withDb(async (req, res) => {
    const result = await admin.upsertCategory(req.body as never, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ id: result.id, message: 'Category saved.' });
  }),
);

// --- Market data -----------------------------------------------------------

adminRouter.get(
  '/market-observations',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({ commodities: await market.listObservedCommodities() });
  }),
);

// --- Settings and audit ----------------------------------------------------

adminRouter.get(
  '/settings',
  generalLimiter,
  withDb(async (_req, res) => {
    res.json({
      settings: await admin.listAppSettings(),
      integrations: await market.integrationStatus(),
    });
  }),
);

adminRouter.put(
  '/settings',
  writeLimiter,
  validateBody(appSettingSchema),
  withDb(async (req, res) => {
    const body = req.body as { key: string; value: unknown; description?: string | null };
    await admin.setAppSetting(body.key, body.value, body.description ?? null, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.json({ message: 'Setting saved.' });
  }),
);

adminRouter.get(
  '/audit-logs',
  generalLimiter,
  withDb(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const page = await admin.listAuditLogs(
      paginate(Number(query.page ?? 1), Number(query.page_size ?? 50)),
      { action: query.action, actorId: query.actor_id },
    );
    res.json(page);
  }),
);
