import { capabilities } from '../config.js';
import { HttpError } from '../db/pool.js';
import { audit, q, q1, todayIST } from './helpers.js';

/**
 * Market price insights.
 *
 * The honesty requirement here is specific: never present a historical
 * observation as if it were a live price, and never present a marketplace
 * listing as if it were a mandi price. The two are different things and the UI
 * must say which is which.
 *
 * Agmarknet is the intended source of official data. It does not publish a
 * public REST API, so this module ships with:
 *   - a real ingestion path (an operator or an approved feed inserts rows with
 *     an explicit source and observed_on date),
 *   - a comparison view that always states the age of every observation,
 *   - a clear "not configured" state when no data has been ingested.
 *
 * Nothing here fabricates a price.
 */

export interface MarketObservationInput {
  commodity: string;
  variety?: string | null;
  state: string;
  district?: string | null;
  market_name?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  modal_price?: number | null;
  unit?: string;
  source: 'agmarknet' | 'enam' | 'manual_entry';
  source_ref?: string | null;
  observed_on: string;
}

export interface PriceComparison {
  configured: boolean;
  sourceNote: string;
  commodity: string;
  state: string;
  district: string | null;
  unit: string;
  observations: Array<Record<string, unknown> & { age_days: number; is_stale: boolean; staleness_note: string }>;
  marketplace: {
    average_price: number | null;
    min_price: number | null;
    max_price: number | null;
    listing_count: number;
    note: string;
  };
  summary: {
    latest_observation_date: string | null;
    observation_count: number;
    official_data_available: boolean;
  };
}

/** An observation older than this is labelled stale rather than merely dated. */
const STALE_AFTER_DAYS = 30;

/**
 * Compare a commodity's marketplace listings against recorded market
 * observations for a state.
 *
 * Deliberately returns both sides rather than a single "market price", so the
 * farmer can see that the two numbers come from different places.
 */
export async function comparePrices(params: {
  commodity: string;
  state: string;
  district?: string | null;
  unit?: string;
}): Promise<PriceComparison> {
  const unit = params.unit ?? 'quintal';

  const observations = await q<Record<string, unknown> & { observed_on: string; source: string }>(
    `SELECT id, commodity, variety, state, district, market_name,
            min_price, max_price, modal_price, unit::text, source::text,
            source_ref, observed_on, fetched_at
       FROM market_price_observations
      WHERE lower(commodity) = lower($1)
        AND state = $2
        AND ($3::text IS NULL OR district = $3)
      ORDER BY observed_on DESC, fetched_at DESC
      LIMIT 60`,
    [params.commodity, params.state, params.district ?? null],
  );

  const today = todayIST();
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  const enriched = observations.map((row) => {
    const observedMs = Date.parse(`${row.observed_on}T00:00:00Z`);
    const ageDays = Math.max(0, Math.round((todayMs - observedMs) / 86_400_000));
    const isStale = ageDays > STALE_AFTER_DAYS;

    return {
      ...row,
      age_days: ageDays,
      is_stale: isStale,
      staleness_note: isStale
        ? `Recorded ${ageDays} days ago. This is a historical observation, not a current price.`
        : ageDays === 0
          ? 'Recorded today.'
          : `Recorded ${ageDays} day${ageDays === 1 ? '' : 's'} ago.`,
    };
  });

  // The marketplace side is derived from real listings, and labelled as
  // user-listed prices rather than market prices.
  const marketplace = await q1<{
    average_price: number | null; min_price: number | null;
    max_price: number | null; listing_count: number;
  }>(
    `SELECT
       round(avg(price), 2) AS average_price,
       min(price) AS min_price,
       max(price) AS max_price,
       count(*)::int AS listing_count
     FROM public_products
      WHERE lower(name) = lower($1)
        AND state = $2
        AND ($3::text IS NULL OR district = $3)`,
    [params.commodity, params.state, params.district ?? null],
  );

  const latest = enriched[0]?.observed_on ?? null;
  const officialAvailable = enriched.some((o) => o.source !== 'manual_entry');

  return {
    configured: enriched.length > 0,
    sourceNote: officialAvailable
      ? 'Includes observations recorded from an official agricultural market source.'
      : enriched.length > 0
        ? 'All observations here were entered manually by an operator. Treat them as reference figures, not official mandi data.'
        : 'No market price data has been recorded for this crop and state. Market data integration is not yet configured on this deployment.',
    commodity: params.commodity,
    state: params.state,
    district: params.district ?? null,
    unit,
    observations: enriched,
    marketplace: {
      average_price: marketplace?.average_price ?? null,
      min_price: marketplace?.min_price ?? null,
      max_price: marketplace?.max_price ?? null,
      listing_count: marketplace?.listing_count ?? 0,
      note:
        'These are prices set by farmers on RythuDirect, not market or mandi prices. ' +
        'They are shown for comparison only and never change what a farmer has chosen to charge.',
    },
    summary: {
      latest_observation_date: latest,
      observation_count: enriched.length,
      official_data_available: officialAvailable,
    },
  };
}

