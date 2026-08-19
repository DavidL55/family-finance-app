// src/utils/statisticalLayer.ts — Stage 7, T5/T6. THE MOVING AVERAGE OVER SEALED HISTORY.
//
// ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────────────────────────
//
// Split out of `forecast.ts` (T7c). The T5 review named this seam — `buildStatisticalLayer` +
// `observationsOf` — the T6 review restated it, and T7b deferred it on the correct grounds that a
// 2,100-line refactor does not belong inside a 4,000-line feature commit. It is drawn WIDER than
// the two functions the review named, deliberately: `buildStatisticalLayer` alone would have left
// `statisticalEstimateOf`, `countsTowardMovingAverage`, `observedBandOf` and `historyWindowStateOf`
// behind, i.e. the layer's body in one file and its entry point in another, with six import edges
// running backwards for nobody's benefit. What is here is the whole machine: from "does this row
// belong in an average" through "what does this category cost" to "what does the layer answer".
//
// ── WHAT IT READS, AND THE DOOR ───────────────────────────────────────────────────────────────
//
// `buildStatisticalLayer` and `unknownPeriodRowCount` take a `StatisticalHistoryHandle` and NEVER
// an array of rows, and each makes the same two checks in the same order — the `'ready'` branch
// first, then `isGatedStatisticalHistory`. That is the door, and the split did not touch it:
// `sealStatisticalHistory` is still called from exactly one place (`loadStatisticalHistory`),
// `SEALED_HANDLES` still has exactly one `.add`, and `statisticalHistoryDoor.test.ts` now points
// its "no module imports both the short door and a statistical-layer export" conjunction at THIS
// module — the file the layer's exports actually live in — rather than at the file they used to.
// A guard left pointing at the old address is a guard that has stopped firing while staying green.
//
// ── PURITY ────────────────────────────────────────────────────────────────────────────────────
//
// No I/O, no Firebase, no clock, no `Date` parameter. It is a NAMED ENTRY in
// `FORECAST_ENTRY_MODULES` rather than a module the walk happens to reach, for the same reason
// `forecastTargets.ts` and `forecastView.ts` are: a root is a definition, not a discovery, and a
// module reached only because some other file happens to import it is one edit away from silently
// leaving every guard. `forecastPurity.test.ts` asserts the membership.
//
// ── AND WHAT IT MUST NOT DECLARE ──────────────────────────────────────────────────────────────
//
// A SEASONALLY-NAMED TOP-LEVEL EXPORT. `monthLiteralGuard.test.ts` scopes its integer-literal ban
// to `modules declaring a /seasonal/i name` ∩ `the forecast closure`, and this file holds
// `monthsObserved < 1`, `monthsObserved >= 1`, `months < 1` and `sorted.length % 2 === 1` — integer
// literals in 1..12 that are counts and remainders, not months. This module APPLIES a seasonal
// factor; `seasonality.ts` DERIVES it and owns the name. The guard asserts this file is outside the
// scope, so naming a local helper `applySeasonalFactor` fails the assertion before the ban.
import { CATEGORY_OTHER, roundILS } from './forecastBasis';
import type { ForecastBasis, ForecastLineItem, ObservedBand } from './forecastBasis';
import { STATISTICAL_GAP_REASON_HE, historyCeilingReasonHe } from './forecastCopy';
import type { BandBasis, MonthConfidence, StatisticalGapReason } from './forecastCopy';
import { UNKNOWN_PERIOD, previousPeriod } from './periodMath';
// D23(a) — `isExpenseRow`, and the divergence from `isExpenseListRow` is the reason it is named
// here rather than reimplemented. See `countsTowardMovingAverage`.
import { isExpenseRow } from './transactionFilters';
import { isGatedStatisticalHistory } from './statisticalHistory';
import type { StatisticalHistoryHandle, StatisticalHistoryRow } from './statisticalHistory';
// D24 — seasonality is an ASSUMPTION, and its arithmetic lives in its own module. This module
// APPLIES the factor (which is where money is produced and rounded); `seasonality.ts` DERIVES it.
import { seasonalFactorFor, type SeasonalObservation } from './seasonality';
import type { ForecastAssumption } from '../types/finance';

/**
 * The two copy key unions that appear inside THIS module's declared types, re-exported from where
 * their sentences live — `MonthConfidence` is `monthConfidenceOf`'s answer and `StatisticalGapReason`
 * is a member of `StatisticalCategoryEstimate`.
 *
 * The same asymmetry `forecastBasis.ts` states for `BandBasis` holds here: the TYPES are
 * re-exported and the STRINGS never are, so this module does not become a second address for a
 * sentence in the product.
 */
export type { MonthConfidence, StatisticalGapReason } from './forecastCopy';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Named constants — no bare literals, and each one is pinned to something that already exists
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D33's explicit-degradation threshold, in `transaction_lines` rows returned by ONE window read.
 *
 * T0 measured the number this is set from: a 6-month FAMILY read returns **3 documents** on the
 * real corpus today and **3,000–4,800** for 20 members with a realistic year, at ~384 B of field
 * JSON per row (~1.1–1.7 MB on the wire). מי is filtered CLIENT-SIDE (D21b), so narrowing to one
 * member does not shrink the payload — the ceiling is set by family size × window regardless of
 * what the viewer selected, which is why it is a stated threshold and not something a filter can
 * be used to escape.
 *
 * LANDED IN T4 RATHER THAN T5, and that is a deviation with its reason: T4's generator has to
 * CROSS this number for the degradation path to be provable rather than asserted, and a threshold
 * the generator restates locally is a second 2000 free to drift from the first. T5 still owns the
 * degradation STATE — the copy, the shorter-window offer, the `no limit()` rule; this is its number
 * and nothing else.
 */
