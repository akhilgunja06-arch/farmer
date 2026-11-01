/**
 * Verified agronomic reference figures.
 *
 * This module is the only place in the application that can produce a cost of
 * cultivation, an expected yield, or a net profit figure. It reads them from
 * `agronomic_reference`, which an administrator fills from a published source
 * (a state package of practices, a CACP cost-of-cultivation report, a university
 * extension bulletin) and which records that source on every row.
 *
 * When a row is absent the answer is "not available", never an estimate. An
 * earlier draft of this feature let the language model supply these numbers and
 * the results were confidently wrong — a plausible cost per acre for a crop in a
 * district the model had no data for. Farm economics decide whether a family
 * borrows money, so a missing figure must read as missing.
 */
import { q, q1, audit } from './helpers.js';
import { HttpError, asVerifiedAdmin } from '../db/pool.js';

export interface AgronomicFigure {
  crop_name: string;
  variety: string | null;
  state: string;
  district: string | null;
  season: string;
  cost_per_acre: number | null;
  cost_currency: string;
  yield_per_acre: number | null;
  yield_unit: string | null;
  duration_days: number | null;
  irrigation_needs: string | null;
  suitable_soils: string[];
  notes: string | null;
  source: string;
  source_ref: string | null;
  observed_on: string;
  /** Whole days since the observation. Surfaced so a stale figure is visible. */
  age_days: number;
  is_stale: boolean;
  /** True when the row matched the district exactly, false when only the state did. */
  district_match: boolean;
}

/** A figure older than this is labelled stale rather than merely dated. */
const STALE_AFTER_DAYS = 365 * 3;

/**
 * Look up reference figures for candidate crops at a location and season.
 *
 * A district row is preferred over a state row for the same crop. When only the
 * state row exists it is returned with `district_match: false`, so the interface
 * can say the figure is for the state rather than the farmer's own district.
 */
export async function figuresForCrops(input: {
  crops: string[];
  state: string;
  district?: string | null;
  season?: string | null;
}): Promise<AgronomicFigure[]> {
  if (input.crops.length === 0) return [];

  // DISTINCT ON picks one row per crop, preferring the district match, then the
  // most recent observation. Ordered to match that preference exactly.
  const rows = await q<Record<string, unknown>>(
    `SELECT DISTINCT ON (crop_name)
            crop_name, variety, state, district, season,
            cost_per_acre, cost_currency, yield_per_acre, yield_unit,
            duration_days, irrigation_needs, suitable_soils, notes,
            source, source_ref, observed_on,
            (CURRENT_DATE - observed_on) AS age_days,
            (district IS NOT NULL AND district = $2) AS district_match
       FROM agronomic_reference
      WHERE crop_name = ANY($1::text[])
        AND state = $3
        AND ($4::text IS NULL OR season = $4 OR season = 'any')
        AND (district IS NULL OR district = $2)
      ORDER BY crop_name,
               (district IS NOT NULL AND district = $2) DESC,
               observed_on DESC`,
    [input.crops, input.district ?? null, input.state, input.season ?? null],
  );

  return rows.map((row) => {
    const ageDays = Number(row.age_days ?? 0);
    return {
      crop_name: String(row.crop_name),
      variety: (row.variety as string | null) ?? null,
      state: String(row.state),
      district: (row.district as string | null) ?? null,
      season: String(row.season),
      cost_per_acre: row.cost_per_acre === null ? null : Number(row.cost_per_acre),
      cost_currency: String(row.cost_currency ?? 'INR'),
      yield_per_acre: row.yield_per_acre === null ? null : Number(row.yield_per_acre),
      yield_unit: (row.yield_unit as string | null) ?? null,
      duration_days: row.duration_days === null ? null : Number(row.duration_days),
      irrigation_needs: (row.irrigation_needs as string | null) ?? null,
      suitable_soils: (row.suitable_soils as string[] | null) ?? [],
      notes: (row.notes as string | null) ?? null,
      source: String(row.source),
      source_ref: (row.source_ref as string | null) ?? null,
      observed_on: String(row.observed_on).slice(0, 10),
      age_days: ageDays,
      is_stale: ageDays > STALE_AFTER_DAYS,
      district_match: row.district_match === true,
    };
  });
}

/**
 * Net profit per acre, but only when every input is real.
 *
 * Profit needs three things: a verified cost, a verified yield, and a price to
 * value the yield at. The price must come from the farmer's own listed price or
 * from a recorded market observation — never from a model. If any one of the
 * three is missing this returns null and the interface says so, because a profit
 * computed from a real yield and an invented price would look authoritative
 * while being wrong.
 */
export function netProfitPerAcre(input: {
  figure: AgronomicFigure;
  pricePerUnit: number | null;
}): number | null {
  const { figure, pricePerUnit } = input;
  if (figure.cost_per_acre === null) return null;
  if (figure.yield_per_acre === null) return null;
  if (pricePerUnit === null || pricePerUnit <= 0) return null;

  const gross = figure.yield_per_acre * pricePerUnit;
  return Math.round((gross - figure.cost_per_acre) * 100) / 100;
}

/**
 * Whether the reference table can answer cost and yield questions at all.
 *
 * Used by the advisor to decide between "here is the verified comparison" and
 * "no verified figures are recorded for your area yet", and by the health
 * endpoint so an operator can see the table is empty before a farmer does.
 */
