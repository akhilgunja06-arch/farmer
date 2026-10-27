/**
 * Integration test entrypoint.
 *
 * `npm test` runs the acceptance suite in scripts/e2e.sh: it starts its own API
 * on a free port with rate limiting switched off, drives the full journey as a
 * real farmer, customer and administrator over HTTP with real session cookies,
 * and asserts on outcomes — was the over-stock order refused, can a customer
 * reach an admin route, does a fabricated payment confirmation get rejected.
 *
 * The suite manages its own server lifecycle, so there is nothing to bootstrap
 * here beyond passing the exit code through to the caller.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'e2e.sh');

const child = spawn('bash', [script], {
  cwd: join(here, '..', '..'),
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('Could not start the test suite:', err.message);
  process.exit(1);
});
