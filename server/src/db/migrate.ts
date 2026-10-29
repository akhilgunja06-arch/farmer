import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePools, withOwnerTransaction } from './pool.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function ensureLedger(): Promise<void> {
  await withOwnerTransaction(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        duration_ms INTEGER
      )
    `);
  });
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  recreated: boolean;
}

export async function runMigrations({ recreate = false } = {}): Promise<MigrationResult> {
  if (recreate) {
    // Drops and rebuilds the whole schema. Development convenience only; the
    // guard below stops it from ever running against production.
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RESET !== 'yes') {
      throw new Error(
        'Refusing to drop the schema with NODE_ENV=production. ' +
          'Set ALLOW_DB_RESET=yes if you really mean it.',
      );
    }
    await withOwnerTransaction(async (client) => {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    });
  }

  await ensureLedger();

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const sum = checksum(sql);

    const existing = await withOwnerTransaction(async (client) =>
      client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [file],
      ),
    );

    if (existing.rows.length > 0) {
      const recorded = existing.rows[0];
      if (!recorded) throw new Error(`Migration ledger row for ${file} is unreadable.`);
      if (recorded.checksum !== sum) {
        throw new Error(
          `Migration ${file} has changed since it was applied ` +
            `(recorded ${recorded.checksum}, found ${sum}). ` +
            `Add a new migration instead of editing an applied one, ` +
            `or run \`npm run db:reset\` to rebuild from scratch.`,
        );
      }
      skipped.push(file);
      continue;
    }

    const startedAt = Date.now();
    await withOwnerTransaction(async (client) => {
      // Each migration file is one transaction: a syntax error leaves the
      // database exactly as it was, with no half-applied schema.
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (name, checksum, duration_ms)
         VALUES ($1, $2, $3)`,
        [file, sum, Date.now() - startedAt],
      );
    });

    applied.push(file);
    console.log(`  applied ${file} (${Date.now() - startedAt}ms)`);
  }

  return { applied, skipped, recreated: recreate };
}

// Allow `npm run db:migrate` and `npm run db:reset`.
const invokedDirectly = process.argv[1]?.includes('migrate');
if (invokedDirectly) {
  const recreate = process.argv.includes('--recreate');
  runMigrations({ recreate })
    .then((result) => {
      if (result.applied.length === 0) {
        console.log('Database is up to date. No migrations to apply.');
      } else {
        console.log(`Applied ${result.applied.length} migration(s).`);
      }
      return closePools();
    })
    .catch(async (err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
      await closePools();
      process.exit(1);
    });
}

export { closePools };
