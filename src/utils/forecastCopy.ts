// src/utils/forecastCopy.ts — Stage 7. EVERY STRING THE FORECAST SAYS OUT LOUD.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS, AND WHAT THE SEAM ACTUALLY IS
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T5 left `forecast.ts` at 1,733 lines carrying SEVEN BLOCKS OF HEBREW UI COPY inside a
// computation module — a module a purity guard walks, and the one place in this stage where the
// arithmetic lives. The T5 review's instruction was to split it BEFORE T7 adds to it, so that T7
// inherits the split rather than causing it, and the seam it named is the obvious one: COPY OUT,
// MATHS STAYS.
//
// Two concrete things turn on the seam rather than on tidiness:
//
//   1. T7c's no-probability-language guard is an EXACT-MATCH check over label constants (plan §,
//      tier 2). A guard that has to point at `forecast.ts` is pointing at 1,700 lines of
//      arithmetic and hoping the strings it wants are the ones it finds. Pointing at this file is
//      pointing at a list.
//   2. `PROBABILITY_LABEL_FORMS` — the banned forms themselves — was NAMED IN A COMMENT IN
//      `forecast.ts` AS THOUGH IT ALREADY EXISTED (T5-review F6). It did not; it was a forward
//      reference to T7c. It exists now, below, and `forecastCopy.test.ts` holds every label in
//      this file against it, so the claim the comment made is a test rather than a promise.
//
// ── WHAT IS **NOT** HERE, DELIBERATELY ────────────────────────────────────────────────────────
//
// `CATEGORY_OTHER` (`'שונות'`), `CATEGORY_INSURANCE` and `CATEGORY_LOAN_REPAYMENT` are Hebrew and
// they STAY IN `forecast.ts`. They are not copy: they are BUCKET KEYS that must stay byte-identical
// to what `RecurringService` already stamps on every autoposted row and to `CATEGORY_MAP`'s own
// values. Moving them here would file a data-taxonomy identity under "things we could rephrase",
// and the first rephrasing would land a recurring item's projection and its posted rows in
// different buckets with green tests. The rule for this file is: A STRING BELONGS HERE IF CHANGING
// IT CHANGES ONLY WHAT A HUMAN READS.
//
// ── PURITY ────────────────────────────────────────────────────────────────────────────────────
//
// This module is inside `forecast.ts`'s transitive import closure, so `forecastPurity.test.ts`
// walks it: no I/O, no Firebase, no clock, and no import that leaves `src/`. It has no imports at
// all, which is the strongest form of that.
//
// ── WHY THE KEY UNIONS LIVE HERE TOO ──────────────────────────────────────────────────────────
//
// Each of the four string unions below is 1:1 with a `Record<…, string>` beside it, and
// `forecast.ts` imports and re-exports them, so every existing import site is unchanged. Declaring
// them here is what keeps the dependency ONE-DIRECTIONAL — `forecast.ts` → `forecastCopy.ts` and
// never back — which is the difference between a split and a cycle wearing a split's name.

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D3 — the band, and the language it is forbidden to use
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Hebrew a band's three edges are drawn with. D3's own words.
 *
 * A `Record` so T7c's TIER-2 exact-match check can point at a named label constant rather than at
 * every string in the module. None of these is a member of `PROBABILITY_LABEL_FORMS`, and none
 * contains `שמרן` or `אופטימי` — held by `forecastCopy.test.ts`, not asserted here.
 */
export const BAND_LABEL_HE: Record<'low' | 'mid' | 'high', string> = {
  high: 'הכי יקר שהיה',
  mid: 'האמצע',
  low: 'הכי זול שהיה',
};

/**
 * D3's discriminant, as the set of things the screen has a sentence for.
 *
 *   · `'observed-range'`      — `monthsObserved >= LOOKBACK_MONTHS_MIN`; the band is drawn.
 *   · `'insufficient-history'`— fewer months than that; the band is NOT drawn and the screen says so.
 *   · `'assumption-fixed'`    — an assumption set the amount. No band, ever: the user asserted a
 *                               number, and error bars on someone's own assertion are ours, not theirs.
 *
 * Re-exported from `forecast.ts` as `BandBasis`, which is the name every consumer uses.
 */
export type BandBasis = 'observed-range' | 'insufficient-history' | 'assumption-fixed';

/** Why a band is or is not drawn, in words. A `bandBasis` the screen can say out loud. */
export const BAND_BASIS_LABEL_HE: Record<BandBasis, string> = {
  'observed-range': 'טווח לפי מה שהיה בפועל',
  'insufficient-history': 'אין מספיק חודשים כדי להראות טווח',
  'assumption-fixed': 'סכום שנקבע ידנית',
};

