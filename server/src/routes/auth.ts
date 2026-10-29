import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { HttpError } from '../db/pool.js';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../lib/session.js';
import { attachSession, requireSession, withDb } from '../middleware/auth.js';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';
import { getQuery, validateBody, validateQuery } from '../middleware/validate.js';
import * as authService from '../services/auth.js';
import { q1 } from '../services/helpers.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerCustomerSchema,
  registerFarmerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './schemas.js';

export const authRouter = Router();

/**
 * Registration, login and reset run before a user identity exists, so they open
 * their transaction with an explicit auth context. That flag is what the RLS
 * policies test to permit the duplicate-email lookup and the INSERT.
 *
 * The context is set from a server-side constant, never from request data.
 */

authRouter.post(
  '/register/farmer',
  authLimiter,
  validateBody(registerFarmerSchema),
  withDb(
    async (req, res) => {
      const result = await authService.registerFarmer(req.body, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      // Registration does not sign the user in. They must confirm their email
      // first, which also keeps the flow honest about verification being real.
      res.status(201).json({
        message:
          'Your farmer account has been created. Check your email to confirm your address, then sign in.',
        user_id: result.userId,
        role: result.role,
        email_verification_required: true,
      });
    },
    { authContext: 'register' },
  ),
);

authRouter.post(
  '/register/customer',
  authLimiter,
  validateBody(registerCustomerSchema),
  withDb(
    async (req, res) => {
      const payload = {
        ...req.body,
        postal_code: req.body.postal_code || undefined,
      };
      const result = await authService.registerCustomer(payload, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(201).json({
        message:
          'Your account has been created. Check your email to confirm your address, then sign in.',
        user_id: result.userId,
        role: result.role,
        email_verification_required: true,
      });
    },
    { authContext: 'register' },
  ),
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  withDb(
    async (req, res) => {
      const { email, password, expected_role } = req.body as {
        email: string; password: string; expected_role?: 'farmer' | 'customer' | 'admin';
      };

      const result = await authService.login(email, password, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      // A farmer signing in at the customer door (or the reverse) is a real
      // mistake, not an attack. Say so plainly instead of dropping them into
      // the wrong dashboard or a generic "invalid credentials".
      if (expected_role && result.role !== expected_role) {
        const where = result.role === 'farmer' ? 'farmer' : result.role === 'admin' ? 'administrator' : 'customer';
        throw new HttpError(
          403,
          `This email belongs to a ${where} account. Use the ${where} sign-in page instead.`,
          'WRONG_ROLE',
          { email: `This is a ${where} account.` },
        );
      }

      const token = signSession({
        sub: result.userId,
        role: result.role,
        email: result.email,
      });
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions);

      res.json({
        user: {
          id: result.userId,
          role: result.role,
          full_name: result.fullName,
          email: result.email,
          preferred_language: result.preferredLanguage,
          email_verified: result.emailVerified,
          profile_photo: result.profilePhoto,
        },
      });
    },
    { authContext: 'login' },
  ),
);

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ message: 'You have been signed out.' });
});

/**
 * The current session, used on every page load to decide what to render.
 *
 * Reads the profile fresh rather than trusting the token, so a role change or a
 * suspension takes effect on the next request instead of at token expiry.
 */
authRouter.get(
  '/me',
  attachSession,
  withDb(
    async (req, res) => {
      if (!req.session) {
        res.status(401).json({ error: { message: 'Not signed in.', code: 'AUTH_REQUIRED' } });
        return;
      }

      const profile = await q1<Record<string, unknown>>(
        `SELECT id, full_name, email, phone, role::text, preferred_language::text,
                profile_photo, email_verified, phone_verified, identity_verified,
                is_suspended, created_at
           FROM profiles WHERE id = $1`,
        [req.session.sub],
      );

      if (!profile) {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        res.status(401).json({ error: { message: 'Your account no longer exists.', code: 'ACCOUNT_MISSING' } });
        return;
      }

      if (profile.is_suspended) {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        res.status(403).json({
          error: {
            message: 'This account has been suspended. Please contact support.',
            code: 'ACCOUNT_SUSPENDED',
          },
        });
        return;
      }

      let farmerProfile: Record<string, unknown> | null = null;
      if (profile.role === 'farmer') {
        farmerProfile = await q1<Record<string, unknown>>(
          `SELECT farm_name, state, district, village, public_address, latitude, longitude,
                  location_public, farming_type, crops_cultivated, bio,
                  offers_delivery, offers_pickup, verification_status::text,
                  rating_avg, rating_count
             FROM farmer_profiles WHERE user_id = $1`,
          [req.session.sub],
        );
      }

      res.json({ user: profile, farmer_profile: farmerProfile });
  }),
);

