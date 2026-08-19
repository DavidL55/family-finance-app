// src/utils/seasonality.ts — Stage 7 T6, D24. SEASONALITY IS AN ASSUMPTION, NOT A SETTINGS DOCUMENT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS MODULE EXISTS AT ALL — AND WHY THE DOCUMENT IT REPLACES WAS DANGEROUS
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// v1 put seasonality in `settings/seasonality`. Two things were wrong with that, and each on its
// own is fatal:
//
//   · `settings/{docId}` is **write: super-admin or parent only** (`firestore.rules`). So v1's
//     "user-authored, one-click" seasonality was PERMISSION-DENIED for exactly the member holding
//     the `forecast: family` grant that had been invented for it.
//   · that block has **no value validator** for any doc but `aiCostConfig`. A `factor: 1e9` would
//     have been accepted and silently multiplied into a displayed number — Stage 6's F1 verbatim,
//     on a document whose corrupt value scales money on the glance screen.
//
// `forecast_assumptions` already has ownership, a write gate, a value validator (`factor` bounded
// by `SEASONAL_FACTOR_MIN`/`MAX` in Rules) and an audit trail. So `scopeKind: 'seasonality'` is the
// whole mechanism, and this module is the arithmetic beside it.
//
// ── THE TWO HALVES, AND WHICH ONE ACTUALLY RUNS ───────────────────────────────────────────────
//
// D24 gives seasonality two sources and they are NOT symmetric:
//
//   OBSERVED — derived from the family's own history, and it needs **n ≥ 2 observations of the same
//   calendar month**, i.e. roughly fourteen months of ledger. The statistical layer reads a window
//   of `LOOKBACK_MONTHS_MAX` periods, so two Septembers cannot both be inside it. **This half
//   cannot fire from the layer today**, and `seasonality.test.ts` asserts that arithmetic rather
//   than leaving it as a claim. It is built, unit-tested and wired so the day the window widens is
//   a config change and not a feature.
//
//   USER-AUTHORED — first class, and the half that works on day one. A31 ruled that the
//   September/April factors §10 names ship **offered, pre-filled, one-click-accept, attributed and
//   editable**, and that the plan decides this rather than deferring it. `SEASONALITY_OFFERS` and
//   `offeredSeasonalityAssumptions` are that ruling.
//
// ── WHY THE OBSERVED HALF'S UNREACHABILITY IS A FEATURE OF THE DESIGN, NOT AN EMBARRASSMENT ───
//
// D26's cold-start table says a `'thin-history'` row has NO seasonality, and `coldStartBehaviourOf`
// encodes that as `seasonalityAllowed`. That could have become a second gate here — and a second
// gate is how a predicate gets shadowed, because whichever one fires first hides the other. It is
// not needed: n ≥ 2 same-calendar-months implies at least thirteen periods of history, which is
// past every row of that table. So the observed half can only ever fire where seasonality is
// already allowed, BY ARITHMETIC. The test says so.
//
// A user factor is deliberately NOT gated on `seasonalityAllowed`. It is the family's own explicit
// statement about their own money, `SeasonalFactor.source` carries `'user'` so the hover says which
// it is, and gating it behind three months of history would refuse a member's assertion on the
// grounds that we have not yet independently confirmed it.
//
// ── PURITY ────────────────────────────────────────────────────────────────────────────────────
//
// In `forecast.ts`'s transitive closure, so `forecastPurity.test.ts` walks it: no I/O, no Firebase,
// no clock. Time enters as `'YYYY-MM'` strings.
import { MONTH_KEY_APRIL, MONTH_KEY_PATTERN, MONTH_KEY_SEPTEMBER } from '../config/hebrewMonths';
import { comparePeriod, isPeriod, monthKeyOf } from './periodMath';
import { CATEGORY_MAP } from './categoryMap';
import { SEASONAL_FACTOR_MAX, SEASONAL_FACTOR_MIN, type ForecastAssumption } from '../types/finance';

