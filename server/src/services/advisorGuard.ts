/**
 * Output guard for the farmer advisor.
 *
 * The system prompt tells the model not to invent figures. A prompt is a request,
 * not a guarantee: asked for "a rough cost per acre", a language model will often
 * produce a plausible number with a hedge attached. A wrong cost per acre decides
 * whether a family borrows money, so the rule is also enforced here.
 *
 * Every number a reply presents as a cost, yield, revenue, profit or duration must
 * match a cell in the comparison table the model was given. A sentence carrying an
 * unsupported figure is withheld and replaced with an honest notice. Sentences of
 * general advice contain no such figure and pass through untouched.
 *
 * This module is deliberately free of database, network and framework imports so
 * it can be unit-tested against fixtures. The types below are structural, so the
 * `CropComparison` built by `advisor.ts` satisfies them without a shared import.
 */

export type ClaimField = 'cost' | 'yield' | 'profit' | 'revenue' | 'duration';

export type ValueFamily = 'currency' | 'mass' | 'duration' | 'area';

/** The part of a comparison cell the guard reads. */
export interface GuardCell {
  available: boolean;
  value: number | null;
  unit: string | null;
}

/** The part of a crop comparison the guard reads. */
export interface GuardComparison {
  crop_name: string;
  cost_per_acre: GuardCell;
  expected_yield: GuardCell;
  net_profit_per_acre: GuardCell;
  duration_days: GuardCell;
  unverified: boolean;
}

export interface GuardViolation {
  kind:
    | 'unsupported_value'
    | 'value_without_verified_data'
    | 'wrong_crop_attribution'
    | 'unsourced_aggregate';
  field: ClaimField;
  /** The crop the reply attached the figure to, when it named one. */
  crop: string | null;
  value: number;
  unit: string | null;
  sentence: string;
  reason: string;
}

export interface GuardResult {
  ok: boolean;
  /** Safe to show. Either the original reply or one with bad sentences replaced. */
  text: string;
  violations: GuardViolation[];
  claimsChecked: number;
  sentencesWithheld: number;
}

