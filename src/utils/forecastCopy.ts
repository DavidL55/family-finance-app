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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// !! HEBREW NUMBER AGREEMENT — T6 review, F7
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A count of months, in Hebrew that agrees with the number.
 *
 * `בתקופה של 1 חודשים` and `בתקופה של 2 חודשים` both SHIPPED and both are wrong: `MAX_HORIZON_MONTHS`
 * is 12 with a floor of 1, so a one-month and a two-month horizon are ordinary states, and only 3
 * was ever tested. Hebrew has a DUAL — `חודשיים` — and no numeral in front of it, and the singular
 * takes `חודש אחד` rather than a digit. A family reading "1 חודשים" on the one screen that tells
 * them what to do with money is reading a machine.
 *
 * ONE helper for every sentence in this module that counts months, because two copies of a
 * number-agreement rule agree until one of them is fixed.
 *
 * The two counts are NAMED CONSTANTS rather than literals, and that is not decoration: this module
 * declares seasonally-named exports and sits inside the forecast closure, so it is inside BAN C of
 * `monthLiteralGuard.test.ts` — an integer literal in a comparison operand here fails that guard.
 * Naming the constant is the guard's own stated remedy.
 */
const MONTHS_SINGULAR = 1;
const MONTHS_DUAL = 2;