/**
 * D24: a seasonal multiplier ALWAYS names where it came from and how many months backed it.
 *
 * MOVED HERE FROM `forecast.ts` IN T6, and the move is load-bearing rather than tidy. The
 * no-month-literal guard derives its integer-ban scope from the tree by finding the modules that
 * DECLARE a seasonally-named export; leaving `SeasonalFactor` declared in `forecast.ts` would drag
 * that module into the scope, where `months < 1` and `monthsObserved >= 1` are integer literals in
 * 1..12 that are not months — the guard would be born red on constants the ledger warned about by
 * name. The engine re-exports the type, so every existing import site is unchanged — the re-export
 * moved from `forecast.ts` to `forecastBasis.ts` in T7c's split, with the `ForecastBasis` union
 * that names it, and `monthLiteralGuard.test.ts` asserts that all three engine modules are outside
 * the scope rather than just the one this paragraph used to name.
 *
 * `n` is the number of same-calendar-month observations behind an `'observed'` factor. A `'user'`
 * factor reports `0`: it is backed by a member's statement, not by months, and reporting a month
 * count for it would put a number of observations behind a figure that has none.
 */
export interface SeasonalFactor {
  factor: number;
  source: 'observed' | 'user';
  n: number;
}

/**
 * D24's floor on the observed half. Two observations of the same calendar month, and they must be
 * two DIFFERENT months of the ledger — see `observedSeasonalFactor` for why that distinction is the
 * one that matters.
 */
export const SEASONALITY_MIN_OBSERVATIONS = 2;

/** D24's `scopeId` shape is `${categoryId}:${monthKey}`. The separator, named once. */
export const SEASONALITY_SCOPE_SEPARATOR = ':';

export interface SeasonalityScope {
  categoryId: string;
  monthKey: string;
}

export function seasonalityScopeId(categoryId: string, monthKey: string): string {
  return `${categoryId}${SEASONALITY_SCOPE_SEPARATOR}${monthKey}`;
}

/**
 * Reads a scope id back into its pair, or `null`.
 *
 * !! SPLIT AT THE **LAST** SEPARATOR. A category id is free text an extractor stamped, and a colon
 * inside it is ordinary (`'ספורט: חוגים'`). Splitting at the first separator truncates the category
 * and reads the remainder as a month key — the assumption is then filed against a category that
 * does not exist and is silently never applied, which is the worst available failure: stored,
 * listed on screen, and inert.
 *
 * The month key is validated against `MONTH_KEY_PATTERN`, the same expression the config module
 * uses, so `'9'`, `'13'` and `'00'` are refused rather than becoming buckets no period can produce.
 */
export function parseSeasonalityScopeId(scopeId: unknown): SeasonalityScope | null {
  if (typeof scopeId !== 'string') return null;
  const cut = scopeId.lastIndexOf(SEASONALITY_SCOPE_SEPARATOR);
  if (cut <= 0) return null; // no separator, or an empty category id
  const categoryId = scopeId.slice(0, cut);
  const monthKey = scopeId.slice(cut + SEASONALITY_SCOPE_SEPARATOR.length);
  if (!MONTH_KEY_PATTERN.test(monthKey)) return null;
  return { categoryId, monthKey };
}

/**
 * One category's total in one period — exactly what the statistical layer already computes per
 * category (`periods` × `monthlyTotalsILS`), so the observed derivation reads the same numbers the
 * average is built from rather than re-reading the ledger.
 */
export interface SeasonalObservation {
  categoryId: string;
  period: string;
  totalILS: number;
}

export type ObservedSeasonalResult =
  | { status: 'factor'; factor: SeasonalFactor }
  | { status: 'insufficient-observations'; n: number }
  | { status: 'no-baseline' }
  | { status: 'implausible-factor'; factor: number };

/** Two decimal places, the same precision a stored factor is authored at. */
function roundFactor(value: number): number {
  return Math.round(value * FACTOR_PRECISION) / FACTOR_PRECISION;
}
const FACTOR_PRECISION = 10000;

