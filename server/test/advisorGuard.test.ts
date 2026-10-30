/**
 * Unit tests for the farmer advisor output guard.
 *
 * Run with:  npx tsx test/advisorGuard.test.ts
 *
 * These are fixtures, not the database. The guard is pure, so every case here is
 * a real exercise of the shipped code path: no mocks, no stubbed comparison
 * builder. Each case states what a plausible model reply would say and asserts
 * whether the guard lets it through.
 */

import {
  guardAdvisorReply,
  type GuardComparison,
  type GuardCell,
} from '../src/services/advisorGuard.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  \u001b[32mPASS\u001b[0m  ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  \u001b[31mFAIL\u001b[0m  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
}

function section(title: string): void {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ok = (value: number, unit: string | null): GuardCell => ({ available: true, value, unit });
const none = (): GuardCell => ({ available: false, value: null, unit: null });

function cotton(): GuardComparison {
  return {
    crop_name: 'Cotton',
    cost_per_acre: ok(42000, 'INR'),
    expected_yield: ok(8.5, 'quintal'),
    net_profit_per_acre: ok(38000, 'INR'),
    duration_days: ok(165, 'days'),
    unverified: false,
  };
}

function groundnut(): GuardComparison {
  return {
    crop_name: 'Groundnut',
    cost_per_acre: ok(30000, 'INR'),
    expected_yield: ok(12, 'quintal'),
    net_profit_per_acre: ok(25000, 'INR'),
    duration_days: ok(120, 'days'),
    unverified: false,
  };
}

/** A crop with no verified row at all, as buildComparison returns it. */
function maize(): GuardComparison {
  return {
    crop_name: 'Maize',
    cost_per_acre: none(),
    expected_yield: none(),
    net_profit_per_acre: none(),
    duration_days: none(),
    unverified: true,
  };
}

const TEXT = (over: Partial<GuardComparison> = {}): GuardComparison => ({
  ...cotton(),
  ...over,
});

// ---------------------------------------------------------------------------
section('1. General advice without figures passes through')
// ---------------------------------------------------------------------------

const advice = [
  'Cotton suits a kharif season with reliable water.',
  'Irrigation matters because the bolls need moisture at flowering.',
  'Black soil holds moisture well for this crop.',
  'You should confirm the figures with your local agriculture extension officer.',
].join('\n');

{
  const r = guardAdvisorReply(advice, [cotton(), groundnut()]);
  check('advice with no figures is not modified', r.text === advice);
  check('advice with no figures is reported ok', r.ok === true);
  check('nothing is withheld from pure advice', r.sentencesWithheld === 0);
}

{
  const r = guardAdvisorReply(
    'You have 5 acres. Cotton needs reliable water.',
    [cotton()],
    { landAcres: 5 },
  );
  check('a bare acreage is not treated as a money claim', r.ok === true,
    `violations: ${JSON.stringify(r.violations)}`);
}

{
  const r = guardAdvisorReply(
    'Sow in June and harvest around November.',
    [cotton()],
  );
  check('a month name without a figure passes', r.ok === true);
}

// ---------------------------------------------------------------------------
section('2. Supported figures are accepted')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply('Cotton costs about Rs 42,000 per acre.', [cotton()]);
  check('a verified cost is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Expected yield is 8.5 quintal per acre.', [cotton()]);
  check('a verified yield is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('The net profit is around Rs 38,000 per acre.', [cotton()]);
  check('a verified profit is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cotton takes about 165 days.', [cotton()]);
  check('a verified duration is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('For Groundnut the cost is Rs 30,000 per acre.', [cotton(), groundnut()]);
  check('the right figure for the right crop is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cotton costs Rs 42,000, while Groundnut costs Rs 30,000.', [cotton(), groundnut()]);
  check('two crops and two correct figures are accepted', r.ok === true, JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('3. Unsupported figures are rejected')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply('Cotton costs about Rs 55,000 per acre.', [cotton()]);
  check('an invented cost is rejected', r.ok === false);
  check('the invented cost is reported as a violation', r.violations.length === 1,
    JSON.stringify(r.violations));
  check('the violation names the cost field', r.violations[0]?.field === 'cost',
    JSON.stringify(r.violations[0]));
  check('the invented number is removed from the text', !r.text.includes('55,000'), r.text);
}

{
  const r = guardAdvisorReply('Expected yield is 20 quintal per acre.', [cotton()]);
  check('an invented yield is rejected', r.ok === false, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('You can earn a profit of Rs 90,000 per acre.', [cotton()]);
  check('an invented profit is rejected', r.ok === false, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cotton is ready in 90 days.', [cotton()]);
  check('an invented duration is rejected', r.ok === false, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cotton costs Rs 55,000 per acre. It needs reliable water.', [cotton()]);
  check('only the bad sentence is withheld', r.sentencesWithheld === 1, r.text);
  check('the good sentence survives', r.text.includes('reliable water'), r.text);
}

// ---------------------------------------------------------------------------
section('4. Crop attribution')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply('Groundnut costs Rs 42,000 per acre.', [cotton(), groundnut()]);
  check('a figure quoted for the wrong crop is rejected', r.ok === false, JSON.stringify(r.violations));
  check('it is reported as wrong-crop attribution', r.violations[0]?.kind === 'wrong_crop_attribution',
    JSON.stringify(r.violations[0]));
}

{
  const r = guardAdvisorReply('Cotton costs Rs 30,000 per acre.', [cotton(), groundnut()]);
  check('borrowing another crop\'s cost is rejected', r.ok === false, JSON.stringify(r.violations));
}

{
  // 42,000 is valid for Cotton and 30,000 for Groundnut, so both are fine.
  const r = guardAdvisorReply('Cotton: Rs 42,000. Groundnut: Rs 30,000.', [cotton(), groundnut()]);
  check('each figure attached to its own crop is accepted', r.ok === true, JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('5. Crops with no verified data')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply('Maize costs about Rs 25,000 per acre.', [cotton(), maize()]);
  check('a figure for an unverified crop is rejected', r.ok === false, JSON.stringify(r.violations));
  check('it is reported as missing verified data',
    r.violations[0]?.kind === 'value_without_verified_data',
    JSON.stringify(r.violations[0]));
}

{
  const r = guardAdvisorReply(
    'Maize is not in your verified records, so confirm locally.',
    [cotton(), maize()],
  );
  check('honest text about missing data passes', r.ok === true, JSON.stringify(r.violations));
}

{
  // Every crop unverified: even a number matching nothing must be caught.
  const r = guardAdvisorReply('Maize gives 30 quintal per acre.', [maize()]);
  check('a yield for a crop with no row is rejected', r.ok === false, JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('6. Units')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply('The yield is 850 kg per acre.', [cotton()]);
  check('8.5 quintal restated as 850 kg is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('The yield is 0.85 tonne per acre.', [cotton()]);
  check('8.5 quintal restated as 0.85 tonne is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('The yield is 900 kg per acre.', [cotton()]);
  check('a wrong mass in kg is rejected', r.ok === false, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cost is Rs 42,000 per acre.', [TEXT({ cost_per_acre: ok(42000, 'INR') })]);
  check('an INR cost with an Rs prefix is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cost is ₹42,000 per acre.', [cotton()]);
  check('a rupee-sign cost is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cost is about 42 thousand per acre.', [cotton()]);
  check('"42 thousand" is read as 42,000', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Duration is about 6 months.', [cotton()]);
  check('165 days restated as about 6 months is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('The yield is 8.5 quintal.', [cotton()]);
  check('a bare quintal figure is read as yield', r.ok === true, JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('7. Location and season wording')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply(
    'For your district in Telangana this kharif, Cotton costs Rs 42,000 per acre.',
    [cotton()],
  );
  check('a location and season qualifier does not break matching', r.ok === true,
    JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply(
    'For Warangal district the cost is Rs 42,000 per acre.',
    [TEXT({ unverified: false })],
  );
  check('a district name does not become a claim', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('In the 2024 kharif season, Cotton cost Rs 42,000 per acre.', [cotton()]);
  check('a year is not read as a figure', r.ok === true, JSON.stringify(r.violations));
}

{
  // The year-strip must not hide a real quantity.
  const r = guardAdvisorReply('Observed on 2024-06-01: yield was 2000 kg per acre.', [cotton()]);
  check('a date is ignored but a real mass is still checked', r.ok === false,
    JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Yield was 2000 kg per acre.', [cotton()]);
  check('a 4-digit mass is not swallowed by the year rule', r.ok === false,
    JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('8. Derived figures')
// ---------------------------------------------------------------------------

{
  // Gross revenue = cost + profit = 42,000 + 38,000 = 80,000.
  const r = guardAdvisorReply('Gross revenue would be about Rs 80,000 per acre.', [cotton()]);
  check('gross revenue derived from cost and profit is accepted', r.ok === true,
    JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Gross revenue would be about Rs 1,20,000 per acre.', [cotton()]);
  check('an invented gross revenue is rejected', r.ok === false, JSON.stringify(r.violations));
}

{
  // 42,000 * 5 = 210,000 total over the farmer's own five acres.
  const r = guardAdvisorReply('For your 5 acres, the total cost would be about Rs 2,10,000.', [cotton()], {
    landAcres: 5,
  });
  check('a total over the farmer\'s acreage is accepted', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('For your 5 acres, the total cost would be about Rs 3,00,000.', [cotton()], {
    landAcres: 5,
  });
  check('a wrong total over the acreage is rejected', r.ok === false, JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('9. Conflicting values across crops')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply(
    'Cotton costs Rs 42,000 per acre, and Groundnut costs Rs 55,000 per acre.',
    [cotton(), groundnut()],
  );
  check('a sentence mixing a valid and an invented figure is withheld', r.ok === false);
  check('the invented Groundnut figure is gone', !r.text.includes('55,000'), r.text);
}

{
  // Two figures in one sentence, each correctly attributed: both stand.
  const r = guardAdvisorReply(
    'Cotton costs Rs 42,000 per acre, and Groundnut costs Rs 30,000 per acre.',
    [cotton(), groundnut()],
  );
  check('two correctly attributed figures in one sentence are accepted', r.ok === true,
    JSON.stringify(r.violations));
}

{
  // A figure that is real but attached to the wrong crop is still withheld.
  const r = guardAdvisorReply('Groundnut costs Rs 42,000 per acre.', [cotton(), groundnut()]);
  check('a real figure attached to the wrong crop is withheld', r.ok === false,
    JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply(
    'Cotton yields 8.5 quintal and Groundnut yields 8.5 quintal per acre.',
    [cotton(), groundnut()],
  );
  check('a figure valid for one crop but wrong for the other is rejected', r.ok === false,
    JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------
section('10. Structured and edge-case input')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply('', [cotton()]);
  check('an empty reply is handled', r.ok === true && r.text === '');
}

{
  const r = guardAdvisorReply('Cotton costs Rs 42,000 per acre.', []);
  check('no comparisons means no figure is supported', r.ok === false, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('- Cotton: Rs 42,000 per acre\n- Water: reliable supply needed', [cotton()]);
  check('list items are treated as separate sentences', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Cotton costs Rs 42,000 per acre.', [cotton()]);
  check('the claim counter counts what it checked', r.claimsChecked > 0,
    `claimsChecked=${r.claimsChecked}`);
}

{
  const r = guardAdvisorReply('Cotton yields 8.5 quintal.', [cotton()]);
  const r2 = guardAdvisorReply('Cotton yields 8.5 quintal.', [cotton()]);
  check('repeated calls give the same verdict', r.ok === r2.ok && r.claimsChecked === r2.claimsChecked,
    `${r.ok}/${r.claimsChecked} vs ${r2.ok}/${r2.claimsChecked}`);
}

{
  // Telugu notice when the session language is Telugu.
  const r = guardAdvisorReply('Cotton costs Rs 55,000 per acre.', [cotton()], { language: 'te' });
  check('a Telugu session gets a Telugu notice', /[\u0C00-\u0C7F]/.test(r.text), r.text);
}

{
  const r = guardAdvisorReply('Cotton costs Rs 55,000 per acre.', [cotton()], { language: 'hi' });
  check('a Hindi session gets a Devanagari notice', /[\u0900-\u097F]/.test(r.text), r.text);
}

// ---------------------------------------------------------------------------
section('11. Degenerate output')
// ---------------------------------------------------------------------------

{
  const r = guardAdvisorReply(
    'Cotton costs Rs 1,00,000. Cotton yields 50 quintal. Profit is Rs 9,00,000.',
    [cotton()],
  );
  check('a wholly fabricated reply is fully withheld', r.sentencesWithheld === 3, r.text);
  check('no fabricated figure survives', !/\d{3}/.test(r.text.replace(/[^\d]/g, '')), r.text);
}

{
  const r = guardAdvisorReply('Rs 42,000.', [cotton()]);
  check('a bare supported figure passes', r.ok === true, JSON.stringify(r.violations));
}

{
  const r = guardAdvisorReply('Rs 42,000.', []);
  check('a bare unsupported figure is withheld', r.ok === false, JSON.stringify(r.violations));
}

// ---------------------------------------------------------------------------

console.log('\n' + '-'.repeat(45));
console.log(`\u001b[1mResult: ${pass} passed, ${fail} failed\u001b[0m`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll guard cases passed.');