export interface GuardOptions {
  language?: string;
  /** Used to accept legitimate "for your 5 acres" arithmetic. */
  landAcres?: number | null;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const MASS_FACTORS: Record<string, number> = {
  kg: 1, kgs: 1, kilogram: 1, kilograms: 1, kilo: 1, kilos: 1,
  quintal: 100, quintals: 100, qt: 100,
  tonne: 1000, tonnes: 1000, ton: 1000, tons: 1000,
};

const CURRENCY_WORDS = new Set([
  'rupee', 'rupees', 'rs', 'inr', 're', '₹', 'rupaye', 'rupaya',
]);

const DURATION_FACTORS: Record<string, number> = {
  day: 1, days: 1,
  week: 7, weeks: 7,
  month: 30, months: 30,
  year: 365, years: 365,
};

/** Units that are never a cost, yield, profit or duration claim. */
const NEUTRAL_UNITS = new Set([
  'acre', 'acres', 'hectare', 'hectares', 'ha', 'guntha', 'gunta',
  'cent', 'cents', 'bigha', 'acreage',
  'percent', 'percentage', 'mm', 'cm', 'm', 'km', 'kms', 'celsius', 'deg',
  'per', 'a', 'an', 'the', 'of', 'for', 'and', 'to', 'in', 'is', 'are',
  'about', 'around', 'roughly', 'approximately', 'nearly', 'some', 'each',
  'at', 'on', 'with', 'would', 'will', 'can', 'be', 'you', 'your', 'it',
]);

/**
 * Land measures. A number followed by one of these is an area, not money, so
 * "for your 5 acres" must not be read as a claim of five rupees.
 */
const LAND_UNITS = new Set([
  'acre', 'acres', 'hectare', 'hectares', 'ha',
  'guntha', 'gunta', 'cent', 'cents', 'bigha',
]);

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/**
 * Includes the Devanagari danda. Newlines end a sentence so list items split.
 * Built fresh per call: a shared /g regex carries `lastIndex` between uses.
 */
const sentenceRe = (): RegExp => /[^.!?।\n]+[.!?।]*/g;

interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * The decimal point inside `8.5` must not end a sentence.
 *
 * Each protected `.` is swapped for a single sentinel character, so every offset
 * in the protected string still lines up with the original. Splitting and the
 * restored text therefore agree, which the replacement pass depends on.
 */
const DECIMAL_SENTINEL = '\uE000';

function protectDecimals(text: string): string {
  return text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_SENTINEL}$2`);
}

function restoreDecimals(text: string): string {
  return text.split(DECIMAL_SENTINEL).join('.');
}

function splitSentences(text: string): Sentence[] {
  const guarded = protectDecimals(text);
  const out: Sentence[] = [];
  for (const m of guarded.matchAll(sentenceRe())) {
    const raw = m[0];
    if (raw.trim().length === 0) continue;
    out.push({
      text: restoreDecimals(raw),
      start: m.index,
      end: m.index + raw.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------

interface Claim {
  value: number;
  unit: string | null;
  family: ValueFamily | null;
  index: number;
}

const MULTIPLIERS: Record<string, number> = {
  thousand: 1_000, k: 1_000,
  lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000,
  crore: 100_000_000, crores: 100_000_000, cr: 100_000_000,
  million: 1_000_000, mn: 1_000_000,
};

const numberRe = (): RegExp =>
  /(\d[\d,]*(?:\.\d+)?)(?:\s*(thousand|lakh|lakhs|lac|lacs|crore|crores|cr|million|mn)\b|\s*(k)\b)?/gi;

/** Unit words that prove a nearby 4-digit number is a quantity, not a year. */
const QUANTITY_LOOKAHEAD =
  '(?!\\s*(?:kg|kgs|kilogram|kilograms|kilo|kilos|quintal|quintals|qt|tonne|tonnes|ton|tons|' +
  'rupee|rupees|rs|inr|day|days|week|weeks|month|months|year|years|acre|acres|hectare|hectares)\\b)';

/**
 * Blank out things that are not claims: ISO dates, slash dates, year ranges, and
 * standalone years. The year rule is guarded so "yield of 2000 kg" survives — a
 * bare `\\b(19|20)\\d{2}\\b` strip would hide that real figure from the check.
 */
function maskDates(text: string): string {
  const year = new RegExp('\\b(?:19|20)\\d{2}\\b' + QUANTITY_LOOKAHEAD, 'g');
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\s*[-–]\s*\d{2}\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/g, ' ')
    .replace(year, ' ');
}

/**
 * A currency marker immediately before the number, as in "Rs 42,000" or "₹42,000".
 *
 * Without this, "Rs 42,000 per acre" resolves to `acre` and is filed as an area,
 * which exempts the most common money claim in a reply from any check at all.
 */
function currencyBefore(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 6), at).toLowerCase();
  if (/[₹]\s*$/.test(before)) return true;
  return /\b(?:rs|inr|re|rupees?)\b\s*\.?\s*$/.test(before);
}

/**
 * The unit of the figure at `from`.
 *
 * `per acre` and `/acre` are rate denominators, not the unit of the value: the
 * subject of "Rs 42,000 per acre" is rupees. Only a land word standing on its own,
 * as in "for your 5 acres", is an area.
 */
function unitAfter(text: string, from: number, numberIndex: number): string | null {
  if (currencyBefore(text, numberIndex)) return 'inr';

  const window = text.slice(from, from + 28);
  const words = window.match(/[A-Za-z₹%]+/g) ?? [];
  let fallback: string | null = null;

  for (let i = 0; i < Math.min(words.length, 3); i += 1) {
    const word = (words[i] ?? '').toLowerCase();
    const isDenominator = i === 0 && /^\s*\/|\bper\b/i.test(text.slice(from, from + 8));
    if (LAND_UNITS.has(word)) {
      // "per acre" continues; a land word on its own is the unit.
      if (isDenominator || /^\s*per\b/i.test(text.slice(from, from + 8))) continue;
      return word;
    }
    if (MASS_FACTORS[word] !== undefined) return word;
    if (DURATION_FACTORS[word] !== undefined) return word;
    if (CURRENCY_WORDS.has(word)) return word;
    if (NEUTRAL_UNITS.has(word)) continue;
    if (fallback === null) fallback = word;
  }
  return fallback;
}

function familyForUnit(unit: string | null): ValueFamily | null {
  if (unit === null) return null;
  const key = unit.toLowerCase();
  if (CURRENCY_WORDS.has(key)) return 'currency';
  if (MASS_FACTORS[key] !== undefined) return 'mass';
  if (DURATION_FACTORS[key] !== undefined) return 'duration';
  if (LAND_UNITS.has(key)) return 'area';
  return null;
}

/** Scale a claim to its family's base unit so 8.5 quintal and 850 kg compare equal. */
function toCanonical(value: number, unit: string | null, family: ValueFamily | null): number {
  if (unit === null) return value;
  const key = unit.toLowerCase();
  if (family === 'mass') {
    const f = MASS_FACTORS[key];
    if (f !== undefined) return value * f;
  }
  if (family === 'duration') {
    const f = DURATION_FACTORS[key];
    if (f !== undefined) return value * f;
  }
  return value;
}

function extractNumbers(sentence: string): Claim[] {
  const masked = maskDates(sentence);
  const out: Claim[] = [];
  for (const m of masked.matchAll(numberRe())) {
    const digits = m[1];
    if (digits === undefined) continue;
    const parsed = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) continue;

    const word = m[2] ?? m[3];
    const factor = word ? (MULTIPLIERS[word.toLowerCase()] ?? 1) : 1;
    const value = parsed * factor;

    const index = m.index ?? 0;
    const end = index + m[0].length;
    const unit = unitAfter(masked, end, index);
    out.push({ value, unit, family: familyForUnit(unit), index });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

const COST_WORDS = ['cost', 'costs', 'expense', 'expenses', 'expenditure', 'spend', 'input', 'investment', 'cultivation'];
const YIELD_WORDS = ['yield', 'yields', 'produce', 'production', 'output', 'harvest'];
const PROFIT_WORDS = ['profit', 'profits', 'profitable', 'margin', 'net return', 'net returns', 'earn', 'earnings', 'income'];
const REVENUE_WORDS = ['revenue', 'gross', 'turnover', 'sales', 'sale'];
const DURATION_WORDS = ['duration', 'days', 'day', 'months', 'month', 'weeks', 'week', 'years', 'year', 'period', 'maturity'];

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Which figures a sentence is talking about.
 *
 * Returns every plausible field rather than one guess. A currency figure with no
 * disambiguating keyword is checked against cost and profit both, which keeps a
 * correct reply from being rejected over wording.
 */
function fieldsForSentence(sentence: string, unit: string | null, family: ValueFamily | null): ClaimField[] {
  const lower = sentence.toLowerCase();
  const fields = new Set<ClaimField>();

  // "for your 5 acres" is an area, not money. Returning no fields exempts it.
  if (family === 'area') return [];

  if (family === 'mass') fields.add('yield');
  if (family === 'duration') fields.add('duration');
  if (family === 'currency') {
    // Resolved below from the sentence wording.
    if (hasAny(lower, COST_WORDS)) fields.add('cost');
    if (hasAny(lower, PROFIT_WORDS)) fields.add('profit');
    if (hasAny(lower, REVENUE_WORDS)) fields.add('revenue');
    if (fields.size === 0) {
      fields.add('cost');
      fields.add('profit');
      fields.add('revenue');
    }
  }

  if (hasAny(lower, COST_WORDS) && !hasAny(lower, YIELD_WORDS) && family === null) fields.add('cost');
  if (hasAny(lower, YIELD_WORDS) && family === null) fields.add('yield');
  if (hasAny(lower, PROFIT_WORDS) && family === null) fields.add('profit');
  if (hasAny(lower, DURATION_WORDS) && family === null) fields.add('duration');
  if (hasAny(lower, REVENUE_WORDS) && family === null) fields.add('revenue');

  // "quintal" as a unit word only means yield when the sentence is about a crop.
  if (family === null && unit !== null && MASS_FACTORS[unit] !== undefined) fields.add('yield');

  return [...fields];
}

// ---------------------------------------------------------------------------
// Allowed values
// ---------------------------------------------------------------------------

interface Allowed {
  field: ClaimField;
  value: number;
  family: ValueFamily;
}

const FIELD_FAMILY: Record<ClaimField, ValueFamily> = {
  cost: 'currency',
  yield: 'mass',
  profit: 'currency',
  revenue: 'currency',
  duration: 'duration',
};

/** Every figure this crop is permitted to have quoted, canonicalised. */
function allowedFor(comparison: GuardComparison): Allowed[] {
  const out: Allowed[] = [];

  const push = (field: ClaimField, cell: GuardCell): void => {
    if (!cell.available || cell.value === null) return;
    const family = FIELD_FAMILY[field];
    const unit = family === 'currency' ? null : cell.unit;
    out.push({ field, value: toCanonical(cell.value, unit, family), family });
  };

  push('cost', comparison.cost_per_acre);
  push('yield', comparison.expected_yield);
  push('profit', comparison.net_profit_per_acre);
  push('duration', comparison.duration_days);

  // Revenue is yield times price. Net profit is that gross less cost, so the gross
  // is recoverable exactly when both are recorded. It is a derivation, not a new
  // number, which is why it may be quoted.
  const cost = comparison.cost_per_acre;
  const profit = comparison.net_profit_per_acre;
  if (cost.available && cost.value !== null && profit.available && profit.value !== null) {
    out.push({ field: 'revenue', value: cost.value + profit.value, family: 'currency' });
  }

  return out;
}

/** Compare with a tolerance that absorbs rounding but not invention. */
function matches(claimed: number, allowed: number, family: ValueFamily): boolean {
  if (!Number.isFinite(claimed) || !Number.isFinite(allowed)) return false;
  // Durations may be restated in months, so allow a month of slack.
  const tolerance = family === 'duration'
    ? Math.max(Math.abs(allowed) * 0.1, 7)
    : Math.max(Math.abs(allowed) * 0.005, 1);
  return Math.abs(claimed - allowed) <= tolerance;
}

// ---------------------------------------------------------------------------
// Crop attribution
// ---------------------------------------------------------------------------

interface CropMention {
  crop: string;
  index: number;
}

function cropsMentioned(sentence: string, comparisons: GuardComparison[]): CropMention[] {
  const lower = sentence.toLowerCase();
  const found: CropMention[] = [];
  for (const c of comparisons) {
    const name = c.crop_name.toLowerCase().trim();
    if (name.length < 3) continue;
    const at = lower.indexOf(name);
    if (at >= 0) found.push({ crop: c.crop_name, index: at });
  }
  return found;
}

/**
 * The crop a figure belongs to.
 *
 * Normally the crop is named first — "Cotton costs Rs 42,000" — so the nearest
 * crop before the number wins. A forward window is allowed for the reverse
 * wording, "Rs 42,000 is the cost for Cotton", but it is kept short: a wide
 * lookahead let the *next* crop in a list sentence claim the previous crop's
 * figure, which is how "Cotton costs Rs 42,000, and Groundnut costs Rs 30,000"
 * had 42,000 attributed to Groundnut.
 */
const CROP_LOOKAHEAD = 24;

function cropFor(mentions: CropMention[], numberIndex: number): string | null {
  let before: CropMention | null = null;
  for (const m of mentions) {
    if (m.index <= numberIndex && (before === null || m.index > before.index)) before = m;
  }
  if (before !== null) return before.crop;

  let after: CropMention | null = null;
  for (const m of mentions) {
    if (m.index > numberIndex && m.index - numberIndex <= CROP_LOOKAHEAD) {
      if (after === null || m.index < after.index) after = m;
    }
  }
  return after?.crop ?? null;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

const NOTICES: Record<string, { figure: string; generic: string }> = {
  en: {
    figure: 'No verified figure is recorded for {crop} in your area, so I cannot give a number. Please confirm locally.',
    generic: 'I do not have a verified figure for that in your area, so I cannot give a number. Please confirm locally.',
  },
  te: {
    figure: 'మీ ప్రాంతంలో {crop} కోసం ధృవీకరించిన సంఖ్య నమోదు కాలేదు, కాబట్టి నేను సంఖ్య చెప్పలేను. స్థానికంగా నిర్ధారించుకోండి.',
    generic: 'మీ ప్రాంతంలో దానికి ధృవీకరించిన సంఖ్య లేదు, కాబట్టి నేను సంఖ్య చెప్పలేను. స్థానికంగా నిర్ధారించుకోండి.',
  },
  hi: {
    figure: 'आपके क्षेत्र में {crop} के लिए कोई सत्यापित आँकड़ा दर्ज नहीं है, इसलिए मैं संख्या नहीं बता सकता। कृपया स्थानीय रूप से पुष्टि करें।',
    generic: 'आपके क्षेत्र में उसके लिए कोई सत्यापित आँकड़ा नहीं है, इसलिए मैं संख्या नहीं बता सकता। कृपया स्थानीय रूप से पुष्टि करें।',
  },
};

function notice(language: string, crop: string | null): string {
  const table = NOTICES[language] ?? NOTICES.en!;
  if (crop) return table.figure.replace('{crop}', crop);
  return table.generic;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Check a reply against the comparison table it was written from.
 *
 * Returns the reply unchanged when every figure traces to a cell. Otherwise the
 * offending sentences are replaced and the violations are reported, so the caller
 * can log what the model tried to state.
 */
export function guardAdvisorReply(
  reply: string,
  comparisons: GuardComparison[],
  options: GuardOptions = {},
): GuardResult {
  const language = options.language ?? 'en';
  const landAcres = options.landAcres ?? null;
  const allowedByCrop = new Map<string, Allowed[]>();
  for (const c of comparisons) {
    allowedByCrop.set(c.crop_name.toLowerCase(), allowedFor(c));
  }

  const violations: GuardViolation[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  let claimsChecked = 0;

  for (const sentence of splitSentences(reply)) {
    const mentions = cropsMentioned(sentence.text, comparisons);
    const claims = extractNumbers(sentence.text);
    if (claims.length === 0) continue;

    const lower = sentence.text.toLowerCase();
    const mentionsAcres = [...LAND_UNITS].some((u) => new RegExp(`\\b${u}\\b`).test(lower));

    let sentenceBad = false;
    let firstBadCrop: string | null = null;

    for (const claim of claims) {
      const fields = fieldsForSentence(sentence.text, claim.unit, claim.family);
      if (fields.length === 0) continue;

      claimsChecked += 1;

      const crop = cropFor(mentions, claim.index);
      const candidates = crop !== null
        ? (allowedByCrop.get(crop.toLowerCase()) ?? [])
        : comparisons.flatMap((c) => allowedByCrop.get(c.crop_name.toLowerCase()) ?? []);

      const canonical = toCanonical(claim.value, claim.unit, claim.family);

      const ok = candidates.some((a) => {
        if (!fields.includes(a.field)) return false;
        if (matches(canonical, a.value, a.family)) return true;
        // A total over the farmer's own acreage is arithmetic on a verified figure.
        if (mentionsAcres && landAcres !== null && landAcres > 0) {
          if (matches(canonical, a.value * landAcres, a.family)) return true;
        }
        return false;
      });
      if (ok) continue;

      sentenceBad = true;
      firstBadCrop ??= crop;

      const field = fields[0]!;
      const otherCrop = comparisons.find((c) => {
        if (crop !== null && c.crop_name.toLowerCase() === crop.toLowerCase()) return false;
        return (allowedByCrop.get(c.crop_name.toLowerCase()) ?? [])
          .some((a) => fields.includes(a.field) && matches(canonical, a.value, a.family));
      });

      let kind: GuardViolation['kind'];
      let reason: string;
      if (otherCrop) {
        kind = 'wrong_crop_attribution';
        reason = `Value belongs to ${otherCrop.crop_name}, not ${crop ?? 'the crop named'}.`;
      } else if (crop !== null && !comparisons.some(
        (c) => c.crop_name.toLowerCase() === crop.toLowerCase() && !c.unverified,
      )) {
        kind = 'value_without_verified_data';
        reason = `No verified agronomic record exists for ${crop}.`;
      } else if (crop === null) {
        kind = 'unsourced_aggregate';
        reason = 'Figure matches no verified cell for any crop in context.';
      } else {
        kind = 'unsupported_value';
        reason = `No verified ${field} figure of ${claim.value} for ${crop}.`;
      }

      violations.push({
        kind,
        field,
        crop,
        value: claim.value,
        unit: claim.unit,
        sentence: sentence.text.trim(),
        reason,
      });
    }

    if (sentenceBad) {
      replacements.push({
        start: sentence.start,
        end: sentence.end,
        text: notice(language, firstBadCrop),
      });
    }
  }

  if (replacements.length === 0) {
    return { ok: true, text: reply, violations, claimsChecked, sentencesWithheld: 0 };
  }

  let text = '';
  let cursor = 0;
  for (const r of replacements) {
    text += reply.slice(cursor, r.start) + r.text;
    cursor = r.end;
  }
  text += reply.slice(cursor);

  return { ok: false, text, violations, claimsChecked, sentencesWithheld: replacements.length };
}

/** The small, non-sensitive summary the API returns alongside the answer. */
export function guardSummary(result: GuardResult): {
  ok: boolean;
  withheld: number;
  claims_checked: number;
} {
  return {
    ok: result.ok,
    withheld: result.sentencesWithheld,
    claims_checked: result.claimsChecked,
  };
}