export const HISTORY_ROW_CEILING = 2000;

/**
 * §10's stated lookback range, and T5's half of D3.
 *
 * `_MAX` is the width of the window the statistical read asks for. `_MIN` is D3's BAND FLOOR: below
 * three observed months there is no band at all, because `min`/`median`/`max` over one or two
 * numbers is not a range, it is the numbers themselves wearing a range's clothes.
 *
 * !! `DEMO_WINDOW_MONTHS` IN `demoCorpus.ts` IS THIS CONSTANT, IMPORTED. T4 had to restate the 6
 * locally because T5 had not run yet, and its own comment said so: *"T5 should import this or pin
 * the two against each other — a second, silently-diverging 6 is exactly the defect this stage
 * keeps finding."* T5 has now run, and the direction of the dependency is the one that keeps
 * `forecast.ts` pure: the corpus imports the rule, never the other way round.
 */
export const LOOKBACK_MONTHS_MAX = 6;
export const LOOKBACK_MONTHS_MIN = 3;

/**
 * D41's cut-points, named so the most-hovered chip on the screen is not defined by whoever wrote it
 * first. See `monthConfidenceOf` for the `or` rule and why it is `or`.
 *
 * `CONFIDENCE_MONTHS_STRONG = 4` sits ABOVE `LOOKBACK_MONTHS_MIN = 3` deliberately: a month that
 * has only just earned a band has not yet earned the top label.
 */
export const CONFIDENCE_MONTHS_STRONG = 4;
export const CONFIDENCE_MONTHS_FAIR = 2;
export const CONFIDENCE_COMMITTED_STRONG = 0.8;
export const CONFIDENCE_COMMITTED_FAIR = 0.5;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T4 REVIEW F-1, SECOND HALF — THE STATISTICAL LAYER REFUSES AN UNREADABLE AMOUNT
// ─────────────────────────────────────────────────────────────────────────────────────────────

//
// A parent could strip `date`, `owner` and `amount` off a row with one `updateDoc` — the live
// probe left one at `{ownerId, period, category}` — and that row PASSES `isExpenseRow`, which
// reads `category` and `isCredit` and never looks at `amount`. `sum + undefined` is `NaN`, and a
// `NaN` on the headline projected balance is the failure this whole stage exists to prevent.
//
// `firestore.rules` now denies the deletion. This is the other half, and it is not redundant with
// it: a rule can be relaxed later, the pre-backfill corpus is full of rows no validator ever saw,
// and `transaction_lines` is a schemaless collection read through a NON-STRICT tsconfig, where
// `row.amount as number` compiles and a string arrives at runtime.
//
// REFUSING, NOT SKIPPING. Dropping the bad row and averaging the rest is R6's failure mode by a
// different route: a moving average over four of six rows renders identically to one over all six.
// The caller gets the offending ids and decides — the same shape D17 uses for the balance, where
// any input that is not `'ok'` makes the figure `null` and puts a named gap in its place.

/** `'readable'` carries the number; `'unreadable'` carries WHY, because the operator has to go and fix it. */
export type ObservedAmountReason = 'absent' | 'not-a-number' | 'not-finite';

export type ObservedAmount =
  | { status: 'readable'; amountILS: number }
  | { status: 'unreadable'; reason: ObservedAmountReason };

export type ObservedTotal =
  | { status: 'ok'; totalILS: number; rowsCounted: number }
  | { status: 'refused'; unreadable: Array<{ id: string; reason: ObservedAmountReason }> };

/**
 * A row's `amount` as money, or a named refusal. `unknown` rather than `number`, deliberately and
 * for the same reason `periodOfMonthYear` takes `unknown` (T3 review F9): the value comes off a
 * schemaless document through a non-strict tsconfig, so a narrower declared type is a claim the
 * compiler cannot keep, and the check that matters has to be at runtime where the data is.
 *
 * `Number.isFinite` and NOT a bare `typeof === 'number'`: `typeof NaN` IS `'number'`, and `NaN` is
 * the one value whose entire behaviour is to contaminate every sum it reaches. It is also exactly
 * what an earlier arithmetic bug hands over — `Number(undefined)`, a division by an absent count —
 * so the type check alone would let this module's own mistakes through as money.
 *
 * NO COERCION. `Number('300')` is 300, `Number('')` is 0 and `Number([300])` is 300, so a coercing
 * reader turns three different kinds of broken row into confident figures. That is the near-match
 * guess `resolveOwnerId`'s header refuses, applied to the headline number.
 */
export function readObservedAmount(row: { amount?: unknown }): ObservedAmount {
  const amount = row.amount;
  if (amount === undefined || amount === null) return { status: 'unreadable', reason: 'absent' };
  if (typeof amount !== 'number') return { status: 'unreadable', reason: 'not-a-number' };
  if (!Number.isFinite(amount)) return { status: 'unreadable', reason: 'not-finite' };
  return { status: 'readable', amountILS: amount };
}

