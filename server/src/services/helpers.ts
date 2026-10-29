import { currentClient } from '../db/pool.js';

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function paginate(page: number, pageSize: number): Pagination {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export function toPage<T>(items: T[], total: number, p: Pagination): Page<T> {
  // snake_case, matching the query parameters callers send (`page_size`) and
  // the shape the hand-written paginated routes already return. Two spellings
  // for the same envelope was a bug waiting to happen.
  return {
    items,
    page: p.page,
    page_size: p.pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

/**
 * Run a query on the request's connection.
 *
 * Every data access goes through here, which is what guarantees it happens
 * inside the transaction that carries the caller's RLS context. A service that
 * reached for a pool directly would run with no identity set and see nothing.
 */
export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await currentClient().query(sql, params as never[]);
  return result.rows as T[];
}

export async function q1<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const row = await q1<{ n: number }>(sql, params);
  return row?.n ?? 0;
}

/**
 * Send a notification to another user.
 *
 * Goes through the SECURITY DEFINER function because RLS on `notifications`
 * limits inserts to the caller's own rows, and most notifications are for
 * somebody else.
 */
export async function notify(
  userId: string,
  kind: 'order' | 'message' | 'review' | 'quality' | 'verification' | 'system' | 'payment',
  title: string,
  body?: string,
  link?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await q('SELECT notify_user($1, $2, $3, $4, $5, $6::jsonb)', [
    userId,
    kind,
    title,
    body ?? null,
    link ?? null,
    JSON.stringify(metadata),
  ]);
}

/**
 * Append to the audit log.
 *
 * `actor_id` and `actor_role` are taken from the session context inside the
 * database function, not from arguments, so a caller cannot attribute an
 * action to somebody else.
 */
export async function audit(params: {
  action: string;
  entityType?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await q('SELECT write_audit_log($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)', [
    params.action,
    params.entityType ?? null,
    params.entityId ?? null,
    params.before === undefined ? null : JSON.stringify(params.before),
    params.after === undefined ? null : JSON.stringify(params.after),
    params.ip ?? null,
    params.userAgent ?? null,
  ]);
}

/** Today in IST, as YYYY-MM-DD. Market data and harvest dates are IST-local. */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Great-circle distance in kilometres.
 *
 * Used to order farmers and products by proximity. Haversine is accurate enough
 * for "who is near me" and needs no external service, so distance sorting works
 * even when the Maps integration is not configured.
 */
export function haversineKm(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}

/** Normalise a search term for a case-insensitive LIKE. */
export function likeTerm(term: string): string {
  // Escape the LIKE metacharacters so a user typing "%" searches for a percent
  // sign rather than matching every row.
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
