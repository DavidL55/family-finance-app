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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7a / D38 — WHAT THE DASHBOARD CARD SAYS
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// D38's card carries a label, a figure, a reference, a verdict and a horizon. Every sentence below
// is a BUILDER taking pre-formatted money text rather than a number, for the reason this module's
// header already gives: it imports nothing, so it cannot reach `formatILS`, and a second formatting
// rule living here is how two surfaces start disagreeing about what ₪1,234.5 looks like.
//
// D34 binds all of it: NO SECOND PERSON, anywhere. Not "אתה צפוי", not "היעד שלך" — the sentences
// are statements about data, and `forecastCopy.test.ts` holds that with a TOKENISED check, because
// JavaScript's `\b` does not word-break Hebrew and the regex form of that guard was shadowed.

/** D38's three verdict states. Declared HERE, beside their words, and re-exported by `forecast.ts`. */
export type BalanceVerdict = 'positive' | 'near-zero' | 'negative';

/**
 * The word that carries the verdict when colour cannot.
 *
 * !! COLOUR IS NEVER THE ONLY SIGNAL, and that is D38's requirement rather than a nicety: the
 * negative state is the most important thing this card can ever render, and a reader who cannot
 * separate teal from amber — or who is looking at a printout — gets the same three-way answer from
 * the words alone.
 *
 * `צפוי חוסר` is not an exact member of `PROBABILITY_LABEL_FORMS` and is not meant to be: that tier-2
 * ban is scoped to band, scenario and confidence NAMES, and `צפוי` is ordinary Hebrew for
 * "expected". A verdict is not a scenario name.
 */
export const BALANCE_VERDICT_LABEL_HE: Record<BalanceVerdict, string> = {
  positive: 'יתרה חיובית',
  'near-zero': 'כמעט מאוזן',
  negative: 'צפוי חוסר',
};

/**
 * D38 element 1 — the label, and it is part of the GLANCE rather than a caption.
 *
 * The month named is the LAST month of the horizon, because that is the month the figure is about.
 * A label naming the first month beside a figure covering three is the "% of what?" defect one
 * dimension over.
 */
export function forecastBalanceLabelHe(monthName: string): string {
  return `צפוי להישאר בסוף ${monthName}`;
}

/**
 * D38 element 3 — the reference. Stage 6's own fix, quoted in the plan: *a spend with no
 * denominator is the "% of what?" problem.* A balance with no income beside it is the same problem.
 */
export function forecastIncomeReferenceHe(incomeText: string): string {
  return `מתוך ${incomeText} שנכנסים`;
}

/** D38 element 4 — the designed negative state, with the amount stated rather than only coloured. */
export function forecastShortfallHe(shortfallText: string): string {
  return `${BALANCE_VERDICT_LABEL_HE.negative} של ${shortfallText}`;
}

/**
 * D38 element 5 — the horizon, in words.
 *
 * `monthsCountHe` rather than a second agreement rule, and the month name is a parameter for the
 * same reason every other sentence here takes one: the twelve names live in one array and BAN A
 * keeps them out of this module.
 */
export function forecastHorizonHe(input: { months: number; startMonthName: string }): string {
  return `${monthsCountHe(input.months)} קדימה, מ${input.startMonthName}`;
}

/**
 * D32(a)'s clamp sentence, rendered only when the clamp actually fired.
 *
 * Silent back-projection was ruled the only unacceptable option, so the alternative — honouring a
 * past anchor invisibly — is not available either. The card says which of the two happened.
 */
export const FORECAST_ANCHOR_CLAMPED_HE =
  'התחזית מתחילה מהחודש הנוכחי. חודש שכבר עבר אינו נחזה אחורה.';

/**
 * D38's single-line committed summary — the whole of the certain/estimated split that reaches the
 * CARD.
 *
 * A19 listed the split as a fifth card element and v2 departed from it (§15): five text elements at
 * subordinate scale on a phone is not a glance. The split lands on the BAR in T7b, where position
 * carries it; here it is four words and one number.
 */
export function forecastCommittedHe(committedText: string): string {
  return `${committedText} מזה כבר סגור`;
}

/**
 * `'חסר נתון אחד'` / `'חסרים שני נתונים'` / `'חסרים N נתונים'`.
 *
 * !! THE VERB IS INSIDE THE PHRASE, and that is the whole reason this is not a bare count word.
 * Hebrew agrees the verb with the noun's number, so a fixed `חסרים` in front of a swapped count
 * produces `חסרים נתון אחד` — plural verb, singular noun — which is the exact defect
 * `monthsCountHe` exists to prevent one sentence over, and which the first draft of this module
 * shipped until a card test read the sentence out loud.
 */
