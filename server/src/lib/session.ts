import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../db/pool.js';

export interface SessionClaims {
  sub: string;
  role: 'farmer' | 'customer' | 'admin';
  email: string;
}

/**
 * Issue a session token.
 *
 * The token carries the user id and role. The role is a *hint* for routing and
 * UI only — every privileged operation re-reads the role from the database, so
 * a token issued before a demotion cannot be used to keep elevated access.
 */
export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.sessionTtlSeconds,
    issuer: 'rythudirect',
    audience: 'rythudirect-web',
  });
}

/**
 * Verify a session token.
 *
 * `algorithms` is pinned to HS256. Without that, a token with `alg: none` — or
 * an RS256 token signed with the public key — could be accepted.
 */
export function verifySession(token: string): SessionClaims {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'rythudirect',
      audience: 'rythudirect-web',
    });
    if (typeof decoded === 'string') throw new Error('unexpected payload');

    const { sub, role, email } = decoded as jwt.JwtPayload & Partial<SessionClaims>;
    if (!sub || !role) throw new Error('incomplete payload');

    return { sub, role, email: email ?? '' };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TokenExpiredError') {
      throw new HttpError(401, 'Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
    }
    throw new HttpError(401, 'Your session is not valid. Please sign in again.', 'INVALID_SESSION');
  }
}

export const SESSION_COOKIE = 'rd_session';

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  // Secure requires HTTPS. In development over http:// a Secure cookie is
  // silently dropped by the browser, which would look like a login failure.
  secure: config.isProduction,
  path: '/',
  maxAge: config.sessionTtlSeconds * 1000,
};