export function monthsCountHe(months: number): string {
  if (months === MONTHS_SINGULAR) return 'חודש אחד';
  if (months === MONTHS_DUAL) return 'חודשיים';
  return `${months} חודשים`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D24 — what a seasonal factor says out loud
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The hover sentences D24 names, in both of a factor's two flavours.
 *
 * !! THE MONTH NAME IS A PARAMETER AND THE PERCENTAGE IS A PARAMETER, and neither is a coincidence.
 * The twelve Hebrew month names live in exactly one array (`src/config/hebrewMonths.ts`) because
 * D29(c)'s F4 rule says a map lives in one place; the no-month-literal guard enforces that this
 * module contains none of them. `direction` carries "more" vs "less" so a factor below 1 — which is
 * an ordinary thing for a family to assert about a quiet month — does not render as "expensive by
 * -20%".
 */
export function seasonalFactorObservedHe(input: {
  monthName: string;
  percent: number;
  n: number;
}): string {
  const direction = input.percent >= 0 ? 'יקר' : 'זול';
  // The demonstrative agrees too. `SEASONALITY_MIN_OBSERVATIONS` is 2, so the DUAL is the first
  // form a family could ever see here rather than an edge case; the singular is unreachable today
  // and is still written correctly, because a sentence builder that emits garbage on an input it
  // "cannot get" is a defect waiting for the constant to change.
  const suchMonths = input.n === MONTHS_SINGULAR ? 'חודש אחד כזה' : `${monthsCountHe(input.n)} כאלה`;
  return `${input.monthName} היה ${direction} ב-${Math.abs(input.percent)}% בממוצע, לפי ${suchMonths} בהיסטוריה.`;
}

export function seasonalFactorUserHe(input: { monthName: string; percent: number; authorName: string }): string {
  const direction = input.percent >= 0 ? 'יקר' : 'זול';
  return `${input.monthName} סומן ידנית כחודש ${direction} ב-${Math.abs(input.percent)}% על ידי ${input.authorName}.`;
}

/**
 * D24's floor, said plainly — a sentence for EVERY reason the observed half declines, not one
 * shrug for all three. `seasonalRefusalKindOf` is a total switch over the same union, so a fourth
 * refusal cannot reach the screen without a sentence: it fails to compile there first.
 *
 * `SeasonalRefusalKind` is not imported — this module imports nothing, by assertion — so the key
 * union is spelled here and `seasonality.test.ts` holds the two against each other.
 */
export const SEASONALITY_REFUSAL_HE: Record<
  'insufficient-observations' | 'no-baseline' | 'implausible-factor',
  string
> = {
  'insufficient-observations':
    'אין מספיק חודשים דומים בהיסטוריה כדי לזהות עונתיות, ולכן לא הוחלה שום התאמה עונתית',
  'no-baseline':
    'אין חודשים אחרים להשוות אליהם בקטגוריה הזו, ולכן לא הוחלה שום התאמה עונתית',
  'implausible-factor':
    'הפער בין החודש הזה לשאר החודשים גדול מכדי להיחשב עונתיות, ולכן לא הוחלה שום התאמה עונתית',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D29 — "מה צריך לקרות": the targets, the allowance, the refusal, and the boundary
// ─────────────────────────────────────────────────────────────────────────────────────────────

// !! D29(e)'s ADVICE-BOUNDARY NOTICE IS NOT HERE. It moved to `src/config/adviceBoundary.ts` in the
// T6 review (F10), and the module header there carries the argument: §9 pins the same sentence to
// Stage 8's insights screen, so a product-wide licensing boundary living in a FEATURE copy module
// leaves the next stage choosing between importing forecast copy and writing the sentence twice.
// `adviceBoundary.test.ts` also holds the PAIRING GUARD this notice shipped without.

/**
 * D29(b), second half — the levers that are NOT cutting.
 *
 * The allowance arithmetic can only express one move, because it is the only one it can compute:
 * spend less on the variable categories. Copy that stops there tells a family that cutting is the
 * only path, which is false, and the two other levers are ordinary and out of this task's scope
 * rather than unavailable. Saying so costs one line and stops the screen from being wrong.
 */
export const ALLOWANCE_OTHER_LEVERS_HE =
  'צמצום הוצאות אינו הכיוון היחיד — דחיית התחייבות אל מעבר לתקופה או הגדלת הכנסה משנות את התמונה גם הן.';

/** D29(c) — no readable target. A CALM STATE, and never an invented target. */
export const ALLOWANCE_NO_TARGET_HE =
  'לא הוגדר יעד לתקופה הזו, ולכן אין שורת "מה צריך לקרות"';

/** The target is already covered by the projection. Not an achievement, a fact. */
export const ALLOWANCE_TARGET_MET_HE = 'לפי הנתונים הקיימים התקופה מסתיימת מעל היעד';

/**
 * D29(c) — a `goals` document is OWNERLESS, so a target read from one is a FAMILY target even when
 * it appears on one member's screen. A per-member line stating a family goal must say so, or the
 * member reads it as their own and the allowance beneath it as their personal allowance.
 */
export const ALLOWANCE_FAMILY_GOAL_NOTE_HE = 'היעד הזה הוא יעד משפחתי, לא יעד אישי';

/**
 * D29(c) — unparseable goals are EXCLUDED WITH A VISIBLE COUNT, never silently dropped.
 *
 * `goals.date` is a Hebrew month-name string assembled by the goal form. Anything the form did not
 * write — a legacy row, a hand-edited document, a renamed month — cannot be placed on a calendar,
 * and a target silently missing from the arithmetic is a wrong allowance with no symptom.
 */
export function goalsExcludedHe(count: number): string {
  return `${count} יעדים לא נכללו בחישוב כי לא ניתן היה לקרוא מהם תאריך יעד`;
}

/**
 * D29(a) — THE REFUSAL, AND IT STATES ARITHMETIC RATHER THAN A VERDICT.
 *
 * v1's copy delivered a judgement ("the target is not achievable"), which a family hears as a
 * judgement about themselves. This gives them the three numbers and lets them conclude: what the
 * target needs, what the whole of the variable spend comes to, and what is still missing when the
 * variable spend is taken to zero.
 *
 * Every money value arrives ALREADY FORMATTED, because this module imports nothing (the split is
 * one-directional by assertion) and the app has exactly one money formatter. `months` is a count,
 * not a month.
 */
export function allowanceUnreachableHe(input: {
  targetText: string;
  months: number;
  flexibleTotalText: string;
  gapText: string;
}): string {
  return (
    `היעד דורש ${input.targetText} בתקופה של ${monthsCountHe(input.months)}. ` +
    `סך ההוצאות המשתנות שניתן לצמצם בתקופה הוא ${input.flexibleTotalText} — ` +
    `גם ללא שום הוצאה משתנה, הפער נשאר ${input.gapText}.`
  );
}

/**
 * The ordinal each named category is introduced with. Three, because D29(b) leads with two or
 * three names and a family does not execute a fourth.
 */
export const ALLOWANCE_RANK_WORDS_HE: readonly string[] = ['ראשונה', 'שנייה', 'שלישית'];

/**
 * D29(b) — THE LINE IS PHRASED AS "כדאי לבדוק", NOT AS AN INSTRUCTION.
 *
 * That is a decision and not a hedge. The arithmetic behind the row is a proportional share of a
 * shortfall against a moving average — it is a *reasonable place to look*, not a budget a family
 * has agreed to. Phrasing it as an instruction ("צמצמו ₪600 במסעדות") states a certainty the
 * computation does not have, on the one screen where being confidently wrong is most expensive.
 *
 * The row leads with the CATEGORY NAME and its SHEKEL SIZE, because "reduce every flexible
 * category by 12%" computes correctly and advises uselessly (A28) — one to three named moves is a
 * thing a family can execute, a table of twelve percentages is not.
 */
export function allowanceLeadHe(input: {
  categoryId: string;
  projectedText: string;
  rankWord: string;
  isLargest: boolean;
}): string {
  const size = input.isLargest ? 'הגדולה מבין המשתנות' : 'מהגדולות מבין המשתנות';
  return `קטגוריית '${input.categoryId}' היא ${size} — ${input.projectedText} בתקופה. כדאי לבדוק אותה ${input.rankWord}.`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D28 — the calibration snapshot's empty state
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D28's own sentence. Calibration needs a projection for a month that has since ELAPSED, and the
 * first snapshot is written at the first computation after this stage ships — so there is no month
 * in Stage 7 for which both a projection and an actual exist. The screen says that instead of
 * showing a zero, which is the `unusableRowCount` defect the gate rejected, avoided by design.
 */
export const CALIBRATION_NOT_ENOUGH_TIME_HE =
  'עוד אין מספיק זמן כדי לבדוק את דיוק התחזית — המדידה הראשונה תופיע בסוף החודש הבא';