/** Price history series for a chart, one point per observed date. */
export async function priceHistory(params: {
  commodity: string;
  state: string;
  district?: string | null;
  months?: number;
}): Promise<Array<Record<string, unknown>>> {
  const months = Math.min(24, Math.max(1, params.months ?? 6));
  return q(
    `SELECT observed_on,
            round(avg(modal_price), 2) AS avg_modal_price,
            round(min(min_price), 2) AS lowest,
            round(max(max_price), 2) AS highest,
            count(*)::int AS observation_count,
            (array_agg(source::text ORDER BY fetched_at DESC))[1] AS source
       FROM market_price_observations
      WHERE lower(commodity) = lower($1)
        AND state = $2
        AND ($3::text IS NULL OR district = $3)
        AND observed_on >= (CURRENT_DATE - ($4 || ' months')::interval)
      GROUP BY observed_on
      ORDER BY observed_on ASC`,
    [params.commodity, params.state, params.district ?? null, String(months)],
  );
}

/** Commodities that have any recorded observation, for the picker. */
export async function listObservedCommodities(): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT DISTINCT commodity, state,
            max(observed_on) AS latest_observation,
            count(*)::int AS observation_count
       FROM market_price_observations
      GROUP BY commodity, state
      ORDER BY commodity, state`,
  );
}

/**
 * Record a market observation. Administrator only.
 *
 * Every row carries its source and the date the market observed it, so the UI
 * can always show how old a figure is. `fetched_at` is stamped automatically.
 */
export async function recordObservation(
  adminId: string,
  input: MarketObservationInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ id: number }> {
  const minPrice = input.min_price ?? null;
  const maxPrice = input.max_price ?? null;
  const modalPrice = input.modal_price ?? null;

  if (minPrice !== null && maxPrice !== null && maxPrice < minPrice) {
    throw new HttpError(422, 'The maximum price cannot be below the minimum price.', 'INVALID_RANGE', {
      max_price: 'Maximum must be at least the minimum.',
    });
  }
  if (modalPrice !== null && minPrice !== null && modalPrice < minPrice) {
    throw new HttpError(422, 'The modal price cannot be below the minimum price.', 'INVALID_RANGE', {
      modal_price: 'Modal price must be at least the minimum.',
    });
  }

  const created = await q1<{ id: number }>(
    `INSERT INTO market_price_observations (
       commodity, variety, state, district, market_name,
       min_price, max_price, modal_price, unit, source, source_ref, observed_on, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::quantity_unit,$10::price_source,$11,$12,$13)
     RETURNING id`,
    [
      input.commodity, input.variety ?? null, input.state, input.district ?? null,
      input.market_name ?? null, minPrice, maxPrice,
      modalPrice, input.unit ?? 'quintal',
      input.source, input.source_ref ?? null, input.observed_on, adminId,
    ],
  );
  if (!created) throw new HttpError(500, 'The observation could not be recorded.', 'CREATE_FAILED');

  await audit({
    action: 'market_price.record',
    entityType: 'market_price_observation',
    entityId: String(created.id),
    after: { ...input, unit: input.unit ?? 'quintal' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return created;
}

/**
 * The integration status the administrator dashboard shows.
 *
 * States plainly which external services are live and which need credentials,
 * so "not configured" is visible rather than guessed at.
 */
export async function integrationStatus(): Promise<Record<string, unknown>> {
  const observationCount = await q1<{ n: number }>(
    'SELECT count(*)::int AS n FROM market_price_observations',
  );

  return {
    database: {
      configured: true,
      detail: 'PostgreSQL with row level security enforced on every user-data table.',
    },
    maps: {
      configured: capabilities.maps,
      detail: capabilities.maps
        ? 'Google Maps browser key present. Location discovery renders an interactive map.'
        : 'No maps key. Location discovery falls back to state and district list search, which works fully.',
      envVars: ['VITE_GOOGLE_MAPS_API_KEY'],
    },
    payments: {
      configured: capabilities.payments,
      webhookConfigured: capabilities.paymentsWebhook,
      detail: capabilities.payments
        ? 'Razorpay keys present. Checkout offers online payment and verifies signatures server-side.'
        : 'No Razorpay keys. Checkout offers cash on delivery only, clearly labelled.',
      envVars: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
    },
    email: {
      configured: capabilities.email,
      detail: capabilities.email
        ? 'SMTP configured. Verification and reset emails are delivered.'
        : 'No SMTP configured. Verification and reset links are written to the server log instead of being sent.',
      envVars: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'],
    },
    aiVision: {
      configured: capabilities.aiVision,
      detail: capabilities.aiVision
        ? 'AI-assisted image assessment is enabled. Results are labelled preliminary.'
        : 'AI image assessment is off. Quality information comes from farmers and reviewers.',
      envVars: ['AI_VISION_ENABLED', 'AI_VISION_API_KEY', 'AI_VISION_MODEL'],
    },
    sms: {
      configured: capabilities.sms,
      detail: capabilities.sms
        ? 'An SMS provider is configured.'
        : 'No SMS provider. Phone OTP is hidden; email verification is used instead.',
      envVars: ['SMS_PROVIDER', 'SMS_API_KEY', 'SMS_SENDER_ID'],
    },
    marketData: {
      configured: capabilities.marketData,
      records: observationCount?.n ?? 0,
      detail: capabilities.marketData
        ? 'A market data endpoint is configured.'
        : 'No market data API. Market insights shows manually recorded observations, each with its date and source.',
      envVars: ['AGMARKNET_API_KEY', 'AGMARKNET_API_URL'],
    },
  };
}
