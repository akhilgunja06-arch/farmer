/**
 * The farmer advisor.
 *
 * A farmer describes their farm — place, season, water, soil, budget — and the
 * advisor compares crops that suit it, in their own language.
 *
 * The division of labour is the whole design:
 *
 *   The language model writes prose. It explains, translates, and asks the next
 *   question. It never supplies a number that a farmer would act on.
 *
 *   Every figure — cost of cultivation, expected yield, market price — is read
 *   from the database and passed to the model as fixed text. If the figure is
 *   absent, the model is told to say it is unavailable, and the structured
 *   response marks the cell as such so the interface cannot render a blank as a
 *   zero.
 *
 * This exists because the obvious implementation — "ask the model which crop is
 * most profitable" — produces confident, specific, fabricated economics. A
 * farmer who borrows money against an invented yield-per-acre figure has been
 * harmed by software. So the model is given a narrow job and the database keeps
 * the arithmetic.
 */
import { config, capabilities } from '../config.js';
import { guardAdvisorReply, guardSummary } from './advisorGuard.js';
import { HttpError } from '../db/pool.js';
import { q, q1, audit, todayIST } from './helpers.js';
import { figuresForCrops, type AgronomicFigure } from './agronomy.js';
import { comparePrices } from './market.js';
import { weatherForLocation, type WeatherResult } from './weather.js';

export const ADVISOR_DISCLAIMER =
  'This guidance is informational. Cost, yield and price figures come only from ' +
  'verified records; anything marked "not available" has no verified source for ' +
  'your area. Confirm with your local agriculture extension officer before ' +
  'committing money to a crop.';

/** Crops the advisor will discuss. Kept broad; the model narrows it. */
const CANDIDATE_CROPS = [
  'Rice', 'Wheat', 'Maize', 'Cotton', 'Groundnut', 'Soybean', 'Red gram', 'Green gram',
  'Black gram', 'Bengal gram', 'Chilli', 'Turmeric', 'Onion', 'Tomato', 'Brinjal',
  'Okra', 'Bhendi', 'Cabbage', 'Cauliflower', 'Potato', 'Sweet potato', 'Mango',
  'Banana', 'Papaya', 'Sugarcane', 'Jowar', 'Bajra', 'Ragi', 'Sunflower', 'Sesame',
  'Coconut', 'Coriander', 'Cumin', 'Garlic', 'Watermelon', 'Muskmelon', 'Cucumber',
];

export interface AdvisorSessionRow {
  id: string;
  farmer_id: string;
  state: string | null;
  district: string | null;
  village: string | null;
  land_acres: number | null;
  season: string | null;
  irrigation: string | null;
  soil_type: string | null;
  budget_inr: number | null;
  language: string;
  title: string | null;
  status: string;
  compared_crops: string[];
  created_at: string;
  updated_at: string;
}

/**
 * A cell in the comparison table.
 *
 * `available: false` is a first-class outcome, not an error. It is what the
 * interface renders as "Data Not Available", and it is the correct answer
 * whenever no verified figure exists.
 */
export interface ComparisonCell {
  available: boolean;
  value: number | null;
  unit: string | null;
  /** Set when available is false: why there is no figure. */
  reason?: string;
  /** Where the figure came from, when there is one. */
  source?: string;
  observed_on?: string;
  age_days?: number;
  is_stale?: boolean;
}

export interface CropComparison {
  crop_name: string;
  season: string | null;
  duration_days: ComparisonCell;
  cost_per_acre: ComparisonCell;
  expected_yield: ComparisonCell;
  net_profit_per_acre: ComparisonCell;
  irrigation_needs: ComparisonCell;
  suitable_soils: string[];
  key_risk: string;
  /** True when no verified agronomic row exists for this crop at this location. */
  unverified: boolean;
}

function missing(reason: string): ComparisonCell {
  return { available: false, value: null, unit: null, reason };
}

function fromFigure(
  value: number | null,
  unit: string | null,
  figure: AgronomicFigure,
  reason: string,
): ComparisonCell {
  if (value === null) return missing(reason);
  return {
    available: true,
    value,
    unit,
    source: figure.source,
    observed_on: figure.observed_on,
    age_days: figure.age_days,
    is_stale: figure.is_stale,
  };
}

