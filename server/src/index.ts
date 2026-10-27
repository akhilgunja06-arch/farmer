import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, capabilities, describeMissingIntegrations, repoRoot } from './config.js';
import { closePool, healthCheck } from './db/pool.js';
import { attachSession } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { addressesRouter, cartRouter, savedRouter } from './routes/cart.js';
import { countersRouter, filesRouter, notificationsRouter } from './routes/files.js';
import {
  dashboardRouter,
  farmerProfileRouter,
  farmersRouter,
} from './routes/farmers.js';
import { marketRouter } from './routes/market.js';
import { messagesRouter } from './routes/messages.js';
import { ordersRouter, paymentsRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import { qualityRouter, reportsRouter, reviewsRouter } from './routes/reviews.js';
import { webhookRouter } from './routes/webhooks.js';

export function createApp(): Express {
  const app = express();

  // Behind a TLS-terminating proxy. Without this, req.ip is the proxy address
  // and every rate limiter would share a single bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // Set per-response where it matters; see files.ts.
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  // Credentials are cookie-based, so the origin list must be explicit. A
  // wildcard origin with credentials is rejected by browsers anyway, and
  // allowing one would let any site drive the API with the user's session.
  app.use(
    cors({
      origin: [config.appUrl, `http://localhost:${config.port}`],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(cookieParser());
  app.use(generalLimiter);

  // The webhook router is mounted before express.json(), because Razorpay's
  // signature is computed over the raw body. Parsing it first would consume the
  // stream and make verification impossible.
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Multipart uploads are buffered in memory and capped at 50 MB. The service
  // layer enforces the real per-kind limits; this is the outer backstop so a
  // huge request cannot exhaust memory before reaching it.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });

  // Applied only to the routes that accept files, so a normal JSON request is
  // never put through multipart parsing.
  app.use(['/api/products', '/api/farmer/profile', '/api/reviews'], upload.single('file'));

  app.use(attachSession);

  app.get('/api/health', async (_req, res) => {
    const db = await healthCheck();
    res.status(db.ok ? 200 : 503).json({
      status: db.ok ? 'ok' : 'degraded',
      database: db.ok ? 'connected' : 'unreachable',
      integrations: capabilities,
      missing_integrations: describeMissingIntegrations(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/farmers', farmersRouter);
  app.use('/api/farmer/profile', farmerProfileRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/saved', savedRouter);
  app.use('/api/addresses', addressesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/quality', qualityRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/market', marketRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/counters', countersRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', notFoundHandler);

  // In production the built client is served from here, so the deployment is a
  // single process. The SPA fallback returns index.html for any non-API path,
  // which is what makes a deep link like /farmer/products/abc work on reload.
  const clientDist = join(repoRoot, 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`RythuDirect API listening on http://localhost:${config.port}`);
    console.log(`  environment:  ${config.nodeEnv}`);
    console.log(`  client url:   ${config.appUrl}`);
    console.log(`  database:     ${redactConnectionString(config.databaseUrl)}`);

    const missing = describeMissingIntegrations();
    if (missing.length > 0) {
      console.log('\nIntegrations awaiting configuration:');
      for (const item of missing) console.log(`  - ${item}`);
      console.log('\nSee INTEGRATION_SETUP.md for how to enable each one.');
    } else {
      console.log('\nAll optional integrations are configured.');
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // If connections do not drain, stop anyway rather than hanging.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/** Strip the password from a connection string before logging it. */
function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '(unparseable connection string)';
  }
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}
