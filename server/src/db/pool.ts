import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// pg returns NUMERIC as a string to avoid float precision loss. That is the
// right default, but it makes every money field arrive as "12.50" in JSON.
// Parse to a JS number only where the value is safely representable; keep
// strings for anything large. Money in this app stays well inside 2^53.
types.setTypeParser(types.builtins.NUMERIC, (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : value;
});
// BIGINT counters (count(*)) likewise.
types.setTypeParser(types.builtins.INT8, (value: string) => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
});
// DATE -> plain YYYY-MM-DD string. Prevents timezone drift turning a harvest
// date of 2026-03-01 into 2026-02-28 for a user west of UTC.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

// ---------------------------------------------------------------------------
// Two pools, two identities.
//   ownerPool — schema owner. Migrations and seed data only.
//   appPool   — rythu_web, NOBYPASSRLS. Every HTTP request.
// ---------------------------------------------------------------------------
export const ownerPool = new Pool({
  connectionString: config.databaseUrl,
  max: 4,
  idleTimeoutMillis: 30_000,
});

export const appPool = new Pool({
  connectionString: config.appDatabaseUrl,
  max: Number(process.env.APP_POOL_MAX ?? 12),
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  // A transaction that leaks its session context is worse than a failed
  // request, so cap how long an idle-in-transaction connection may sit.
  idle_in_transaction_session_timeout: 20_000,
});

appPool.on('error', (err) => {
  console.error('[db] idle client error', err.message);
});

// ---------------------------------------------------------------------------
// Request-scoped transaction context.
//
// Each HTTP request runs inside exactly one transaction on exactly one pooled
// connection. The verified identity is published to PostgreSQL with
// set_config(..., is_local => true), which means the values are discarded at
// COMMIT or ROLLBACK. A connection returned to the pool therefore carries no
// residue from the previous request.
// ---------------------------------------------------------------------------
export interface DbContext {
  userId: string | null;
  role: 'farmer' | 'customer' | 'admin' | null;
  /** Set only by privilegedBlock() after re-reading the role from the database. */
  privileged: boolean;
  /** 'register' | 'login' | 'reset' during pre-identity auth flows. */
  authContext: 'register' | 'login' | 'reset' | null;
  ip: string | null;
  userAgent: string | null;
}

const DEFAULT_CONTEXT: DbContext = {
  userId: null,
  role: null,
  privileged: false,
  authContext: null,
  ip: null,
  userAgent: null,
};

interface TxStore {
  client: pg.PoolClient;
  ctx: DbContext;
}

const txStorage = new AsyncLocalStorage<TxStore>();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The connection bound to the current request. Throws outside a request. */
export function currentClient(): pg.PoolClient {
  const store = txStorage.getStore();
  if (!store) {
    throw new Error(
      'No database context. All data access must run inside withTransaction().',
    );
  }
  return store.client;
}

export function currentContext(): DbContext {
  return txStorage.getStore()?.ctx ?? DEFAULT_CONTEXT;
}

/**
 * Run fn inside a transaction whose session variables describe the caller.
 *
 * Everything the request does — including nested service calls — shares this
 * one connection, so a multi-step checkout is atomic by construction.
 */