/**
 * !! THE FORMS D3 AND A39 BAN, AND THE ONE THING THIS LIST IS NOT.
 *
 * `צפוי` is ORDINARY HEBREW for "expected" and appears in perfectly innocent sentences. The defect
 * A39 names is narrower and specific: a THREE-WAY BAND LABELLED שמרן / צפוי / אופטימי — a scenario
 * NAME presented as a probability. So this list is matched EXACTLY, against the TRIMMED value of a
 * label constant, and never as a substring of prose. A substring rule over this list would ban the
 * word "expected" from the whole product.
 *
 * The scope T7c points it at is the band/scenario/confidence LABEL CONSTANTS only — the four
 * records in this file and any future `Record<…, string>` whose values are drawn as a band or
 * scenario name.
 *
 * !! T5-review F6: this constant was referenced by name in a `forecast.ts` comment before it
 * existed. It exists now, and the comment that named it is a test.
 */
export const PROBABILITY_LABEL_FORMS: readonly string[] = [
  'צפוי',
  'הצפוי',
  'צפויה',
  'הצפויה',
  'תרחיש צפוי',
  'התרחיש הצפוי',
  'מצב צפוי',
];

/**
 * The two scenario names A39's defect is actually built from, banned as SUBSTRINGS rather than by
 * exact match.
 *
 * Unlike `צפוי` these are not ordinary words in any sentence this product writes: `שמרן`
 * ("conservative") and `אופטימי` ("optimistic") are the outer two thirds of the forbidden band, and
 * a label containing either is that band whatever else it says.
 */
export const SCENARIO_NAME_FRAGMENTS: readonly string[] = ['שמרן', 'אופטימי'];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D41 — the per-month confidence chip
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** D41's three chip states. `null` — no chip — is not a state, it is the absence of one. */
export type MonthConfidence = 'well-based' | 'estimate' | 'rough-estimate';

export const MONTH_CONFIDENCE_LABEL_HE: Record<MonthConfidence, string> = {
  'well-based': 'מבוסס היטב',
  estimate: 'הערכה',
  'rough-estimate': 'הערכה גסה',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D26/D40 — the gaps, each with its own sentence
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Why a category has no estimate. Three genuinely different sentences, never one shrug. */
export type StatisticalGapReason = 'no-history' | 'no-spend-observed' | 'unreadable-amounts';

export const STATISTICAL_GAP_REASON_HE: Record<StatisticalGapReason, string> = {
  // D26's own sentence for the `monthsObserved === 0` row, verbatim.
  'no-history': 'עוד אין מספיק היסטוריה להערכת הוצאות משתנות',
  'no-spend-observed': 'בקטגוריה הזו לא נצפתה הוצאה בחודשים שנקראו, ולכן אין בסיס להערכה',
  'unreadable-amounts': 'בקטגוריה הזו יש שורות שהסכום בהן לא ניתן לקריאה, ולכן אין בסיס להערכה',
};

/** A9's month: the horizon month with no recurring, loan or insurance charge at all. */
export const CERTAIN_LAYER_EMPTY_HE = 'אין תשלומים קבועים ידועים בחודש הזה';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D26 row 0 — the onboarding path's input names
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The inputs D26 row 0 lists by name. The ORDER they are listed in is `FORECAST_INPUT_ORDER` in
 * `forecast.ts` — that is a sequencing decision about onboarding, not a string.
 */
export type ForecastInputKey = 'accounts' | 'recurring' | 'incomes' | 'loans' | 'insurances' | 'history';

export const FORECAST_INPUT_LABEL_HE: Record<ForecastInputKey, string> = {
  accounts: 'יתרות חשבונות',
  incomes: 'הכנסות',
  recurring: 'הוצאות קבועות',
  loans: 'הלוואות',
  insurances: 'ביטוחים',
  history: 'היסטוריית הוצאות',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D33 — the row ceiling's sentence
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D33's explicit degradation, in words. The number of months offered instead is COMPUTED by
 * `historyWindowStateOf` and passed in — this function invents neither number.
 *
 * It is a template rather than a constant because the two figures are the whole point of the
 * sentence: "too many rows" without the count is a shrug, and "read a shorter window" without the
 * length is an instruction with no action in it.
 */
export function historyCeilingReasonHe(rowsReturned: number, suggestedWindowMonths: number): string {
  return (
    `טווח החודשים שנבחר מחזיר ${rowsReturned} שורות בקריאה אחת, יותר מהמותר לקריאה אחת. ` +
    `אפשר לקרוא טווח קצר יותר של ${suggestedWindowMonths} חודשים.`
  );
}