/**
 * The sum of every row's amount — or a refusal naming EVERY row that could not be read.
 *
 * Every one, not the first: an operator sent to fix one row at a time makes four trips for four
 * rows, and each trip re-runs a computation that refuses again. `'(no id)'` for a row with no
 * document id, because a refusal nobody can act on is barely better than the `NaN`.
 *
 * An EMPTY list totals `0` and is NOT a refusal. ₪0 over no rows is a real, correct answer — the
 * cold-start states (D26 row 0) depend on it — and conflating it with "we could not read this"
 * would make the empty corpus indistinguishable from the corrupt one.
 */
export function totalObservedILS(rows: Array<{ id?: string; amount?: unknown }>): ObservedTotal {
  const unreadable: Array<{ id: string; reason: ObservedAmountReason }> = [];
  let total = 0;
  for (const row of rows) {
    const amount = readObservedAmount(row);
    if (amount.status === 'unreadable') {
      unreadable.push({ id: row.id ?? '(no id)', reason: amount.reason });
      continue;
    }
    total = roundILS(total + amount.amountILS);
  }
  if (unreadable.length > 0) return { status: 'refused', unreadable };
  return { status: 'ok', totalILS: total, rowsCounted: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T5 — THE STATISTICAL LAYER, COLD START, AND THE BAND
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE THREE THINGS THIS SECTION IS NOT ALLOWED TO DO
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   1. NO SYMMETRIC MULTIPLIER (D3). A ×0.85/×1.0/×1.15 fan encodes nothing: the multiplier is
//      invented, the width is constant regardless of that category's actual volatility, and the
//      shape visually implies a probability interval nothing supports. The band here is the
//      family's OWN `min`/`median`/`max`, and it DEGENERATES VISIBLY below three observed months —
//      which is the point, not a limitation to be smoothed over.
//
//   2. NO PROBABILITY LANGUAGE, EVER (D3). The labels are "הכי יקר שהיה" / "האמצע" /
//      "הכי זול שהיה" — three things that HAPPENED. Never "80% ביטחון", and never a scenario band
//      named שמרן/צפוי/אופטימי, which is the exact defect A39 names.
//
//   3. ₪0 NEVER MEANS "UNKNOWN" (D26). Zero history renders a STATED GAP, and so does a category
//      whose every observed month totalled ₪0 — because "we estimate ₪0 of electricity next month"
//      and "we have one month of electricity and it was fully credited" are the same pixels and
//      opposite statements. That is enforced by the SHAPE below rather than by a renderer's
//      discipline: `estimateILS` exists only on the `'estimated'` member of the union, and that
//      member is unreachable when the estimate is not positive. There is no ₪0 to render.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHERE THE ROWS COME FROM, AND WHY THIS FUNCTION WILL NOT TAKE AN ARRAY
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `buildStatisticalLayer` takes a `StatisticalHistoryHandle`, never `TransactionHistoryRow[]`. The
// completion-marker refusal lives in `loadStatisticalHistory` and nowhere else, and until this task
// nothing but a sentence in the ledger stopped a caller reaching for `listTransactionHistory`
// instead — one import shorter, no marker read, and a moving average over a half-stamped corpus
// that renders IDENTICALLY to one over all of it. See `statisticalHistory.ts` for the three
// mechanisms; this signature is the first of them.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The inclusion predicates — D23
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * True when the row was posted by the recurring engine.
 *
 * D23/D11: `RecurringService` stamps `recurringId` on every row it auto-posts, and the certain
 * layer projects those same items forward. Counting them in the moving average as well makes every
 * recurring charge appear TWICE in the same month's total — once as a contractual line item and
 * once inside the estimate meant to cover everything else.
 *
 * `''` is not a recurring id. `FileProcessor` writes `recurringId: null` for manual rows and the
 * documents are schemaless, so a falsy-but-present value has to read as "manual", not as "posted
 * by an engine whose id is the empty string".
 */
export function hasRecurringId(row: { recurringId?: unknown }): boolean {
  return typeof row.recurringId === 'string' && row.recurringId.length > 0;
}

/**
 * Whether a history row belongs in the moving average.
 *
 * !! `isExpenseRow`, NOT `isExpenseListRow` — D23(a), and the reason is in the divergence between
 * them. `isExpenseRow` (`transactionFilters.ts`) excludes income-category rows AND ALL CREDITS.
 * `isExpenseListRow` keeps credits whose `paymentType` is `'refund'` or `'cancellation'`, because
 * ExpensesBreakdown is a LIST and a user needs to see that the refund happened. A moving average is
 * not a list: a refund counted as spend inflates every future month by money that came BACK. The
 * two predicates differ on exactly one row shape (`isCredit: true` + `paymentType: 'refund'`), the
 * demo corpus contains one inside the window, and swapping the predicates moves a number.
 *
 * `period` is read off the row, never re-derived from `date`: T3 stamped it, `'unknown'` is a real
 * stamped value that must never enter an average, and a row outside the window is a row the query
 * returned for the `'unknown'` clause's sake.
 *
 * !! THE `'unknown'` CHECK IS NOT REDUNDANT WITH THE WINDOW CHECK, AND THE SWEEP PROVED IT WAS
 * SHADOWED. Deleting it survived the whole suite, because every fixture passed a clean six-period
 * window that `'unknown'` is not a member of. But the window this function is handed comes from a
 * caller, and the caller's own query sends `[...window, UNKNOWN_PERIOD]` — that array is right
 * there, one function away, and passing it verbatim is the obvious mistake. With the check gone,
 * every unparseable row in the ledger would land in whichever month the caller's window said, at
 * full confidence. The test that closes it passes exactly that array.
 */
export function countsTowardMovingAverage(
  row: StatisticalHistoryRow,
  windowPeriods: ReadonlySet<string>
): boolean {
  if (typeof row.period !== 'string') return false;
  if (row.period === UNKNOWN_PERIOD) return false;
  if (!windowPeriods.has(row.period)) return false;
  if (hasRecurringId(row)) return false;
  // NARROWED HERE, not in the declaration. `isExpenseRow` reads three fields and this module's rows
  // are `unknown` on every one of them, so the projection is where the schemaless document meets a
  // predicate with a declared shape — and a non-string `category` reads as "no category", never as
  // a coerced near-match.
  return isExpenseRow({
    category: typeof row.category === 'string' ? row.category : null,
    isCredit: row.isCredit === true,
    paymentType: typeof row.paymentType === 'string' ? row.paymentType : null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D3 — the band
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `min` / `median` / `max` of the observed monthly totals, or `null` below D3's floor.
 *
 * The median of an even count is the mean of the two middle values — stated because the alternative
 * ("the lower of the two") is also defensible and the two disagree on a six-month window, which is
 * the window this app actually uses.
 */
export function observedBandOf(monthlyTotalsILS: number[]): ObservedBand | null {
  if (monthlyTotalsILS.length < LOOKBACK_MONTHS_MIN) return null;
  const sorted = [...monthlyTotalsILS].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const midILS =
    sorted.length % 2 === 1
      ? sorted[Math.floor(mid)]
      : roundILS((sorted[mid - 1] + sorted[mid]) / 2);
  return { lowILS: sorted[0], midILS, highILS: sorted[sorted.length - 1] };
}

/** D3's discriminant for an OBSERVED category. `'assumption-fixed'` is not reachable from here. */
export function bandBasisOfObservations(monthsObserved: number): BandBasis {
  return monthsObserved >= LOOKBACK_MONTHS_MIN ? 'observed-range' : 'insufficient-history';
}

/**
 * The band basis of a rendered line item, total over the union.
 *
 * `null` for the certain layer, and that is D3's first bullet rather than an omission: a loan
 * repayment, an insurance premium and a committed instalment are contractual. Widening them
 * manufactures uncertainty that does not exist.
 *
 * For a `'movingAverage'` basis it returns the CARRIED value — it does not recompute it from
 * `monthsObserved`. That is the difference between a discriminant and a derivation, and it is what
 * lets an assumption keep `'assumption-fixed'` even when it displaced a six-month average.
 */
export function bandBasisOf(basis: ForecastBasis): BandBasis | null {
  switch (basis.kind) {
    case 'recurring':
    case 'loan':
    case 'insurance':
    case 'installment':
      return null;
    case 'movingAverage':
      return basis.bandBasis;
    case 'assumption':
      return 'assumption-fixed';
    default: {
      const exhaustive: never = basis;
      void exhaustive;
      throw new Error('bandBasisOf: unrecognised basis kind');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D41 — the per-month confidence chip
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The committed share of a month's OUTFLOW — `certainILS / expenseILS`.
 *
 * Outflow, not the whole month: income is not something the forecast commits to and dividing by it
 * would let a large salary make every month look contractual. A month with no outflow at all has no
 * share to report and gets `0`, which reads as "nothing here is committed" — the same answer a
 * month of pure estimate gets, and the honest one for a month with nothing in it.
 */
export function committedShareOf(totals: { certainILS: number; expenseILS: number }): number {
  if (!Number.isFinite(totals.expenseILS) || totals.expenseILS <= 0) return 0;
  if (!Number.isFinite(totals.certainILS) || totals.certainILS <= 0) return 0;
  return Math.min(1, totals.certainILS / totals.expenseILS);
}

/**
 * D41's chip. `null` — no chip — when nothing statistical contributed to the month.
 *
 * !! `or`, NOT `and`, AND THAT IS THE DECISION. A month that is 90% contractual is well-based even
 * on one month of history for the remaining tenth; a month with six months of history is well-based
 * even if nothing in it is committed. Requiring both would report `הערכה גסה` for the
 * certain-layer-dominated months that are in fact the most reliable thing the screen draws.
 *
 * `monthsObserved` here is the WEAKEST contributing category, never the average — see
 * `weakestMonthsObserved`.
 */
export function monthConfidenceOf(monthsObserved: number, committedShare: number): MonthConfidence | null {
  if (!Number.isFinite(monthsObserved) || monthsObserved < 1) return null;
  if (monthsObserved >= CONFIDENCE_MONTHS_STRONG || committedShare >= CONFIDENCE_COMMITTED_STRONG) {
    return 'well-based';
  }
  if (monthsObserved >= CONFIDENCE_MONTHS_FAIR || committedShare >= CONFIDENCE_COMMITTED_FAIR) {
    return 'estimate';
  }
  return 'rough-estimate';
}

/**
 * D26/D14 — a month inherits the WEAKEST `monthsObserved` among its contributing categories.
 *
 * Never the average. The average hides a one-month-old category behind five mature ones, and the
 * demo corpus contains exactly that month: a category observed above the window cap sitting beside
 * one observed once, whose mean is comfortably above the `הערכה גסה` cut-point while the truth is
 * that a sixth of the estimate rests on a single observation.
 *
 * !! A GAP CATEGORY COUNTS, AND IT COUNTS AS ITS OWN `monthsObserved`. A category the layer could
 * not estimate is the weakest possible contributor to the month's estimate, not an absent one —
 * excluding it would let the month's confidence RISE because a category got worse.
 */
export function weakestMonthsObserved(categories: Array<{ monthsObserved: number }>): number {
  if (categories.length === 0) return 0;
  return categories.reduce((weakest, c) => Math.min(weakest, c.monthsObserved), Infinity);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D26 — the cold-start table, including row 0
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The five rows of D26's table.
 *
 *   · `'empty'`                 — row 0. EVERY layer empty. Not three empty bars: an onboarding
 *                                 state whose glance position holds the COUNT OF MISSING INPUTS.
 *   · `'no-statistical-history'`— a certain layer exists, no history. Variable spend is a GAP
 *                                 (D40), never ₪0.
 *   · `'thin-history'`          — 1–2 months. The average is shown, labelled with the real n. No
 *                                 band. No seasonality.
 *   · `'full-window'`           — 3 to `LOOKBACK_MONTHS_MAX - 1`. Band from the observed range.
 *   · `'window-capped'`         — `LOOKBACK_MONTHS_MAX` or more. D26's ">6" row.
 *
 * !! WHY THE ">6" ROW IS SPELLED `>= LOOKBACK_MONTHS_MAX` AND NOT `> LOOKBACK_MONTHS_MAX`. The
 * window is six periods wide, so `monthsObserved` can never EXCEED six — the cap is what makes that
 * true, and a row keyed on a number the window cannot produce is a row no test could reach. The
 * observable form of "the family has more history than we read" is "the window came back full", and
 * that is what this returns. The demo corpus proves the distinction is real: its groceries category
 * has rows in eight periods and reports six.
 */
export type ColdStartRow =
  | 'empty'
  | 'no-statistical-history'
  | 'thin-history'
  | 'full-window'
  | 'window-capped';

export function coldStartRowOf(input: {
  monthsObserved: number;
  certainInputsPresent: boolean;
}): ColdStartRow {
  if (input.monthsObserved >= LOOKBACK_MONTHS_MAX) return 'window-capped';
  if (input.monthsObserved >= LOOKBACK_MONTHS_MIN) return 'full-window';
  if (input.monthsObserved >= 1) return 'thin-history';
  return input.certainInputsPresent ? 'no-statistical-history' : 'empty';
}

/**
 * What each row of D26's table actually DOES, as data rather than as five `if`s spread across a
 * component. `bandDrawn` is D3's floor; `seasonalityAllowed` is D24's (T6 applies it, T5 states it).
 */
export interface ColdStartBehaviour {
  statisticalLayerDrawn: boolean;
  bandDrawn: boolean;
  seasonalityAllowed: boolean;
  /** D26: in row 0 the glance position holds the count of missing inputs, not a caveat. */
  glanceHoldsMissingInputCount: boolean;
}

export function coldStartBehaviourOf(row: ColdStartRow): ColdStartBehaviour {
  switch (row) {
    case 'empty':
      return {
        statisticalLayerDrawn: false,
        bandDrawn: false,
        seasonalityAllowed: false,
        glanceHoldsMissingInputCount: true,
      };
    case 'no-statistical-history':
      return {
        statisticalLayerDrawn: false,
        bandDrawn: false,
        seasonalityAllowed: false,
        glanceHoldsMissingInputCount: false,
      };
    case 'thin-history':
      return {
        statisticalLayerDrawn: true,
        bandDrawn: false,
        seasonalityAllowed: false,
        glanceHoldsMissingInputCount: false,
      };
    case 'full-window':
    case 'window-capped':
      return {
        statisticalLayerDrawn: true,
        bandDrawn: true,
        seasonalityAllowed: true,
        glanceHoldsMissingInputCount: false,
      };
    default: {
      const exhaustive: never = row;
      void exhaustive;
      throw new Error('coldStartBehaviourOf: unrecognised cold-start row');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D33 — the row ceiling, and the shorter window it offers instead
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type HistoryWindowState =
  | { status: 'ok'; rowsReturned: number }
  | {
      status: 'too-many-rows';
      rowsReturned: number;
      ceiling: number;
      suggestedWindowMonths: number;
      reasonHe: string;
    };

/**
 * D33's explicit degradation.
 *
 * !! THERE IS NO `limit()` ANYWHERE ON THIS PATH, AND THAT IS THE WHOLE RULING. Truncating the read
 * would produce an average over an arbitrary fraction of the window that renders identically to one
 * over all of it — R6's failure mode, arrived at by a different road, and the one thing this stage
 * exists to prevent. So the read comes back whole and the SCREEN degrades: it says the window was
 * too large to read and offers a shorter one.
 *
 * The shorter window is computed from the rows actually returned, floored at `LOOKBACK_MONTHS_MIN`
 * so the offer is never a window that has already lost D3's band. On the 20-member demo corpus
 * (2,182 rows over 6 months, 9.1% over the ceiling) it offers 5.
 */
export function historyWindowStateOf(rowsReturned: number, windowMonths: number): HistoryWindowState {
  if (rowsReturned <= HISTORY_ROW_CEILING) return { status: 'ok', rowsReturned };
  const scaled = Math.floor((windowMonths * HISTORY_ROW_CEILING) / rowsReturned);
  const suggestedWindowMonths = Math.max(LOOKBACK_MONTHS_MIN, Math.min(windowMonths - 1, scaled));
  return {
    status: 'too-many-rows',
    rowsReturned,
    ceiling: HISTORY_ROW_CEILING,
    suggestedWindowMonths,
    reasonHe: historyCeilingReasonHe(rowsReturned, suggestedWindowMonths),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The window, and the per-category estimate
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The `months` periods immediately BEFORE `anchorPeriod`, ascending.
 *
 * Strictly before: the anchor month is the first month being FORECAST, and averaging a month that
 * is still running would divide a partial month's spend by a whole month's weight — an estimate
 * that starts low on the 1st and climbs all month, with no way for a reader to tell.
 */
export function lookbackWindowPeriods(anchorPeriod: string, months: number = LOOKBACK_MONTHS_MAX): string[] {
  if (!Number.isInteger(months) || months < 1 || months > LOOKBACK_MONTHS_MAX) {
    throw new Error(
      `lookbackWindowPeriods: months must be an integer in 1..${LOOKBACK_MONTHS_MAX}, got ${String(months)}`
    );
  }
  const periods: string[] = [];
  let cursor = anchorPeriod;
  for (let i = 0; i < months; i++) {
    cursor = previousPeriod(cursor);
    periods.push(cursor);
  }
  return periods.reverse();
}

export type StatisticalCategoryEstimate =
  | {
      status: 'estimated';
      categoryId: string;
      monthsObserved: number;
      /** The observed periods, ascending. `periods.length === monthsObserved`, always. */
      periods: string[];
      monthlyTotalsILS: number[];
      estimateILS: number;
      band: ObservedBand | null;
      bandBasis: BandBasis;
    }
  | {
      status: 'gap';
      categoryId: string;
      monthsObserved: number;
      periods: string[];
      gapReason: StatisticalGapReason;
      reasonHe: string;
      /** Named rows for `'unreadable-amounts'`; empty otherwise. An operator has to go and fix them. */
      unreadable: Array<{ id: string; reason: ObservedAmountReason }>;
    };

/**
 * One category's monthly totals over the window, and the estimate they do or do not support.
 *
 * !! AN UNREADABLE AMOUNT REFUSES THE CATEGORY, NOT THE ROW. `totalObservedILS` refuses a whole
 * total rather than summing or skipping, for the reason F-1 recorded: averaging four of six rows
 * renders identically to averaging six. The refusal is scoped to the CATEGORY rather than to the
 * layer, because a poisoned row in groceries says nothing about transport, and deleting the whole
 * screen over one bad row is a worse answer than naming the row.
 *
 * !! THE AVERAGE DIVIDES BY MONTHS **OBSERVED**, NOT BY THE WINDOW WIDTH. A category seen in three
 * of six months is a category that costs what it costs in the months it appears; dividing by six
 * would halve it and label the result with an n of three. `monthsObserved` travels with the figure
 * so the screen can say which it is.
 */
/**
 * The bucket a history row's spend lands in. An absent or empty category falls into the same
 * `'שונות'` the recurring engine already stamps (`category: item.category ?? 'שונות'`), so a row
 * with no category is averaged rather than silently dropped — and it lands in a bucket the certain
 * layer can also reach.
 *
 * `''` IS TREATED AS ABSENT, and the sweep found that untested: `typeof row.category === 'string'`
 * alone survives, because no fixture carried an empty string. It is a shape the tree can produce —
 * `FileProcessor` writes whatever the extractor returned — and an empty-string bucket renders as a
 * category with no name beside a `'שונות'` that should have held it.
 */
export function statisticalCategoryOf(row: StatisticalHistoryRow): string {
  return typeof row.category === 'string' && row.category.length > 0 ? row.category : CATEGORY_OTHER;
}

export function statisticalEstimateOf(
  categoryId: string,
  rows: StatisticalHistoryRow[],
  windowPeriods: string[]
): StatisticalCategoryEstimate {
  const window = new Set(windowPeriods);
  const byPeriod = new Map<string, StatisticalHistoryRow[]>();
  for (const row of rows) {
    // The category filter lives HERE and not only in the caller. A function that takes a
    // `categoryId` and then averages every row it was handed answers a question nobody asked, and
    // it does it silently: the figure is plausible, it is labelled with the right category, and it
    // is the whole ledger. Caught by a test that fed it two categories and one poisoned row.
    if (statisticalCategoryOf(row) !== categoryId) continue;
    if (!countsTowardMovingAverage(row, window)) continue;
    const period = String(row.period);
    const bucket = byPeriod.get(period);
    if (bucket) bucket.push(row);
    else byPeriod.set(period, [row]);
  }

  const periods = [...byPeriod.keys()].sort();
  const monthsObserved = periods.length;
  if (monthsObserved === 0) {
    return {
      status: 'gap',
      categoryId,
      monthsObserved: 0,
      periods: [],
      gapReason: 'no-history',
      reasonHe: STATISTICAL_GAP_REASON_HE['no-history'],
      unreadable: [],
    };
  }

  const monthlyTotalsILS: number[] = [];
  const unreadable: Array<{ id: string; reason: ObservedAmountReason }> = [];
  for (const period of periods) {
    const total = totalObservedILS(byPeriod.get(period) ?? []);
    if (total.status === 'refused') unreadable.push(...total.unreadable);
    else monthlyTotalsILS.push(total.totalILS);
  }
  if (unreadable.length > 0) {
    return {
      status: 'gap',
      categoryId,
      monthsObserved,
      periods,
      gapReason: 'unreadable-amounts',
      reasonHe: STATISTICAL_GAP_REASON_HE['unreadable-amounts'],
      unreadable,
    };
  }

  const estimateILS = roundILS(monthlyTotalsILS.reduce((sum, t) => sum + t, 0) / monthsObserved);

  // !! THE ₪0 BRANCH — §12's first no-₪0 corpus shape, closed in the TYPE rather than in a
  // renderer. An n=1 category whose single observation was ₪0 has an average of ₪0, and "we
  // estimate ₪0 here" is indistinguishable on screen from "we know nothing here" while meaning the
  // opposite. `'estimated'` is the only member carrying `estimateILS`, and this line is what makes
  // it unreachable at zero — so there is no ₪0 for anything downstream to draw.
  if (!(estimateILS > 0)) {
    return {
      status: 'gap',
      categoryId,
      monthsObserved,
      periods,
      gapReason: 'no-spend-observed',
      reasonHe: STATISTICAL_GAP_REASON_HE['no-spend-observed'],
      unreadable: [],
    };
  }

  return {
    status: 'estimated',
    categoryId,
    monthsObserved,
    periods,
    monthlyTotalsILS,
    estimateILS,
    band: observedBandOf(monthlyTotalsILS),
    bandBasis: bandBasisOfObservations(monthsObserved),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The layer
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface StatisticalLayerInput {
  /** ONLY `loadStatisticalHistory` can produce the `'ready'` half. See `statisticalHistory.ts`. */
  history: StatisticalHistoryHandle;
  windowPeriods: string[];
  /** The forecast horizon. Every estimated category is projected into every one of these months. */
  horizon: string[];
  /**
   * T6/D24 — the family's `forecast_assumptions`, of which only `scopeKind: 'seasonality'` is read
   * here. OPTIONAL, and its absence means "no seasonal factors", never "not yet loaded": a caller
   * that has not fetched assumptions gets an unscaled estimate, which is the same number this layer
   * produced before T6 and is honest about it. The `'category'` and `'loan'` kinds are NOT read
   * here — those override a whole bucket and are resolved by `resolveLayerPrecedence`, one layer up.
   */
  assumptions?: ForecastAssumption[];
}

export type StatisticalLayerResult =
  | {
      status: 'refused-backfill-incomplete';
      reasonHe: string;
      lineItems: ForecastLineItem[];
      categories: StatisticalCategoryEstimate[];
      rowsRead: number;
      weakestMonthsObserved: number;
    }
  | {
      status: 'refused-too-many-rows';
      reasonHe: string;
      window: HistoryWindowState;
      lineItems: ForecastLineItem[];
      categories: StatisticalCategoryEstimate[];
      rowsRead: number;
      weakestMonthsObserved: number;
    }
  | {
      status: 'ready';
      reasonHe: string;
      lineItems: ForecastLineItem[];
      categories: StatisticalCategoryEstimate[];
      rowsRead: number;
      rowsCounted: number;
      weakestMonthsObserved: number;
      markerCompletedAt: string;
      markerSourceCommit: string;
    };

/**
 * The statistical layer, end to end.
 *
 * Three refusals and one answer, in this order, and the order is the ruling:
 *
 *   1. THE COMPLETION MARKER (D21d). Checked FIRST, before a single row is looked at, because a
 *      caveat under a wrong average is the defect and not the fix. Enforced twice — by the type of
 *      `history`, which only `loadStatisticalHistory` can satisfy, and by the runtime brand check
 *      below, which is what survives an `as` cast.
 *   2. THE ROW CEILING (D33). An explicit degradation with a shorter window offered, never a
 *      `limit()` and never a silently truncated average.
 *   3. PER CATEGORY, the gap states — no history, no spend observed, unreadable amounts — each with
 *      its own sentence, and none of them carrying a number.
 *
 * The line items are emitted for EVERY horizon month, identically. D41 records why that is correct
 * and not a simplification: recurring items, loans and insurances repeat identically month over
 * month and the band is the same history in every projected month, so "month 3 is strictly more
 * estimated than month 1" is false of this data. Distance is encoded by the confidence chip, from
 * two real inputs, rather than by a fan that widens because fans widen.
 */
export function buildStatisticalLayer(input: StatisticalLayerInput): StatisticalLayerResult {
  if (input.history.status !== 'ready') {
    return {
      status: 'refused-backfill-incomplete',
      reasonHe: input.history.reasonHe,
      lineItems: [],
      categories: [],
      rowsRead: 0,
      weakestMonthsObserved: 0,
    };
  }
  // The runtime half of the door. The compiler accepted `history` because an `as` assertion is
  // legal between shapes that overlap; the brand is a module-private symbol, so a forged handle
  // fails here instead of averaging an unstamped corpus.
  if (!isGatedStatisticalHistory(input.history)) {
    throw new Error(
      '[buildStatisticalLayer] refusing history that did not come through `loadStatisticalHistory`: ' +
        'the completion-marker refusal lives there, and a half-stamped corpus averages to a ' +
        'plausible wrong number.'
    );
  }

  const rows = input.history.rows;
  const window = historyWindowStateOf(rows.length, input.windowPeriods.length);
  if (window.status === 'too-many-rows') {
    return {
      status: 'refused-too-many-rows',
      reasonHe: window.reasonHe,
      window,
      lineItems: [],
      categories: [],
      rowsRead: rows.length,
      weakestMonthsObserved: 0,
    };
  }

  const windowSet = new Set(input.windowPeriods);
  const counted = rows.filter((row) => countsTowardMovingAverage(row, windowSet));
  const categoryIds = [...new Set(counted.map(statisticalCategoryOf))].sort();
  const categories = categoryIds.map((categoryId) =>
    statisticalEstimateOf(categoryId, counted, input.windowPeriods)
  );

  const assumptions = input.assumptions ?? [];
  const lineItems: ForecastLineItem[] = [];
  for (const period of input.horizon) {
    for (const category of categories) {
      if (category.status !== 'estimated') continue;
      const seasonalFactor = seasonalFactorFor(
        category.categoryId,
        period,
        assumptions,
        observationsOf(category)
      );
      lineItems.push({
        period,
        categoryId: category.categoryId,
        direction: 'expense',
        // D24 APPLIED. Rounding happens HERE because this is where the amount is produced — the
        // same rule every other producer in this module follows, and the reason `seasonality.ts`
        // returns a multiplier rather than an amount.
        amountILS: seasonalFactor === null
          ? category.estimateILS
          : roundILS(category.estimateILS * seasonalFactor.factor),
        basis: {
          kind: 'movingAverage',
          monthsObserved: category.monthsObserved,
          periods: category.periods,
          seasonalFactor,
          band: category.band,
          bandBasis: category.bandBasis,
        },
      });
    }
  }

  return {
    status: 'ready',
    reasonHe: '',
    lineItems,
    categories,
    rowsRead: rows.length,
    rowsCounted: counted.length,
    weakestMonthsObserved: weakestMonthsObserved(categories),
    markerCompletedAt: input.history.markerCompletedAt,
    markerSourceCommit: input.history.markerSourceCommit,
  };
}

/**
 * One estimated category's own monthly totals, in the shape `seasonality.ts` derives an observed
 * factor from. The layer already computed them; re-reading the ledger for the same numbers is how
 * two halves of one screen start disagreeing.
 *
 * !! `periods` AND `monthlyTotalsILS` ARE INDEX-ALIGNED, and `statisticalEstimateOf` builds them in
 * one loop over the same sorted key list, so the pairing is a property of that function rather than
 * a convention here. `statisticalLayer.test.ts` holds it.
 */
function observationsOf(category: StatisticalCategoryEstimate & { status: 'estimated' }): SeasonalObservation[] {
  return category.periods.map((period, index) => ({
    categoryId: category.categoryId,
    period,
    totalILS: category.monthlyTotalsILS[index],
  }));
}

/**
 * §13's `unusableRowCount` — how many rows came back with a period nobody could read.
 *
 * !! IT IS LEDGER-WIDE, NOT WINDOW-SCOPED, and the copy that renders it says so
 * (`unusableRowsHe`). `UNKNOWN_PERIOD` is one of the seven values the query's single `in` clause
 * sends on EVERY window (D21c), so changing מתי does not change this number. Without that clause in
 * the sentence, the figure invites a reader to conclude the months they selected are damaged when
 * they are not.
 *
 * Takes the HANDLE, for `observedInstalmentRowsOf`'s reason: there is no exported entry point that
 * accepts an array, because an entry point that accepts an array is the bypass. `0` for a refusal —
 * there is no corpus in memory to count, and the history input's own grade already says so.
 *
 * What it CANNOT see is a row that was never stamped at all (R6). The completion marker covers
 * that, and only for rows written before it was set; rows written after are covered by D21(e)'s
 * four stamping sites, not by this figure.
 */
export function unknownPeriodRowCount(history: StatisticalHistoryHandle): number {
  if (history.status !== 'ready') return 0;
  if (!isGatedStatisticalHistory(history)) {
    throw new Error(
      '[unknownPeriodRowCount] refusing history that did not come through `loadStatisticalHistory`: ' +
        'a forged corpus could report zero unreadable rows over a ledger full of them.'
    );
  }
  return history.rows.filter((row) => row.period === UNKNOWN_PERIOD).length;
}