export async function referenceDataStatus(): Promise<{
  configured: boolean;
  row_count: number;
  states: string[];
  latest_observation: string | null;
}> {
  const rows = await q<{ n: string; states: string[]; latest: string | null }>(
    `SELECT count(*)::text AS n,
            coalesce(array_agg(DISTINCT state), '{}') AS states,
            max(observed_on)::text AS latest
       FROM agronomic_reference`,
  );
  const row = rows[0];
  const count = Number(row?.n ?? 0);
  return {
    configured: count > 0,
    row_count: count,
    states: row?.states ?? [],
    latest_observation: row?.latest ?? null,
  };
}

// ---------------------------------------------------------------------------
// Recording reference data (administrator only)
// ---------------------------------------------------------------------------

export interface AgronomicReferenceInput {
  crop_name: string;
  state: string;
  season: 'kharif' | 'rabi' | 'zaid' | 'perennial' | 'any';
  district?: string | null;
  variety?: string | null;
  cost_per_acre?: number | null;
  yield_per_acre?: number | null;
  yield_unit?: string | null;
  duration_days?: number | null;
  irrigation_needs?: 'low' | 'medium' | 'high' | null;
  suitable_soils?: string[];
  notes?: string | null;
  source: string;
  source_ref?: string | null;
  observed_on: string;
}

/**
 * Record a verified agronomic figure.
 *
 * Administrator-only, and the source is mandatory: a row without a citable
 * source is an opinion, and the advisor would present it to a farmer as fact.
 * The `verified_by` stamp is the administrator who entered it, which is what the
 * interface shows as the figure's provenance.
 *
 * Re-entering the same crop/state/district/season updates the existing row
 * rather than adding a second one, so a correction supersedes rather than
 * competes.
 */
export async function recordReference(
  adminId: string,
  input: AgronomicReferenceInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ id: number }> {
  return asVerifiedAdmin(async () => {
    // Loose nullish check on purpose: an omitted optional field arrives as
    // undefined, and a strict `=== null` would let an empty row through.
    if (input.cost_per_acre == null && input.yield_per_acre == null) {
      throw new HttpError(
        422,
        'Record at least a cost per acre or an expected yield. A row with neither adds nothing.',
        'EMPTY_FIGURE',
        { cost_per_acre: 'Provide a cost, a yield, or both.' },
      );
    }

    const row = await q1<{ id: number }>(
      `INSERT INTO agronomic_reference (
         crop_name, state, district, season, variety,
         cost_per_acre, yield_per_acre, yield_unit,
         duration_days, irrigation_needs, suitable_soils, notes,
         source, source_ref, observed_on, verified_by, verified_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::quantity_unit,
         $9, $10, $11::text[], $12, $13, $14, $15::date, $16, now()
       )
       ON CONFLICT (crop_name, state, district, season) DO UPDATE SET
         variety          = EXCLUDED.variety,
         cost_per_acre    = EXCLUDED.cost_per_acre,
         yield_per_acre   = EXCLUDED.yield_per_acre,
         yield_unit       = EXCLUDED.yield_unit,
         duration_days    = EXCLUDED.duration_days,
         irrigation_needs = EXCLUDED.irrigation_needs,
         suitable_soils   = EXCLUDED.suitable_soils,
         notes            = EXCLUDED.notes,
         source           = EXCLUDED.source,
         source_ref       = EXCLUDED.source_ref,
         observed_on      = EXCLUDED.observed_on,
         verified_by      = EXCLUDED.verified_by,
         verified_at      = now()
       RETURNING id`,
      [
        input.crop_name, input.state, input.district ?? null, input.season,
        input.variety ?? null, input.cost_per_acre ?? null,
        input.yield_per_acre ?? null, input.yield_unit ?? null,
        input.duration_days ?? null, input.irrigation_needs ?? null,
        input.suitable_soils ?? [], input.notes ?? null,
        input.source, input.source_ref ?? null, input.observed_on, adminId,
      ],
    );
    if (!row) {
      throw new HttpError(500, 'The reference figure could not be recorded.', 'CREATE_FAILED');
    }

    await audit({
      action: 'agronomic_reference.record',
      entityType: 'agronomic_reference',
      entityId: String(row.id),
      after: { ...input },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return row;
  });
}

/**
 * Remove a reference row.
 *
 * A recorded figure can be wrong — a transcription error, a superseded report, a
 * row entered against the wrong district. The advisor quotes these as verified
 * fact, so an administrator needs a way to withdraw one rather than leaving a
 * bad number in place. The deletion is audited with the row's content so the
 * removal is traceable.
 */
export async function deleteReference(
  adminId: string,
  id: number,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  return asVerifiedAdmin(async () => {
    const existing = await q1<Record<string, unknown>>(
      `DELETE FROM agronomic_reference WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!existing) {
      throw new HttpError(404, 'That reference row could not be found.', 'NOT_FOUND');
    }

    await audit({
      action: 'agronomic_reference.delete',
      entityType: 'agronomic_reference',
      entityId: String(id),
      before: existing,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

/** All recorded reference rows, newest first. Administrator view. */
export async function listReference(): Promise<
  Array<Record<string, unknown>>
> {
  return asVerifiedAdmin(() =>
    q(
      `SELECT r.id, r.crop_name, r.state, r.district, r.season, r.variety,
              r.cost_per_acre, r.yield_per_acre, r.yield_unit, r.duration_days,
              r.irrigation_needs, r.source, r.source_ref, r.observed_on,
              r.verified_at, p.full_name AS verified_by_name
         FROM agronomic_reference r
         LEFT JOIN profiles p ON p.id = r.verified_by
        ORDER BY r.updated_at DESC
        LIMIT 500`,
    ),
  );
}
