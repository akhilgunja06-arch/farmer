import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limiters.
 *
 * `keyGenerator` uses req.ip. The app is deployed behind a reverse proxy that
 * terminates TLS, so `trust proxy` is configured in index.ts; without that,
 * every request would appear to come from the proxy and one noisy client would
 * exhaust the budget for everyone.
 *
 * Limits are disabled under NODE_ENV=test so the integration suite can drive
 * flows like repeated logins without tripping them. The middleware is still
 * mounted, so the code path is exercised.
 *
 * RATE_LIMIT_DISABLED=true does the same thing for a development server driven
 * by the end-to-end script, which signs in and out many times in a minute and
 * would otherwise exhaust the deliberately tight auth budget. It is refused
 * outright in production so it can never be used to remove the protection from
 * a real deployment.
 */
function disabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.RATE_LIMIT_DISABLED === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'RATE_LIMIT_DISABLED cannot be set when NODE_ENV=production. Rate limiting is a security control.',
      );
    }
    return true;
  }
  return false;
}

function make(options: Parameters<typeof rateLimit>[0]): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: disabled,
    ...options,
  });
}

/** Broad ceiling for everything under /api. */
export const generalLimiter = make({
  windowMs: 60_000,
  limit: 300,
  message: { error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } },
});

/**
 * Login and registration.
 *
 * Tight, because these are the endpoints worth brute-forcing. Successful
 * requests are not counted, so a legitimate user signing in repeatedly is
 * unaffected while a password-guessing script is stopped quickly.
 */
export const authLimiter = make({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: {
    error: {
      message: 'Too many attempts. Please wait a few minutes and try again.',
      code: 'RATE_LIMITED',
    },
  },
});

/** Password reset requests, keyed by the email being targeted. */
export const passwordResetLimiter = make({
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: string } | undefined)?.email;
    return email ? `reset:${email.toLowerCase()}` : `reset-ip:${req.ip}`;
  },
  message: {
    error: {
      message: 'Too many reset requests for this address. Please try again later.',
      code: 'RATE_LIMITED',
    },
  },
});

/** File uploads. Expensive to process, so kept modest. */
export const uploadLimiter = make({
  windowMs: 10 * 60_000,
  limit: 60,
  message: {
    error: { message: 'Too many uploads. Please wait a moment.', code: 'RATE_LIMITED' },
  },
});

/** Writes that create records (orders, reviews, reports). */
export const writeLimiter = make({
  windowMs: 60_000,
  limit: 40,
  message: {
    error: {
      message: 'Too many submissions in a short time. Please wait a moment.',
      code: 'RATE_LIMITED',
    },
  },
});

