import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
// config.ts lives at server/src/, so the repository root is two levels up.
export const repoRoot = resolve(here, '../..');

for (const candidate of [
  resolve(repoRoot, '.env'),
  resolve(repoRoot, 'server/.env'),
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(optional('PORT', '12001')),

  // Owner role: migrations and seed only.
  databaseUrl: required('DATABASE_URL'),
  // Runtime role: NOBYPASSRLS, so row level security always applies.
  appDatabaseUrl: required('APP_DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  sessionTtlSeconds: Number(optional('SESSION_TTL_SECONDS', String(60 * 60 * 24 * 7))),

  appUrl: optional('APP_URL', 'http://localhost:12000'),
  apiUrl: optional('API_URL', 'http://localhost:12001'),

  storageDir: resolve(repoRoot, optional('STORAGE_DIR', 'server/storage')),
  maxUploadBytes: Number(optional('MAX_UPLOAD_BYTES', String(8 * 1024 * 1024))),

  mail: {
    host: optional('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '587')),
    secure: optional('SMTP_SECURE', 'false') === 'true',
    user: optional('SMTP_USER'),
    password: optional('SMTP_PASSWORD'),
    from: optional('MAIL_FROM', 'RythuDirect <no-reply@example.com>'),
  },

  maps: {
    browserKey: optional('VITE_GOOGLE_MAPS_API_KEY'),
  },

  razorpay: {
    keyId: optional('RAZORPAY_KEY_ID'),
    keySecret: optional('RAZORPAY_KEY_SECRET'),
    webhookSecret: optional('RAZORPAY_WEBHOOK_SECRET'),
  },

  aiVision: {
    enabled: optional('AI_VISION_ENABLED', 'false') === 'true',
    apiKey: optional('AI_VISION_API_KEY'),
    model: optional('AI_VISION_MODEL', 'gpt-4o-mini'),
  },

  sms: {
    provider: optional('SMS_PROVIDER'),
    apiKey: optional('SMS_API_KEY'),
    senderId: optional('SMS_SENDER_ID'),
  },

  agmarknet: {
    apiKey: optional('AGMARKNET_API_KEY'),
    apiUrl: optional('AGMARKNET_API_URL'),
  },
} as const;

// Derived capability flags. The API exposes these so the UI can render an
// honest "not configured" state instead of a broken button.
export const capabilities = {
  email: Boolean(config.mail.host),
  maps: Boolean(config.maps.browserKey),
  payments: Boolean(config.razorpay.keyId && config.razorpay.keySecret),
  paymentsWebhook: Boolean(config.razorpay.webhookSecret),
  aiVision: Boolean(config.aiVision.enabled && config.aiVision.apiKey),
  sms: Boolean(config.sms.provider && config.sms.apiKey),
  marketData: Boolean(config.agmarknet.apiUrl),
} as const;

export type Capabilities = typeof capabilities;

if (config.databaseUrl === config.appDatabaseUrl) {
  throw new Error(
    'DATABASE_URL and APP_DATABASE_URL must be different roles. ' +
      'The runtime role must not own the tables, otherwise row level security ' +
      'is silently bypassed.',
  );
}

export function readSecretFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Human-readable list of integrations that need credentials.
 *
 * Printed at startup and returned by /api/health, so an operator can see what
 * is missing without reading the source. Each entry names the exact variables
 * to set.
 */
export function describeMissingIntegrations(): string[] {
  const missing: string[] = [];

  if (!capabilities.email) {
    missing.push(
      'Email (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM) — ' +
        'verification and password reset links are written to the server log instead.',
    );
  }
  if (!capabilities.maps) {
    missing.push(
      'Maps (VITE_GOOGLE_MAPS_API_KEY) — location discovery uses list search; ' +
        'the interactive map is hidden.',
    );
  }
  if (!capabilities.payments) {
    missing.push(
      'Payments (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) — checkout offers cash on delivery only.',
    );
  } else if (!capabilities.paymentsWebhook) {
    missing.push(
      'Payment webhooks (RAZORPAY_WEBHOOK_SECRET) — payments work, but a payment whose ' +
        'browser callback is lost will not reconcile automatically.',
    );
  }
  if (!capabilities.aiVision) {
    missing.push(
      'AI image assessment (AI_VISION_ENABLED, AI_VISION_API_KEY, AI_VISION_MODEL) — ' +
        'the preliminary visual assessment feature is unavailable.',
    );
  }
  if (!capabilities.sms) {
    missing.push(
      'SMS and phone OTP (SMS_PROVIDER, SMS_API_KEY, SMS_SENDER_ID) — email verification is used.',
    );
  }
  if (!capabilities.marketData) {
    missing.push(
      'Market price data (AGMARKNET_API_URL) — market insights shows manually recorded ' +
        'observations, each labelled with its date and source.',
    );
  }

  return missing;
}