/**
 * The observed seasonal index for one category and one calendar month.
 *
 * ── THE THREE THINGS THIS REFUSES, AND WHY EACH IS ITS OWN BRANCH ─────────────────────────────
 *
 *  1. **n < 2** (D24, stated). One expensive September over a five-month baseline produces a
 *     perfectly plausible `1.8` that is a single receipt wearing a decimal point. `n` counts
 *     DISTINCT PERIODS, not rows: two September receipts are one September.
 *  2. **no baseline.** The divisor is the mean of the OTHER calendar months, so a category observed
 *     only in September has nothing to be seasonal RELATIVE TO. Dividing by zero yields `Infinity`,
 *     which multiplies a real amount into a real-looking `Infinity` on screen.
 *  3. **an implausible factor.** Rules bound a STORED factor to `SEASONAL_FACTOR_MIN`/`MAX` because
 *     D24 puts value bounds where they are enforced. Nothing bounds a DERIVED one — and the shapes
 *     that produce a five-figure index (a corrupt amount, a category that changed meaning) are
 *     exactly the shapes that must not silently scale a number. It is REFUSED and not CLAMPED: a
 *     clamped 5 is a fabricated factor presented as a measured one.
 *
 * ── WHY THE BASELINE IS THE OTHER MONTHS AND NOT THE WHOLE CATEGORY ───────────────────────────
 *
 * D24's hover sentence is "ספטמבר היה יקר ב-30%" — more expensive **than a normal month**. A
 * whole-category mean includes September in its own divisor, which answers a different question and
 * is bounded above by the ratio of period counts (with two Septembers in six months it can never
 * exceed 3), so a genuinely corrupt month could never reach the implausibility ceiling.
 */