const INPUTS_SINGULAR = 1;
const INPUTS_DUAL = 2;

export function missingInputsCountHe(count: number): string {
  if (count === INPUTS_SINGULAR) return 'חסר נתון אחד';
  if (count === INPUTS_DUAL) return 'חסרים שני נתונים';
  return `חסרים ${count} נתונים`;
}

/**
 * D17's gap sentence — GENERATED from the suppressed set, never written out.
 *
 * That is how v1's unimplemented promise to "name which inputs were unreadable" is finally
 * delivered: the sentence cannot say "two inputs" while the list shows three, because both come off
 * the same array.
 *
 * !! IT IS A DATA STATEMENT AND NOT A REBUKE (A26/Ofra M3). v1's version was "אין לך הרשאה", which
 * reads as a rebuke to a child and is also usually FALSE — the measured corpus is missing these
 * inputs for everyone, by absence, not by permission. This sentence says what is missing and stops.
 *
 * The deep links D26 requires are the CARD's job, not this string's: a sentence cannot carry a
 * navigation payload, and T7b turns each named input into its create form.
 */
export function balanceGapHe(inputLabels: readonly string[]): string {
  return `לא ניתן להציג יתרה צפויה — ${missingInputsCountHe(inputLabels.length)}: ${inputLabels.join(', ')}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D38 / D29(d) — the `'own'` card, which must not reuse the family slot
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The `'own'` glance prefix, and it is part of the GLANCE line rather than a caption.
 *
 * !! OPPOSITE SIGN SEMANTICS IN THE SAME PLACE IS THE MOST DANGEROUS MISREAD IN THIS STAGE. The
 * family card shows money that will be LEFT; this shows money that will GO OUT. The same number in
 * the same slot means opposite things, so the words say which one this is before the figure is
 * read, and the card sits in its own panel below the family row rather than inside it.
 */
export const FORECAST_OWN_OUTGOING_LABEL_HE = 'צפוי לצאת';

/**
 * D29(d) — why no personal income appears on the `'own'` card.
 *
 * Rendering owned recurring income beside outgoings with no balance line invites the reader to do
 * the subtraction in their head, and get it wrong for exactly the reason D17 refuses to draw the
 * balance at all. So it is absent, and one line says why rather than leaving a hole a reader
 * explains to themselves.
 */
export const FORECAST_OWN_NO_INCOME_HE =
  'ההכנסות מנוהלות ברמת המשפחה, ולכן אינן מוצגות כאן ואין כאן חישוב יתרה';

/**
 * D29(d)'s personal target, NAMED rather than subtracted.
 *
 * !! THE ARITHMETIC D38 IMPLIES IS NOT AVAILABLE, and this is the one place T7a departs from a
 * drawn decision rather than implementing it. D38 offers `נשאר להוציא: ₪1,800` where a
 * `personalTarget` exists. A `personalTarget` is SAVINGS-SHAPED — the T6 review established that
 * when it removed `settings/budgetConfig` as a target source precisely because a spend cap has the
 * opposite sign in `shortfall = target − projected` — so "how much is left to spend" against it
 * needs the member's projected INCOME, which `incomes` is ownerless and structurally denies to an
 * `'own'` viewer, and which D29(d) forbids rendering in this panel anyway.
 *
 * So the target is stated as what it is, beside the outgoing figure, and the two are NOT subtracted
 * from one another. Refusing an arithmetic whose inputs are not both available is the same
 * discipline D17 applies to the family balance, one screen down.
 */
/**
 * D26's path, for the ONE missing input that has no screen to link to.
 *
 * `MODULE_REGISTRY` has no `incomes` tab (finding 1.3.11) — the collection has no screen, no
 * service and no owner. But it is not unreachable either: the Dashboard's own income section is
 * where a family already edits it. So the gap says where to go rather than offering a link that
 * goes nowhere, which is the difference between an onboarding path and an apology.
 */
export const FORECAST_INCOMES_EDITED_HERE_HE = 'ההכנסות נערכות בקטע ההכנסות שבלוח התצוגה';

export function forecastOwnTargetHe(targetText: string): string {
  return `יעד חיסכון אישי לתקופה: ${targetText}`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 7 T7b — THE FULL SCREEN
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything below is rendered by `ForecastScreen.tsx` / `ForecastChart.tsx` and by the one line
// of `Dashboard.tsx` D30 rewrites. It lives here, not in the components, for the reason this
// module's header already gives: `forecastCopy.test.ts` derives EVERY Hebrew literal in this file
// and holds each one against the tier-1 probability ban, the percentage ban and D34's
// second-person ban. A sentence written inline in a component is a sentence none of those see.

/**
 * D30 — the replacement for `תזרים מזומנים חודשי`, which `plainLanguage.ts` bans and
 * `Dashboard.tsx` renders anyway.
 *
 * The ruling is "fix the screen", not "weaken the ban": `plainLanguage.ts` is untouched. It is a
 * NAME AND A SENTENCE rather than a description — Ofra's M3 — because a heading replaced by a
 * definition reads as a caption and stops being a heading.
 *
 * !! IT LIVES IN THIS MODULE THOUGH THE HEADING IS THE DASHBOARD'S. The word was banned in
 * `plainLanguage.ts` and rendered in a component, and nothing connected the two — D30's own
 * finding, and the reason it went unnoticed for six stages. Putting the replacement inside the one
 * module whose literals are derived and checked is what makes the replacement itself checkable.
 */
export const CASH_FLOW_LABEL_HE = 'כסף נכנס ויוצא';
export const CASH_FLOW_SENTENCE_HE = 'כמה כסף צפוי להיכנס ולצאת בכל חודש בטווח שנבחר.';

/** The screen's own name, matching the registry label so the tab and the `<h1>` cannot drift. */
export const FORECAST_SCREEN_TITLE_HE = 'תחזית';
export const FORECAST_SCREEN_SUBTITLE_HE =
  'מה ידוע כבר על החודשים הבאים, ומה מוערך מתוך מה שהיה. כל מספר מסומן לפי מקורו.';

/** D26 row 0 — the onboarding heading. A path, not an apology; the count is the glance figure. */
export const FORECAST_ONBOARDING_TITLE_HE = 'כדי לחשב תחזית חסרים עוד נתונים';
export const FORECAST_ONBOARDING_SENTENCE_HE =
  'כל נתון חסר נפתח למסך שבו מזינים אותו. אחרי שיוזן, החישוב יופיע כאן.';

/** The horizon control (D32) — forecast-local, deliberately not part of the global filters. */
export const FORECAST_HORIZON_CONTROL_LABEL_HE = 'טווח התחזית';

/**
 * D39's accessible name for one month's bar. The reader gets a SENTENCE, which is what a texture
 * could never give — and the boundary label on screen says the same thing in four words.
 */
export function forecastMonthAccessibleNameHe(input: {
  monthName: string;
  totalText: string;
  committedText: string;
}): string {
  return `${input.monthName}: ${input.totalText} סך הכל, מזה ${input.committedText} כבר סגור`;
}

/**
 * D40's accessible name, for a month whose statistical layer is ABSENT.
 *
 * A separate sentence rather than the one above with a zero in it: "מזה ₪0 כבר סגור" and "אין
 * היסטוריה להעריך ממנה" are different facts, and the whole of D40 is that the second must never
 * be drawn as the first.
 */
export function forecastMonthGapAccessibleNameHe(input: {
  monthName: string;
  committedText: string;
}): string {
  return `${input.monthName}: ${input.committedText} סגור. הוצאות משתנות — ${STATISTICAL_GAP_REASON_HE['no-history']}.`;
}

/**
 * D39's per-bar `insufficient-history` marker, as a chip and NOT as a paragraph under the chart.
 *
 * `n=2` was A22's own shorthand and is not shippable Hebrew, so the chip carries the month count in
 * words — through `monthsCountHe`, which already has the singular and the dual.
 */
export function historyDepthChipHe(monthsObserved: number): string {
  return `לפי ${monthsCountHe(monthsObserved)}`;
}

/** D36's one drill — from a month's estimated variable spend to the rows the average came from. */
export const FORECAST_DRILL_LABEL_HE = 'לשורות שמאחורי ההערכה';

/**
 * D13/§11 — `unusableRowCount` is LEDGER-WIDE and the sentence has to say so.
 *
 * `'unknown'` is one of the seven `in` values on EVERY window, so changing מתי does not change this
 * number. Without the clause a reader concludes the months they selected are damaged when they are
 * not — the figure invites exactly that reading, and only the copy can refuse it.
 */
export function unusableRowsHe(count: number): string {
  return `${count} שורות שתאריך שלהן לא ניתן לקריאה — בכל ההיסטוריה, לא רק בטווח שנבחר`;
}

/**
 * R1 — the loan/insurance double count, DISCLOSED rather than excluded (D23's ruling).
 *
 * A loan repayment leaves the bank account as an ordinary row too, so the same shekel can sit in
 * the contractual layer and inside the moving average. There is no discriminator on those rows to
 * exclude them by, which is why this is a sentence and not a filter.
 */
export const LOAN_INSURANCE_DOUBLE_COUNT_HE =
  'תשלום הלוואה או ביטוח יוצא גם כשורה רגילה בחשבון, ולכן ייתכן שהוא נספר גם בהערכת ההוצאות המשתנות. אין בשורות סימן שמאפשר להפריד אותן, ולכן הן מוצגות ולא מוסרות.';

/**
 * D10/D23 — the INSTALMENT double count. A different problem from the one above, and smaller.
 *
 * The tree's own measurement, handed forward by the T5 review and again by T7a: D23 excludes rows
 * carrying a `recurringId` and rules on nothing else, so a credit plan's ALREADY-CHARGED rows stay
 * inside the moving average while `projectInstalmentsForward` projects the payments still to come.
 * The two do not overlap in the same month — past instalments and future ones are different
 * charges — but the AVERAGE built from those past months is applied to every future month, so the
 * plan is counted once as a contract and a second time inside the estimate.
 *
 * Unlike the loan case this one HAS a discriminator (`installmentNumber`), so it is excludable in
 * principle. It is not excluded here because D23 rules only on `recurringId`, and widening an
 * engine rule from a screen is how a plan and a tree stop describing the same app. Disclosed, with
 * the direction of the error named — a family can act on "the estimate is a little high", and
 * cannot act on "there may be an inaccuracy".
 */
export const INSTALMENT_DOUBLE_COUNT_HE =
  'תשלומי תשלומים שכבר נגבו נכללים גם בממוצע ההוצאות המשתנות, ובנוסף התשלומים שנותרו מוצגים בנפרד כתשלום ידוע. לכן הערכת ההוצאות המשתנות עשויה להיות גבוהה מעט מהמציאות.';

/**
 * D10 — the `planKey` heuristic, in the words a family reads rather than in the guard comment.
 *
 * There is NO plan id in the data. Two identical-looking plans from one vendor merge into one, and
 * the output is then knowably wrong. §11 requires this as a glossary entry for the same reason: in
 * this app hover copy IS a glossary entry, and `Explain` renders nothing for an id nobody wrote.
 */
export const INSTALMENT_PLAN_KEY_CAVEAT_HE =
  'לתשלומים אין מספר תוכנית בנתונים, ולכן הזיהוי נעשה לפי בית העסק, מספר התשלומים והסכום. שתי תוכניות זהות באותו בית עסק ייספרו כתוכנית אחת.';

/**
 * D19/D2 — an assumption that displaced a CONTRACTUAL item, and the number that goes DOWN as a
 * result.
 *
 * !! THIS IS THE COPY THAT STOPS A CORRECT NUMBER READING AS A BUG. An assumption overriding a
 * contractual item removes that item from `certainILS`, so `מזה כבר סגור` reports LESS after an
 * override than before it — pinned by T7a's review, correct, and indistinguishable from a defect on
 * first reading. The sentence names the mechanism in the same breath as the figure.
 *
 * !! IT NAMES THE DISPLACED ITEM AND NOT ITS AMOUNT, WHICH IS A DEPARTURE FROM D19. D19 says an
 * override of a certain item "shows both numbers and names what was overridden". The second half is
 * buildable and the FIRST IS NOT: `overrides` is a stack of `ForecastBasis` values, and no member of
 * that union carries an amount — a loan basis holds `loanId`/`name`, an insurance basis
 * `insuranceId`/`provider`, and so on. The displaced line item is gone by the time the resolver has
 * finished, so the previous figure is not reachable from what the screen is handed.
 *
 * Rendering `₪—` in its place would be worse than saying nothing: it would put a missing number
 * where the sentence promises a real one. So the sentence names the item — which the basis DOES
 * carry, precisely and per kind — and the departure is declared in this task's report rather than
 * left as a dash on the screen.
 */
export function assumptionOverrideCertainHe(input: {
  categoryId: string;
  displacedName: string;
  assumedText: string;
}): string {
  return (
    `בקטגוריית '${input.categoryId}' נקבע ידנית ${input.assumedText} במקום ${input.displacedName} שהיה ידוע מראש. ` +
    `סכום שנקבע ידנית אינו נספר עוד כתשלום ידוע, ולכן הסכום שכבר סגור קטן יותר.`
  );
}

/** The quieter half of the same ruling: an assumption over a STATISTICAL item gets one line. */
export function assumptionOverrideStatisticalHe(input: { categoryId: string; assumedText: string }): string {
  return `בקטגוריית '${input.categoryId}' נקבע ידנית ${input.assumedText} במקום ההערכה מההיסטוריה.`;
}

/** D25 — no assumption exists yet. A calm state, and the one that says what an assumption is for. */
export const FORECAST_NO_ASSUMPTIONS_HE =
  'עדיין לא נקבעו סכומים ידנית. סכום שנקבע ידנית גובר על ההערכה מההיסטוריה ועל תשלום ידוע מראש.';

/**
 * D24/A31 — the seasonality offers, and the one that changes NOTHING.
 *
 * !! MEASURED, NOT ASSUMED. The T6 review drove an accepted offer end to end through
 * `buildStatisticalLayer` and measured the SEPTEMBER offer INERT on the demo corpus: its category
 * is the education category, `n = 0` by construction, so the layer holds no estimate for it and
 * accepting the offer moves not one line item. That was handed to T7b as a PRODUCT requirement —
 * the accept surface must not offer a factor for a category the layer cannot apply it to, or must
 * say what accepting will do. This is the second half: the offer stays visible (retiring it would
 * hide a real seasonal fact about September from a family who will have education spending later),
 * and it says outright that nothing on the screen will move today.
 */
export function seasonalityOfferInertHe(input: { monthName: string; categoryId: string }): string {
  return (
    `אין עדיין הוצאות בקטגוריית '${input.categoryId}', ולכן אישור ההתאמה ל${input.monthName} לא ישנה אף מספר במסך הזה כרגע. ` +
    `ההתאמה תישמר ותחול ברגע שיהיו הוצאות בקטגוריה.`
  );
}

/** The live half of the same surface — an offer whose category the layer does hold an estimate for. */
export function seasonalityOfferLiveHe(input: { monthName: string; categoryId: string; percent: number }): string {
  const direction = input.percent >= 0 ? 'גבוהה' : 'נמוכה';
  return `אישור ההתאמה יקבע את ההערכה ל${input.monthName} בקטגוריית '${input.categoryId}' כ${direction} ב-${Math.abs(input.percent)}%.`;
}

export const SEASONALITY_OFFERS_TITLE_HE = 'התאמות עונתיות מוצעות';
export const SEASONALITY_OFFER_ACCEPT_HE = 'אישור ההתאמה';
export const SEASONALITY_OFFERS_NONE_HE = 'אין כרגע התאמות עונתיות שממתינות לאישור';

/**
 * D21(b)/מי — the sentence that says WHOSE forecast this is.
 *
 * The מי selection re-resolves the whole computation to one member (see
 * `narrowForecastScopesToMember`), so the figures on the screen stop being the family's. A figure
 * whose subject changed silently is the misread D38 spends three signals defending against, one
 * dimension over.
 */
export function forecastMemberScopeNoteHe(memberName: string): string {
  return `התחזית מחושבת עבור ${memberName} בלבד, לפי בחירת מי שלמעלה.`;
}

/** Section headings. Plain nouns; the explanations hang off `<Explain>` beside each figure. */
export const FORECAST_MONTHS_TITLE_HE = 'חודש אחר חודש';
export const FORECAST_CERTAIN_TITLE_HE = 'תשלומים ידועים מראש';
export const FORECAST_ESTIMATED_TITLE_HE = 'הוצאות משתנות — הערכה מההיסטוריה';
export const FORECAST_ASSUMPTIONS_TITLE_HE = 'סכומים שנקבעו ידנית';
export const FORECAST_ALLOWANCE_TITLE_HE = 'מה צריך לקרות';
export const FORECAST_CALIBRATION_TITLE_HE = 'דיוק התחזית';

/** One itemised contractual row's own name, so a reader sees WHAT is committed, not only how much. */
export const CERTAIN_BASIS_LABEL_HE: Record<'recurring' | 'loan' | 'insurance' | 'installment', string> = {
  recurring: 'הוצאה קבועה',
  loan: 'הלוואה',
  insurance: 'ביטוח',
  installment: 'תשלומים',
};

/**
 * T7b — the card's open affordance, which T7a deliberately shipped without.
 *
 * A noun phrase, not an instruction ("לתחזית המלאה", never "פתח את התחזית") — D34's rule applies to
 * a button label exactly as it applies to a sentence, and an imperative is the form second person
 * most often hides in.
 */
export const FORECAST_OPEN_SCREEN_HE = 'לתחזית המלאה';
