/**
 * Drop the entire schema and rebuild it from the migration files.
 *
 * Development convenience. Refuses to run when NODE_ENV=production unless
 * ALLOW_DB_RESET=yes is set explicitly.
 */
import { runMigrations } from './migrate.js';
import { closePools } from './pool.js';

try {
  const result = await runMigrations({ recreate: true });
  console.log(
    `Schema rebuilt. ${result.applied.length} migration(s) applied: ${result.applied.join(', ')}`,
  );
} catch (err) {
  console.error('Reset failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePools();
}