export function observedSeasonalFactor(
  categoryId: string,
  monthKey: string,
  observations: SeasonalObservation[]
): ObservedSeasonalResult {
  const sameMonth = new Map<string, number>();
  const otherMonths = new Map<string, number>();
  for (const observation of observations) {
    if (observation.categoryId !== categoryId) continue;
    // A malformed period is SKIPPED rather than allowed to reach `monthKeyOf`, whose contract is to
    // refuse. `'unknown'` is a real stamped value (D21c) and an unstamped row has no period at all;
    // both are rows this derivation has nothing to say about, not errors in the caller.
    if (!isPeriod(observation.period)) continue;
    if (!Number.isFinite(observation.totalILS)) continue;
    const bucket = monthKeyOf(observation.period) === monthKey ? sameMonth : otherMonths;
    // KEYED BY PERIOD, so two receipts in one September are ONE observation. Counting rows would
    // make every category with a busy month "seasonal".
    bucket.set(observation.period, (bucket.get(observation.period) ?? 0) + observation.totalILS);
  }

  const n = sameMonth.size;
  if (n < SEASONALITY_MIN_OBSERVATIONS) return { status: 'insufficient-observations', n };

  const baseline = meanOf([...otherMonths.values()]);
  if (baseline === null || !(baseline > 0)) return { status: 'no-baseline' };

  const monthMean = meanOf([...sameMonth.values()]);
  if (monthMean === null) return { status: 'no-baseline' };

  const factor = roundFactor(monthMean / baseline);
  if (!Number.isFinite(factor) || factor < SEASONAL_FACTOR_MIN || factor > SEASONAL_FACTOR_MAX) {
    return { status: 'implausible-factor', factor };
  }
  return { status: 'factor', factor: { factor, source: 'observed', n } };
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Whether a stored `factor` is one this app will multiply by.
 *
 * !! RULES ARE NOT ALREADY-ENFORCED HERE, AND THAT IS NOT BELT-AND-BRACES. Every seeder, migration
 * and script in this repo runs on the Admin SDK, which BYPASSES Rules entirely — the demo corpus
 * generator writes `forecast_assumptions` that way. So a document carrying `factor: 1e9` is
 * reachable without any client ever having been allowed to write one, and the client is the half
 * that multiplies.
 */
function usableStoredFactor(assumption: ForecastAssumption): number | null {
  const factor = assumption.factor;
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return null;
  if (factor < SEASONAL_FACTOR_MIN || factor > SEASONAL_FACTOR_MAX) return null;
  return factor;
}

/**
 * The user-authored factor for one category in one period, or `null`.
 *
 * The scope is (category, MONTH OF YEAR) — not (category, period). An assumption saying "September
 * is expensive" is a statement about Septembers, so it applies in every one of them; reading it as
 * a statement about `2026-09` alone would make it expire silently after a year, which is the sort
 * of thing nobody notices until the following autumn.
 *
 * `fromPeriod`/`toPeriod` still bound it, inclusively, because they are how a family says "from now
 * on" or "only until the loan ends".
 *
 * ── COLLISIONS ────────────────────────────────────────────────────────────────────────────────
 *
 * Two active assumptions can name the same (category, month). D20's total order is the rule:
 * newest `updatedAt`, then `id` ascending. It is applied HERE rather than through
 * `resolveLayerPrecedence` because a seasonality assumption never enters a (period, category)
 * precedence bucket at all — `resolveCategoryOfScope('seasonality', …)` returns `null` deliberately,
 * since a multiplier with no `amountILS` that WON a bucket would replace the estimate with ₪0.
 * Shuffling the input cannot change the answer; the test asserts both orders.
 */
export function userSeasonalFactor(
  categoryId: string,
  period: string,
  assumptions: ForecastAssumption[]
): SeasonalFactor | null {
  const monthKey = monthKeyOf(period);
  const candidates = assumptions.filter((assumption) => {
    if (assumption.scopeKind !== 'seasonality') return false;
    if (assumption.status !== 'active') return false;
    const scope = parseSeasonalityScopeId(assumption.scopeId);
    if (scope === null) return false;
    if (scope.categoryId !== categoryId || scope.monthKey !== monthKey) return false;
    if (!isPeriod(assumption.fromPeriod) || comparePeriod(period, assumption.fromPeriod) < 0) return false;
    if (assumption.toPeriod !== undefined) {
      if (!isPeriod(assumption.toPeriod) || comparePeriod(period, assumption.toPeriod) > 0) return false;
    }
    // !! THE BOUND IS CHECKED IN THE FILTER *AND* ON THE WINNER, AND THE SWEEP FOUND OUT WHY.
    // Dropping it here survived, because the winner is re-checked below and a lone out-of-range
    // assumption still yields `null` either way. It stops being equivalent the moment TWO
    // assumptions collide on one (category, month): an out-of-range one with the newer `updatedAt`
    // would WIN the tiebreak and then be refused, suppressing a perfectly good older factor. The
    // filter is what keeps a corrupt document from silently deleting a valid one.
    return usableStoredFactor(assumption) !== null;
  });
  if (candidates.length === 0) return null;

  const winner = candidates.reduce((best, candidate) => {
    const byInstant = String(candidate.updatedAt).localeCompare(String(best.updatedAt));
    if (byInstant !== 0) return byInstant > 0 ? candidate : best;
    return String(candidate.id).localeCompare(String(best.id)) < 0 ? candidate : best;
  });
  const factor = usableStoredFactor(winner);
  return factor === null ? null : { factor, source: 'user', n: 0 };
}

/**
 * D24's answer, both halves, in the order D19's layering already implies: an ASSUMPTION BEATS THE
 * STATISTICS. A family that has written down what September costs them has said something the
 * moving average cannot contradict.
 *
 * `null` and a factor of `1` are different answers and this returns `null` for "nothing to say".
 * A `1` asserts we looked and this month is ordinary; the ₪0 argument from D26, one type over.
 */
export function seasonalFactorFor(
  categoryId: string,
  period: string,
  assumptions: ForecastAssumption[],
  observations: SeasonalObservation[]
): SeasonalFactor | null {
  const user = userSeasonalFactor(categoryId, period, assumptions);
  if (user !== null) return user;
  const observed = observedSeasonalFactor(categoryId, monthKeyOf(period), observations);
  return observed.status === 'factor' ? observed.factor : null;
}

/**
 * A factor as the percentage the hover says out loud: `1.3` → `30`, `0.8` → `-20`.
 *
 * Signed, and rounded to whole percent. The SIGN is what stops "ספטמבר היה יקר ב--20%" — a factor
 * below 1 is an ordinary thing for a family to assert about a quiet month, and the copy picks its
 * word from the sign rather than assuming every seasonal month is an expensive one.
 */
export function seasonalPercentOf(factor: SeasonalFactor): number {
  return Math.round((factor.factor - 1) * PERCENT);
}
const PERCENT = 100;

/**
 * Every reason the observed half declines to produce a factor — the discriminants of
 * `ObservedSeasonalResult` minus the one that succeeds.
 *
 * Derived from a total switch rather than listed, so a fourth refusal added to the union fails to
 * compile here instead of reaching the screen with no sentence. D24's floor is "no factor is applied
 * AND THE LINE SAYS WHY"; a state with no sentence is the half of that ruling that gets dropped.
 */
export function seasonalRefusalKindOf(result: ObservedSeasonalResult): SeasonalRefusalKind | null {
  switch (result.status) {
    case 'factor':
      return null;
    case 'insufficient-observations':
    case 'no-baseline':
    case 'implausible-factor':
      return result.status;
    default: {
      const exhaustive: never = result;
      void exhaustive;
      throw new Error('seasonalRefusalKindOf: unrecognised observed-seasonality status');
    }
  }
}

export type SeasonalRefusalKind = 'insufficient-observations' | 'no-baseline' | 'implausible-factor';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A31 — the two months §10 names, shipped OFFERED
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SeasonalityOffer {
  categoryId: string;
  monthKey: string;
  factor: number;
  reasonHe: string;
}

/**
 * §10's own sentence is "עם התאמת עונתיות בסיסית (ספטמבר=חוגים, אפריל=חגים)" — David's words about
 * his own family. A31 ruled that asking him to re-approve his own spec is deference theatre, so
 * these ship OFFERED and PRE-FILLED rather than as a demo-script seed.
 *
 * !! THE FACTOR IS A STARTING POINT AND THE FAMILY EDITS IT. §10 names the two months and no
 * numbers; `1.3` is D24's own hover example ("יקר ב-30%") and nothing more. That is why these are
 * OFFERS and not defaults: nothing is applied until a member accepts one, and accepting stores a
 * document owned by them with `source: 'user'`, so the hover attributes the number to a person
 * rather than to the app.
 *
 * NO MONTH NAME APPEARS IN `reasonHe`. The month is the scope key; the NAME is looked up from
 * `HEBREW_MONTH_NAMES` at render time, which is what keeps the twelve names in one array (D29c's
 * F4 rule) and what lets the month-literal guard mean something in this module.
 */
export const SEASONALITY_OFFERS: readonly SeasonalityOffer[] = [
  {
    categoryId: CATEGORY_MAP.Education,
    monthKey: MONTH_KEY_SEPTEMBER,
    factor: 1.3,
    reasonHe: 'תחילת שנת הלימודים — ציוד וחוגים.',
  },
  {
    categoryId: CATEGORY_MAP.Groceries_Dining,
    monthKey: MONTH_KEY_APRIL,
    factor: 1.3,
    reasonHe: 'חגי האביב — קניות וארוחות.',
  },
];

/**
 * Turns the offers into WRITABLE DOCUMENTS attributed to the member accepting them, minus the ones
 * whose scope the family already has.
 *
 * "Already has" is checked on `scopeId` ALONE — not on owner, and not on status. A retired
 * assumption is a decision the family made, and re-offering the same suggestion to someone who has
 * already said no to it is the pile A31's "one-click" is the opposite of. `ownerId` is excluded for
 * the same reason from the other direction: a factor Lilit accepted is a fact about the family's
 * September, not about Lilit, and offering David his own copy of it would put two assumptions on
 * one scope and hand D20's tiebreak a job it should never have.
 *
 * The returned documents carry no `id`: they are drafts. `saveForecastAssumption` mints one, and
 * the write is anti-spoof-bound in Rules to `ownerId == memberId()`, so a draft attributed to
 * someone else cannot be written even if a caller builds one.
 */
export function offeredSeasonalityAssumptions(input: {
  offers: readonly SeasonalityOffer[];
  existing: ForecastAssumption[];
  ownerId: string;
  fromPeriod: string;
}): Array<Omit<ForecastAssumption, 'id' | 'createdAt' | 'updatedAt'>> {
  const taken = new Set(
    input.existing.filter((a) => a.scopeKind === 'seasonality').map((a) => a.scopeId)
  );
  return input.offers
    .map((offer) => ({
      ownerId: input.ownerId,
      scopeKind: 'seasonality' as const,
      scopeId: seasonalityScopeId(offer.categoryId, offer.monthKey),
      fromPeriod: input.fromPeriod,
      // `amountILS` is UNUSED for a seasonality assumption (D25's own comment) and Rules require it
      // to be a non-negative number, so it is written as an explicit 0 rather than omitted.
      amountILS: 0,
      factor: offer.factor,
      reasonHe: offer.reasonHe,
      source: 'user' as const,
      status: 'active' as const,
    }))
    .filter((draft) => !taken.has(draft.scopeId));
}
