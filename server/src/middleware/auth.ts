import type { NextFunction, Request, Response } from 'express';
import { HttpError, translateDbError, withTransaction, type DbContext } from '../db/pool.js';
import { SESSION_COOKIE, verifySession, type SessionClaims } from '../lib/session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionClaims;
    }
  }
}

function readToken(req: Request): string | null {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();

  return null;
}

/**
 * Attach a session when a valid token is present. Never rejects.
 *
 * Used on endpoints that behave differently for signed-in users but are open
 * to everyone — the public catalogue, a product page, the landing page counts.
 */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (token) {
    try {
      req.session = verifySession(token);
    } catch {
      // An expired or tampered token on a public route is treated as anonymous
      // rather than an error, so a stale tab does not break the catalogue.
      req.session = undefined;
    }
  }
  next();
}

/** Reject the request unless a valid session is present. */
export function requireSession(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session) {
    next(new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED'));
    return;
  }
  next();
}

/**
 * Restrict a route to specific roles.
 *
 * The role in the token is compared against the route's allow-list. This is the
 * first of two checks: privileged handlers additionally re-read the role from
 * the database, so a demoted administrator's existing token stops working.
 */
export function requireRole(...roles: Array<'farmer' | 'customer' | 'admin'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session) {
      next(new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED'));
      return;
    }
    if (!roles.includes(req.session.role)) {
      next(new HttpError(403, 'Your account does not have access to this area.', 'FORBIDDEN_ROLE'));
      return;
    }
    next();
  };
}

/**
 * Wrap a handler in a database transaction whose session context describes the
 * caller. Everything the handler does shares one connection, which is what
 * makes a multi-step checkout atomic.
 */
export function withDb(
  handler: (req: Request, res: Response) => Promise<void>,
  options: { authContext?: DbContext['authContext'] } = {},
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx: Partial<DbContext> = {
        userId: req.session?.sub ?? null,
        role: req.session?.role ?? null,
        authContext: options.authContext ?? null,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      };
      await withTransaction(ctx, async () => {
        await handler(req, res);
      });
    } catch (err) {
      next(translateDbError(err));
    }
  };
}

/**
 * Re-read the caller's role and suspension state from the database.
 *
 * Called at the start of every authenticated request that touches protected
 * data. The JWT is a claim about the past; this is the present.
 */
export async function assertAccountActive(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ role: string; is_suspended: boolean }> }>,
  userId: string,
): Promise<{ role: 'farmer' | 'customer' | 'admin' }> {
  const { rows } = await query(
    'SELECT role, is_suspended FROM profiles WHERE id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(401, 'Your account could not be found.', 'ACCOUNT_MISSING');
  if (row.is_suspended) {
    throw new HttpError(403, 'This account has been suspended. Contact support for help.', 'ACCOUNT_SUSPENDED');
  }
  return { role: row.role as 'farmer' | 'customer' | 'admin' };
}