export async function withTransaction<T>(
  ctx: Partial<DbContext>,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const merged: DbContext = { ...DEFAULT_CONTEXT, ...ctx };
  const client = await appPool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('rythudirect.user_id', $1, true),
              set_config('rythudirect.role', $2, true),
              set_config('rythudirect.auth_context', $3, true),
              set_config('rythudirect.privileged', 'off', true)`,
      [merged.userId ?? '', merged.role ?? '', merged.authContext ?? ''],
    );

    const result = await txStorage.run({ client, ctx: merged }, () => fn(client));

    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is being discarded below anyway */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Elevate the current transaction to a privileged context.
 *
 * Call this only after re-reading the caller's role from the database inside
 * the same transaction. Never derive it from the JWT alone: a token issued
 * before a demotion would otherwise keep its authority until it expired.
 */
export async function privilegedBlock<T>(fn: () => Promise<T>): Promise<T> {
  const store = txStorage.getStore();
  if (!store) throw new Error('privilegedBlock() requires a transaction');
  await store.client.query(`SELECT set_config('rythudirect.privileged', 'on', true)`);
  try {
    return await fn();
  } finally {
    await store.client.query(`SELECT set_config('rythudirect.privileged', 'off', true)`);
  }
}

/**
 * Confirm the caller really is an administrator by reading their row, then
 * run fn with the privileged flag set. This is the only path to privileged
 * database work.
 */
export async function asVerifiedAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = currentContext();
  if (!ctx.userId) throw new HttpError(401, 'Authentication required');

  const { rows } = await currentClient().query<{ role: string; is_suspended: boolean }>(
    'SELECT role, is_suspended FROM profiles WHERE id = $1',
    [ctx.userId],
  );
  const row = rows[0];
  if (!row || row.role !== 'admin' || row.is_suspended) {
    throw new HttpError(403, 'Administrator privileges are required');
  }
  return privilegedBlock(fn);
}

/** Owner connection, for migrations and seeding. */
export async function withOwnerTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.allSettled([appPool.end(), ownerPool.end()]);
}

/** Alias used by the server shutdown path. */
export const closePool = closePools;

/**
 * Confirm the runtime role can actually reach the database.
 *
 * Runs as rythu_web, so a misconfigured role or a revoked grant shows up as a
 * failing health check rather than as a mystery 500 on the first request.
 */
export async function healthCheck(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const client = await appPool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true };
    } finally {
      client.release();
    }
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/**
 * Map a PostgreSQL error to an HTTP error.
 *
 * Only errors we deliberately raise are translated. Anything else becomes a
 * generic 500 so an unexpected database message cannot leak schema details.
 */
export function translateDbError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;

  const pgErr = err as { code?: string; message?: string; constraint?: string };
  const message = pgErr?.message ?? '';

  if (message.includes('INSUFFICIENT_STOCK')) {
    return new HttpError(409, 'Not enough stock is available for this product', 'INSUFFICIENT_STOCK');
  }
  if (message.includes('ILLEGAL_ORDER_TRANSITION')) {
    return new HttpError(409, 'That order status change is not allowed', 'ILLEGAL_ORDER_TRANSITION');
  }
  if (message.includes('UNVERIFIED_PAYMENT')) {
    return new HttpError(409, 'Payment cannot be marked settled without provider verification', 'UNVERIFIED_PAYMENT');
  }
  if (message.includes('role changes require')) {
    return new HttpError(403, 'You cannot change your own role', 'ROLE_ESCALATION_BLOCKED');
  }
  if (message.includes('suspension changes require')) {
    return new HttpError(403, 'Only an administrator can suspend an account', 'PRIVILEGE_REQUIRED');
  }
  if (message.includes('identity verification requires')) {
    return new HttpError(403, 'Only an administrator can change verification', 'PRIVILEGE_REQUIRED');
  }
  if (message.includes('official quality verification requires')) {
    return new HttpError(403, 'Only an authorized reviewer can verify a quality report', 'REVIEWER_REQUIRED');
  }
  if (message.includes('ORDER_ITEM_FARMER_MISMATCH')) {
    return new HttpError(400, 'All items in an order must come from one farmer', 'FARMER_MISMATCH');
  }
  if (message.includes('INVALID_QUANTITY')) {
    return new HttpError(400, 'Quantity must be greater than zero', 'INVALID_QUANTITY');
  }

  if (pgErr.code === '23505') {
    return new HttpError(409, 'That record already exists', 'DUPLICATE', pgErr.constraint);
  }
  if (pgErr.code === '23503') {
    return new HttpError(400, 'Referenced record does not exist', 'FK_VIOLATION');
  }
  if (pgErr.code === '23514') {
    return new HttpError(400, 'The submitted values failed a data integrity check', 'CHECK_VIOLATION');
  }
  if (pgErr.code === '22P02') {
    return new HttpError(400, 'A submitted value had the wrong format', 'INVALID_INPUT');
  }
  if (pgErr.code === '42501' || pgErr.code === '42P01') {
    // RLS denial surfaces as a permission error on the relation.
    return new HttpError(403, 'You are not permitted to perform that action', 'FORBIDDEN');
  }
  if (pgErr.code === '57014') {
    return new HttpError(504, 'The database took too long to answer', 'DB_TIMEOUT');
  }

  console.error('[db] unmapped error', err);
  return new HttpError(500, 'An unexpected server error occurred', 'INTERNAL');
}