/** Latest recorded market price for a commodity, or null when none exists. */
async function marketPriceFor(
  commodity: string,
  state: string,
  district: string | null,
): Promise<{ modal: number | null; unit: string; observed_on: string | null; source: string } | null> {
  const comparison = await comparePrices({ commodity, state, district });
  const latest = comparison.observations[0];
  if (!latest) return null;

  const modal = latest.modal_price;
  const numeric = typeof modal === 'number' ? modal : Number(modal);
  return {
    modal: Number.isFinite(numeric) ? numeric : null,
    unit: String(latest.unit ?? comparison.unit),
    observed_on: String(latest.observed_on ?? '').slice(0, 10),
    source: String(latest.source ?? 'manual_entry'),
  };
}

/**
 * Build the comparison table.
 *
 * Every crop is looked up in the reference table first. A crop with no row is
 * returned with `unverified: true` and empty cells, which is what makes the
 * "Data Not Available" column honest rather than a rendered zero.
 */
export async function buildComparison(input: {
  crops: string[];
  state: string;
  district: string | null;
  season: string | null;
  landAcres: number | null;
}): Promise<CropComparison[]> {
  const figures = await figuresForCrops({
    crops: input.crops,
    state: input.state,
    district: input.district,
    season: input.season,
  });

  const byCrop = new Map(figures.map((f) => [f.crop_name.toLowerCase(), f]));
  const comparisons: CropComparison[] = [];

  for (const crop of input.crops) {
    const figure = byCrop.get(crop.toLowerCase());

    if (!figure) {
      comparisons.push({
        crop_name: crop,
        season: input.season,
        duration_days: missing('No verified duration recorded for your area.'),
        cost_per_acre: missing('No verified cost of cultivation recorded for your area.'),
        expected_yield: missing('No verified yield figure recorded for your area.'),
        net_profit_per_acre: missing('Cannot be estimated without a verified cost and yield.'),
        irrigation_needs: missing('No verified irrigation requirement recorded for your area.'),
        suitable_soils: [],
        key_risk: 'Unverified for your area — discuss locally before planning.',
        unverified: true,
      });
      continue;
    }

    const price = await marketPriceFor(crop, input.state, input.district);

    const duration: ComparisonCell = figure.duration_days === null
      ? missing('No verified duration recorded.')
      : {
          available: true, value: figure.duration_days, unit: 'days',
          source: figure.source, observed_on: figure.observed_on,
          age_days: figure.age_days, is_stale: figure.is_stale,
        };

    const irrigation: ComparisonCell = figure.irrigation_needs === null
      ? missing('No verified irrigation requirement recorded.')
      : {
          available: true, value: null, unit: null,
          reason: `Requires ${figure.irrigation_needs} irrigation.`,
          source: figure.source, observed_on: figure.observed_on,
        };

    const cost = fromFigure(
      figure.cost_per_acre, figure.cost_currency, figure,
      'No verified cost of cultivation recorded for your area.',
    );

    const yieldCell = fromFigure(
      figure.yield_per_acre, figure.yield_unit, figure,
      'No verified yield figure recorded for your area.',
    );

    // Profit needs a price as well. Without a recorded market price the yield is
    // real but its value is not, so the cell stays unavailable.
    let profit: ComparisonCell;
    if (figure.cost_per_acre === null || figure.yield_per_acre === null) {
      profit = missing('Cannot be estimated without a verified cost and yield.');
    } else if (!price || price.modal === null) {
      profit = missing(
        'Cost and yield are recorded, but no market price is on file to value the yield. ' +
          'Record a price observation to see an estimate.',
      );
    } else {
      const gross = figure.yield_per_acre * price.modal;
      profit = {
        available: true,
        value: Math.round((gross - figure.cost_per_acre) * 100) / 100,
        unit: figure.cost_currency,
        source: `${figure.source}; price: ${price.source} (${price.observed_on})`,
        observed_on: figure.observed_on,
        age_days: figure.age_days,
        is_stale: figure.is_stale,
      };
    }

    const risks: string[] = [];
    if (figure.irrigation_needs === 'high') risks.push('Needs reliable water.');
    if (figure.is_stale) risks.push(`Figures are ${figure.age_days} days old.`);
    if (!figure.district_match) risks.push('Figures are for the state, not your district.');

    comparisons.push({
      crop_name: crop,
      season: figure.season,
      duration_days: duration,
      cost_per_acre: cost,
      expected_yield: yieldCell,
      net_profit_per_acre: profit,
      irrigation_needs: irrigation,
      suitable_soils: figure.suitable_soils,
      key_risk: risks.length > 0 ? risks.join(' ') : 'No specific risk recorded.',
      unverified: false,
    });
  }

  return comparisons;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Fields a farmer may set on a session. Unknown keys are stripped by Zod. */
export interface SessionInput {
  state?: string | null;
  district?: string | null;
  village?: string | null;
  land_acres?: number | null;
  season?: string | null;
  irrigation?: string | null;
  soil_type?: string | null;
  budget_inr?: number | null;
  language?: 'en' | 'te' | 'hi';
}

export async function listSessions(farmerId: string): Promise<AdvisorSessionRow[]> {
  return q<AdvisorSessionRow>(
    `SELECT * FROM advisor_sessions
      WHERE farmer_id = $1
      ORDER BY updated_at DESC
      LIMIT 50`,
    [farmerId],
  );
}

export async function getSession(
  farmerId: string,
  sessionId: string,
): Promise<AdvisorSessionRow | null> {
  return q1<AdvisorSessionRow>(
    'SELECT * FROM advisor_sessions WHERE id = $1 AND farmer_id = $2',
    [sessionId, farmerId],
  );
}

/**
 * Create a session.
 *
 * When the farmer does not name a place, it is taken from their farm profile.
 * That is the common case: they have already told the marketplace where they
 * farm, and re-typing it would be a pointless form.
 */
export async function createSession(
  farmerId: string,
  input: SessionInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<AdvisorSessionRow> {
  const profile = await q1<{
    state: string | null; district: string | null; village: string | null;
    crops_cultivated: string[] | null;
  }>(
    `SELECT fp.state, fp.district, fp.village, fp.crops_cultivated
       FROM farmer_profiles fp
      WHERE fp.user_id = $1`,
    [farmerId],
  );

  const created = await q1<AdvisorSessionRow>(
    `INSERT INTO advisor_sessions
       (farmer_id, state, district, village, land_acres, season, irrigation,
        soil_type, budget_inr, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      farmerId,
      input.state ?? profile?.state ?? null,
      input.district ?? profile?.district ?? null,
      input.village ?? profile?.village ?? null,
      input.land_acres ?? null,
      input.season ?? null,
      input.irrigation ?? null,
      input.soil_type ?? null,
      input.budget_inr ?? null,
      input.language ?? 'te',
    ],
  );

  if (!created) throw new HttpError(500, 'The session could not be created.', 'SESSION_CREATE_FAILED');

  await audit({
    action: 'advisor.session_created',
    entityType: 'advisor_session',
    entityId: created.id,
    after: { state: created.state, district: created.district, season: created.season },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return created;
}

export async function updateSession(
  farmerId: string,
  sessionId: string,
  input: SessionInput,
): Promise<AdvisorSessionRow> {
  const existing = await getSession(farmerId, sessionId);
  if (!existing) throw new HttpError(404, 'That conversation could not be found.', 'SESSION_NOT_FOUND');

  const updated = await q1<AdvisorSessionRow>(
    `UPDATE advisor_sessions SET
       state       = coalesce($3, state),
       district    = coalesce($4, district),
       village     = coalesce($5, village),
       land_acres  = coalesce($6, land_acres),
       season      = coalesce($7, season),
       irrigation  = coalesce($8, irrigation),
       soil_type   = coalesce($9, soil_type),
       budget_inr  = coalesce($10, budget_inr),
       language    = coalesce($11, language)
     WHERE id = $1 AND farmer_id = $2
     RETURNING *`,
    [
      sessionId, farmerId,
      input.state ?? null, input.district ?? null, input.village ?? null,
      input.land_acres ?? null, input.season ?? null, input.irrigation ?? null,
      input.soil_type ?? null, input.budget_inr ?? null, input.language ?? null,
    ],
  );

  if (!updated) throw new HttpError(404, 'That conversation could not be found.', 'SESSION_NOT_FOUND');
  return updated;
}

export async function deleteSession(farmerId: string, sessionId: string): Promise<void> {
  const deleted = await q1<{ id: string }>(
    'DELETE FROM advisor_sessions WHERE id = $1 AND farmer_id = $2 RETURNING id',
    [sessionId, farmerId],
  );
  if (!deleted) throw new HttpError(404, 'That conversation could not be found.', 'SESSION_NOT_FOUND');
}

export async function listMessages(sessionId: string): Promise<Array<Record<string, unknown>>> {
  return q(
    `SELECT id, role, body, context_json, model, error_code, created_at
       FROM advisor_messages
      WHERE session_id = $1
      ORDER BY created_at ASC
      LIMIT 200`,
    [sessionId],
  );
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

const LANGUAGES: Record<string, string> = {
  en: 'English',
  te: 'Telugu (తెలుగు)',
  hi: 'Hindi (हिन्दी)',
};

/**
 * Render the comparison as text the model must treat as fixed fact.
 *
 * The model is handed a table it cannot add to. Numbers arrive already formatted
 * with their unit and source, and an unavailable cell arrives as the literal
 * string "Data Not Available" so there is nothing to round or interpolate.
 */
function renderComparisonForPrompt(comparisons: CropComparison[], weather: WeatherResult): string {
  const lines: string[] = ['VERIFIED DATA (the only figures you may state):', ''];

  for (const c of comparisons) {
    lines.push(`Crop: ${c.crop_name}`);
    const cell = (label: string, value: ComparisonCell): string => {
      if (!value.available) return `${label}: Data Not Available (${value.reason ?? 'no verified source'})`;
      if (value.value === null) return `${label}: ${value.reason ?? 'recorded'}`;
      const unit = value.unit ? ` ${value.unit}` : '';
      const src = value.source ? ` [source: ${value.source}${value.observed_on ? `, ${value.observed_on}` : ''}]` : '';
      return `${label}: ${value.value}${unit}${src}`;
    };
    lines.push('  ' + cell('Cost per acre', c.cost_per_acre));
    lines.push('  ' + cell('Expected yield per acre', c.expected_yield));
    lines.push('  ' + cell('Net profit per acre', c.net_profit_per_acre));
    lines.push('  ' + cell('Duration', c.duration_days));
    lines.push('  ' + cell('Irrigation', c.irrigation_needs));
    if (c.suitable_soils.length > 0) lines.push(`  Suitable soils: ${c.suitable_soils.join(', ')}`);
    lines.push(`  Risk: ${c.key_risk}`);
    lines.push('');
  }

  if (weather.available) {
    lines.push('WEATHER (from Open-Meteo, treat as current fact):');
    if (weather.current) {
      lines.push(`  Now: ${weather.current.temp_c ?? '?'}°C, humidity ${weather.current.humidity_pct ?? '?'}%, wind ${weather.current.wind_kmh ?? '?'} km/h`);
    }
    lines.push(`  Rain expected over the next 7 days: ${weather.rain_total_mm ?? 0} mm`);
    const wet = weather.forecast.filter((d) => (d.rain_mm ?? 0) >= 2.5).map((d) => d.date);
    if (wet.length > 0) lines.push(`  Wet days: ${wet.join(', ')}`);
    lines.push(`  Granularity: ${weather.granularity === 'district' ? 'district centre (approximate)' : 'village'}`);
  } else {
    lines.push('WEATHER: Data Not Available (' + (weather.reason ?? 'unavailable') + ')');
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  'You are an agricultural advisor for small farmers in India, on a marketplace called RythuDirect.',
  '',
  'You will be given a VERIFIED DATA block. It is the ONLY source of cost, yield, profit,',
  'duration and price figures you may state. Rules, in order of importance:',
  '',
  '1. Never invent, estimate, interpolate or recall from memory any number for cost, yield,',
  '   profit, duration or price. If a figure is not in VERIFIED DATA, say it is not available',
  '   and move on. Do not offer a "rough idea" or a typical range.',
  '2. When a figure is marked "Data Not Available", tell the farmer plainly that no verified',
  '   figure exists for their area yet, and that they should confirm locally. Do not apologise',
  '   at length and do not fill the gap.',
  '3. You may reason freely about things that are not numbers: which crops suit a season, why',
  '   irrigation matters, how soil type affects choice, what a forecast implies for sowing,',
  '   how to read the risk notes. Explanation is your job.',
  '4. Be concrete and short. A farmer reading on a phone wants the point in the first line.',
  '5. Use simple, respectful language. No jargon. If you must use a technical word, explain it',
  '   in the same sentence.',
  '6. Never promise a profit, a yield, or a price. You may state what the records show.',
  '7. Do not discuss pesticide dosing, chemical application rates, or medical matters. Refer',
  '   those to the local agriculture extension officer.',
  '8. Answer in the language requested. Keep crop names recognisable.',
  '',
  'Format your reply as short paragraphs or a compact list. No markdown tables.',
].join('\n');

interface AdvisorReply {
  body: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** Ask the configured model. Throws HttpError with a clear code on failure. */
async function callAdvisorModel(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  language: string,
): Promise<AdvisorReply> {
  if (!capabilities.advisor) {
    throw new HttpError(
      503,
      'The advisor is not configured on this deployment. ' +
        'Set GROQ_API_KEY to enable conversational guidance.',
      'ADVISOR_NOT_CONFIGURED',
    );
  }

  const endpoint = `${config.advisor.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.advisor.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.advisor.apiKey}`,
      },
      body: JSON.stringify({
        model: config.advisor.model,
        max_tokens: config.advisor.maxTokens,
        temperature: config.advisor.temperature,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'system', content: `Answer in ${LANGUAGES[language] ?? 'English'}.` },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[advisor] provider returned', response.status, detail.slice(0, 400));
      throw new HttpError(
        502,
        'The advisor service did not respond. Please try again in a moment.',
        'ADVISOR_PROVIDER_ERROR',
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new HttpError(502, 'The advisor returned an empty answer.', 'ADVISOR_EMPTY_RESULT');
    }

    return {
      body: content.trim(),
      model: config.advisor.model,
      promptTokens: payload.usage?.prompt_tokens ?? null,
      completionTokens: payload.usage?.completion_tokens ?? null,
    };
  } catch (caught) {
    if (caught instanceof HttpError) throw caught;
    const message = (caught as Error).name === 'AbortError'
      ? 'The advisor took too long to answer. Please try again.'
      : 'The advisor service could not be reached.';
    console.error('[advisor] request failed', (caught as Error).message);
    throw new HttpError(502, message, 'ADVISOR_PROVIDER_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answer a question and record both turns.
 *
 * Weather and the comparison table are gathered first and stored on the
 * assistant message, so an answer can be traced back to the exact inputs that
 * produced it even after the reference table changes.
 */
export async function ask(
  farmerId: string,
  sessionId: string,
  question: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{
  answer: string;
  comparison: CropComparison[];
  weather: WeatherResult;
  disclaimer: string;
  model: string;
  reference_data_configured: boolean;
  guard: { ok: boolean; withheld: number; claims_checked: number };
}> {
  // Refuse before doing any work. Without this the weather call and the
  // comparison table would run, then the model call would fail — wasting the
  // upstream request and, worse, saving a question that can never be answered.
  if (!capabilities.advisor) {
    throw new HttpError(
      503,
      'The advisor is not configured on this deployment. Set GROQ_API_KEY to enable it.',
      'ADVISOR_NOT_CONFIGURED',
    );
  }

  const session = await getSession(farmerId, sessionId);
  if (!session) throw new HttpError(404, 'That conversation could not be found.', 'SESSION_NOT_FOUND');

  const history = await listMessages(sessionId);
  const weather = await weatherForLocation({
    village: session.village,
    district: session.district,
    state: session.state,
  });

  // Crops to consider: those the farmer already grows, plus the common set.
  const profile = await q1<{ crops_cultivated: string[] | null }>(
    'SELECT crops_cultivated FROM farmer_profiles WHERE user_id = $1',
    [farmerId],
  );
  const candidateSet = new Set<string>([
    ...(profile?.crops_cultivated ?? []),
    ...CANDIDATE_CROPS,
  ]);
  const crops = Array.from(candidateSet).slice(0, 12);

  const comparisons = await buildComparison({
    crops,
    state: session.state ?? '',
    district: session.district,
    season: session.season,
    landAcres: session.land_acres,
  });

  const referenceConfigured = comparisons.some((c) => !c.unverified);

  // Record the farmer's turn before calling out, so a provider failure still
  // leaves their question in the transcript rather than losing it.
  await q(
    `INSERT INTO advisor_messages (session_id, role, body)
     VALUES ($1, 'user', $2)`,
    [sessionId, question],
  );

  const contextText = renderComparisonForPrompt(comparisons, weather);
  const farmFacts = [
    `Farm: ${session.village ?? 'unspecified village'}, ${session.district ?? 'unspecified district'}, ${session.state ?? 'unspecified state'}`,
    session.land_acres ? `Land: ${session.land_acres} acres` : 'Land: not given',
    session.season ? `Season: ${session.season}` : 'Season: not given',
    session.irrigation ? `Irrigation: ${session.irrigation}` : 'Irrigation: not given',
    session.soil_type ? `Soil: ${session.soil_type}` : 'Soil: not given',
    session.budget_inr ? `Budget: ${session.budget_inr} INR` : 'Budget: not given',
  ].join('\n');

  const priorTurns = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.body) }));

  let reply: AdvisorReply;
  try {
    reply = await callAdvisorModel(
      [
        { role: 'user', content: `${farmFacts}\n\n${contextText}\n\nFARMER'S QUESTION: ${question}` },
        ...priorTurns,
      ],
      session.language,
    );
  } catch (caught) {
    // Record the failure so the transcript shows a failed turn rather than a gap.
    if (caught instanceof HttpError) {
      await q(
        `INSERT INTO advisor_messages (session_id, role, body, model, error_code)
         VALUES ($1, 'assistant', $2, $3, $4)`,
        [
          sessionId,
          'The advisor could not answer this time. Your question has been saved — please try again.',
          config.advisor.model,
          caught.code,
        ],
      );
    }
    throw caught;
  }

  // Enforce the figure rule rather than trusting the prompt to hold. A sentence
  // stating a cost, yield, revenue or profit that does not match a verified cell
  // is replaced before it is shown or stored.
  const guarded = guardAdvisorReply(reply.body, comparisons, {
    language: session.language,
    landAcres: session.land_acres,
  });
  if (!guarded.ok) {
    console.warn(
      `[advisor] withheld ${guarded.sentencesWithheld} unsupported figure(s) in session ${sessionId}: ` +
        guarded.violations.map((v) => `${v.field}=${v.value} (${v.kind})`).join(', '),
    );
  }

  await q(
    `INSERT INTO advisor_messages
       (session_id, role, body, context_json, model, prompt_tokens, completion_tokens)
     VALUES ($1, 'assistant', $2, $3::jsonb, $4, $5, $6)`,
    [
      sessionId, guarded.text,
      JSON.stringify({
        weather,
        comparison: comparisons,
        reference_data_configured: referenceConfigured,
        guard: guardSummary(guarded),
      }),
      reply.model, reply.promptTokens, reply.completionTokens,
    ],
  );

  await q(
    `UPDATE advisor_sessions
        SET compared_crops = $2,
            title = coalesce(title, $3)
      WHERE id = $1`,
    [sessionId, crops, question.slice(0, 120)],
  );

  await audit({
    action: 'advisor.asked',
    entityType: 'advisor_session',
    entityId: sessionId,
    after: {
      model: reply.model,
      reference_data_configured: referenceConfigured,
      crops: crops.length,
      guard_ok: guarded.ok,
      guard_withheld: guarded.sentencesWithheld,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    answer: guarded.text,
    comparison: comparisons,
    weather,
    disclaimer: ADVISOR_DISCLAIMER,
    model: reply.model,
    reference_data_configured: referenceConfigured,
    guard: guardSummary(guarded),
  };
}