authRouter.post(
  '/verify-email',
  validateBody(verifyEmailSchema),
  withDb(
    async (req, res) => {
      await authService.verifyEmail((req.body as { token: string }).token);
      res.json({ message: 'Your email address is confirmed. You can sign in now.' });
    },
    { authContext: 'reset' },
  ),
);

authRouter.post(
  '/resend-verification',
  authLimiter,
  attachSession,
  withDb(
    async (req, res) => {
      if (!req.session) {
        throw new HttpError(401, 'Please sign in first.', 'AUTH_REQUIRED');
      }
      await authService.resendVerification(req.session.sub);
      res.json({
        message: config.mail.host
          ? 'A new confirmation email has been sent.'
          : 'Email delivery is not configured on this deployment. Check the server log for your confirmation link.',
      });
  }),
);

authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validateBody(forgotPasswordSchema),
  withDb(
    async (req, res) => {
      const result = await authService.requestPasswordReset(
        (req.body as { email: string }).email,
      );

      // The response is identical whether or not the address exists. Saying
      // "no account with that email" would turn this into an enumeration tool.
      res.json({
        message:
          'If an account exists for that email address, a reset link has been sent.',
      });

      if (result.token) {
        console.log(
          `[auth] password reset requested for ${(req.body as { email: string }).email}`,
        );
      }
    },
    { authContext: 'reset' },
  ),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validateBody(resetPasswordSchema),
  withDb(
    async (req, res) => {
      const { token, password } = req.body as { token: string; password: string };
      await authService.resetPassword(token, password);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({
        message: 'Your password has been changed. Sign in with your new password.',
      });
    },
    { authContext: 'reset' },
  ),
);

authRouter.post(
  '/change-password',
  requireSession,
  validateBody(changePasswordSchema),
  withDb(
    async (req, res) => {
      const { current_password, new_password } = req.body as {
        current_password: string; new_password: string;
      };
      await authService.changePassword(req.session!.sub, current_password, new_password);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ message: 'Your password has been changed. Please sign in again.' });
    },
    { authContext: 'reset' },
  ),
);

authRouter.patch(
  '/profile',
  requireSession,
  validateBody(updateProfileSchema),
  withDb(
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const sets: string[] = [];
      const params: unknown[] = [];

      // Only these four columns, and the RLS policy plus the guard trigger make
      // role and suspension unwritable from here even if a column name leaked in.
      for (const column of ['full_name', 'phone', 'preferred_language', 'profile_photo']) {
        if (column in body) {
          params.push(body[column]);
          sets.push(`${column} = $${params.length}`);
        }
      }
      if (sets.length === 0) {
        throw new HttpError(400, 'Nothing to update.', 'NOTHING_TO_UPDATE');
      }

      params.push(req.session!.sub);
      await q1(
        `UPDATE profiles SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
        params,
      );

      const updated = await q1(
        `SELECT id, full_name, email, phone, role::text, preferred_language::text, profile_photo
           FROM profiles WHERE id = $1`,
        [req.session!.sub],
      );
      res.json({ user: updated });
  }),
);

/** Language preference, saved from the header switcher and account settings. */
authRouter.put(
  '/language',
  requireSession,
  withDb(
    async (req, res) => {
      const language = (req.body as { language?: string }).language;
      if (!['en', 'te', 'hi'].includes(language ?? '')) {
        throw new HttpError(400, 'That language is not supported yet.', 'UNSUPPORTED_LANGUAGE');
      }
      await q1('UPDATE profiles SET preferred_language = $1::language_code WHERE id = $2 RETURNING id', [
        language,
        req.session!.sub,
      ]);
      res.json({ preferred_language: language });
  }),
);

/** Consent records for the privacy page. */
authRouter.get(
  '/consents',
  requireSession,
  withDb(
    async (req, res) => {
      const rows = await q1<{ rows: unknown }>(
        `SELECT json_agg(row_to_json(c)) AS rows FROM (
           SELECT consent_type, version, granted, created_at
             FROM user_consents WHERE user_id = $1 ORDER BY created_at DESC
         ) c`,
        [req.session!.sub],
      );
      res.json({ consents: (rows?.rows as unknown[]) ?? [] });
  }),
);

export const authQueryHelpers = { validateQuery, getQuery };
