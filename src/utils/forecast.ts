// src/utils/forecast.ts — Stage 7, the pure forecast core (D37).
//
// ── WHAT THIS MODULE IS NOT ALLOWED TO DO ──────────────────────────────────────────────────────
//
// No I/O, no Firebase, no permission logic, and NO CLOCK. `anchorPeriod` and `todayPeriod` arrive
// as explicit parameters; nothing here calls `new Date()` or `Date.now()`, and nothing constructs
// a `Date` at all. This is enforced, not asked for: `forecastPurity.test.ts` walks this module's
// transitive import closure and fails on a banned import or a clock read. Permission scoping stays
// with the caller, exactly as `netWorth.ts` does it — this module computes over the arrays it was
// handed, and never decides what the viewer was allowed to fetch.
//
// ── THE ONE SENTENCE THAT GOVERNS THIS STAGE ───────────────────────────────────────────────────
//
// This is the first thing in the app that states something about the future, and a forecast that
// looks authoritative and is wrong is worse than no forecast. Two structural consequences live in
// this file:
//
//   1. `computeDuePeriods` CANNOT PROJECT FORWARD. It caps its range end at the current period, so
//      for any future month it returns `[]`. Reusing it for the certain layer ships a layer that
//      is empty in every forecast month WITH GREEN TESTS, because the line items are absent rather
//      than wrong. `projectRecurringForward` below is a genuinely new function, and importing
//      `computeDuePeriods` here is banned.
//
//   2. PRECEDENCE MUST BE A TOTAL ORDER. Two members can hold assumptions colliding on the same
//      (period, category). Without a tiebreak the winner is whatever order Firestore returned —
//      non-deterministic money on the headline number. `resolveLayerPrecedence` sorts, and its
//      canonical test shuffles the input and asserts the output does not move.
//
// ── HOW `layer` IS CARRIED ─────────────────────────────────────────────────────────────────────
//
// It is NOT a field. `layerOf(basis)` derives it, and the compiler enforces exhaustiveness over
// the union. A stored `layer` breaks in snapshots and fixtures where the pinning test does not
// look, and here the redundancy buys nothing at all.
import { CATEGORY_MAP } from './categoryMap';
// T5-review F8 — THE COPY LIVES IN ITS OWN MODULE, and the dependency runs ONE WAY: this file
// imports strings, `forecastCopy.ts` imports nothing. The seven blocks of Hebrew UI copy that used
// to sit in the middle of this arithmetic are there, together with the four key unions that index
// them; the three CATEGORY_* constants below are bucket keys rather than copy and deliberately
// stayed. `forecastCopy.test.ts` holds the seam — including that no new UI sentence can appear
// here without the guard seeing it.
import {
  BAND_BASIS_LABEL_HE,
  BAND_LABEL_HE,
  CERTAIN_LAYER_EMPTY_HE,
  FORECAST_INPUT_LABEL_HE,
  MONTH_CONFIDENCE_LABEL_HE,
  STATISTICAL_GAP_REASON_HE,
  historyCeilingReasonHe,
} from './forecastCopy';
import type {
  BalanceVerdict,
  BandBasis,
  ForecastInputKey,
  MonthConfidence,
  StatisticalGapReason,
} from './forecastCopy';
import {
  UNKNOWN_PERIOD,
  clampDayToMonth,
  comparePeriod,
  daysBetweenDates,
  earlierPeriod,
  laterPeriod,
  nextPeriod,
  periodOf,
  periodsBetween,
  previousPeriod,
  windowCoversAnyPeriod,
} from './periodMath';
// D23(a) — `isExpenseRow`, and the divergence from `isExpenseListRow` is the reason it is named
// here rather than reimplemented. See `countsTowardMovingAverage`.
import { isExpenseRow } from './transactionFilters';
import { isGatedStatisticalHistory } from './statisticalHistory';
// D24 — seasonality is an ASSUMPTION, and its arithmetic lives in its own module. This module
// APPLIES the factor (which is where money is produced and rounded); `seasonality.ts` DERIVES it.
import { seasonalFactorFor, type SeasonalObservation } from './seasonality';
import type { SeasonalFactor } from './seasonality';
import type { StatisticalHistoryHandle, StatisticalHistoryRow } from './statisticalHistory';
import type {
  Account,
  AssumptionScopeKind,
  ForecastAssumption,
  Insurance,
  Loan,
  RecurringItem,
} from '../types/finance';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Named constants — no bare literals, and each one is pinned to something that already exists
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The bucket a recurring item with no category falls into. Byte-identical to the default
 * `RecurringService` already stamps on every autoposted row (`category: item.category ?? 'שונות'`)
 * — if the two drift, a recurring item's forward projection and its own posted rows land in
 * different buckets and D23's double-count disclosure silently stops lining up. Pinned by a test
 * against `CATEGORY_MAP.General_Misc`.
 */
export const CATEGORY_OTHER = 'שונות';

/**
 * Insurance premiums land in the extraction taxonomy's own insurance category, so a projected
 * premium and an extracted premium row share a bucket.
 */
export const CATEGORY_INSURANCE = 'ביטוח ופנסיה';

/**
 * Loan repayments land in a category that is DELIBERATELY NOT in `CATEGORY_MAP`. There is no loan
 * category in the extraction taxonomy, because a bank statement's loan debit gets whatever category
 * the extractor picked — which is exactly why D23 DISCLOSES the loan double-count instead of
 * fixing it (fuzzy-matching a bank row to a loan is Stage 8's duplicate detection). Merging the two
 * into one bucket would hide the duplicate this stage promises to show. Pinned by a test.
 */
export const CATEGORY_LOAN_REPAYMENT = 'החזרי הלוואות';

/** The forecast horizon control's default (D32). 3/6/12 are the offered lengths. */
export const DEFAULT_HORIZON_MONTHS = 3;

/**
 * The longest horizon this module will build. 12 is the longest length D32 offers; a larger number
 * is a caller bug rather than a user choice, and honouring it silently multiplies D33's row ceiling
 * on the way to a figure nobody asked for.
 *
 * T1-review follow-up (2): `horizonMonths` was entirely unvalidated and `horizonPeriods` returned
 * `[]` for `months < 1` with no test on that branch — so `composeForecast({ horizonMonths: 0 })`
 * produced a forecast with an empty horizon, an empty `byPeriod`, and no complaint. An empty
 * `byPeriod` is indistinguishable from "the horizon has nothing in it", which is a real state
 * (A9's empty-certain-layer month), so the two must not share a rendering.
 */
export const MAX_HORIZON_MONTHS = 12;

/** D16's staleness bands, in days: ≤31 current, 32–92 stale, >92 very-stale. */
export const STALENESS_CURRENT_MAX_DAYS = 31;
export const STALENESS_STALE_MAX_DAYS = 92;

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

const MONTHS_PER_YEAR = 12;

/**
 * Money is rounded to agorot at the point it is produced, so float dust never reaches a total.
 *
 * HELD BY A TEST, NOT BY THIS SENTENCE (T1-review follow-up 2). Replacing this body with the
 * identity left all 1449 tests green while three yearly policies over three months rendered
 * `11671.692500000001` instead of `11671.71` — in the `text-4xl` headline, and an agora out besides.
 * `forecast.test.ts`'s "roundILS is the reason the headline is a number and not a float" block is
 * what makes that mutation fail.
 */
// T7b — EXPORTED, so `forecastView.ts` can compose totals without a THIRD private copy of this
// helper. Two already exist (`forecastTargets.ts` has its own), which is the F4 class starting; a
// third one written for a render model would be the first to disagree with the engine it draws.
export function roundILS(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D19 — the provenance union
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D24's seasonal multiplier. **MOVED to `./seasonality` in T6 and re-exported here**, so every
 * importer that named it from this module is unchanged.
 *
 * The move is load-bearing, not tidy. The no-month-literal guard derives the scope of its integer
 * ban from the tree, by finding the modules that DECLARE a seasonally-named export. Leaving this
 * interface declared here would put `forecast.ts` inside that scope — where `months < 1` and
 * `monthsObserved >= 1` are integer literals in 1..12 that are not months, and the guard would be
 * born red on exactly the constants the T5 ledger warned T6 about by name.
 */
export type { SeasonalFactor } from './seasonality';

/**
 * D3's band — the family's OWN observed monthly totals for one category, over the lookback window.
 *
 * `low`/`mid`/`high` are `min`/`median`/`max`, and the names are deliberately not `p10`/`p50`/`p90`
 * or `lower`/`upper`: those spellings imply a distribution and an interval, and there is no
 * distributional model here to support one. The Hebrew the screen renders is in
 * `BAND_LABEL_HE` — "הכי זול שהיה" / "האמצע" / "הכי יקר שהיה" — three things that HAPPENED, not
 * three things that might.
 */
export interface ObservedBand {
  lowILS: number;
  midILS: number;
  highILS: number;
}

export type ForecastBasis =
  | { kind: 'recurring'; recurringId: string; description: string; chargeDay: number }
  | { kind: 'loan'; loanId: string; name: string }
  | { kind: 'insurance'; insuranceId: string; provider: string }
  | { kind: 'installment'; planKey: string; observedNumber: number; totalInstallments: number }
  | {
      kind: 'movingAverage';
      monthsObserved: number;
      periods: string[];
      seasonalFactor: SeasonalFactor | null;
      /**
       * D3's band, CARRIED AND NOT INFERRED, with `bandBasis` naming which of the two `null`s this
       * is — "we looked and there is no range" versus "there are not enough months to look". A
       * renderer that recomputed the basis from `monthsObserved` would be one refactor from
       * drawing a band on an assumption-set amount, which D3 forbids in its own sentence: the user
       * asserted a number; we do not add error bars to their assertion.
       */
      band: ObservedBand | null;
      bandBasis: BandBasis;
    }
  | {
      kind: 'assumption';
      assumptionId: string;
      source: 'user' | 'insight';
      updatedAt: string;
      /** ORDERED STACK, nearest-overridden first. Empty when the assumption displaced nothing. */
      overrides: ForecastBasis[];
    };

export type ForecastLayer = 'certain' | 'statistical' | 'assumption';

export interface ForecastLineItem {
  period: string; // 'YYYY-MM'
  categoryId: string;
  direction: 'income' | 'expense';
  /** Always POSITIVE. `direction` carries the sign; a negative amount here is a bug, not an inflow. */
  amountILS: number;
  /** `layer` is NOT a field — see `layerOf`. */
  basis: ForecastBasis;
}

/**
 * The scopes an assumption can be attached to.
 *
 * MOVED TO `types/finance.ts` IN T2, where the rest of the document shape lives and where Rules'
 * own `data.scopeKind in [...]` list is held against it. Re-exported here because this module is
 * where `resolveCategoryOfScope` consumes it, and because T1's importers name it from here.
 */
export type { AssumptionScopeKind } from '../types/finance';

/**
 * The four key unions the copy is indexed by, re-exported from where their sentences live.
 *
 * THE TYPES ARE RE-EXPORTED AND THE STRINGS ARE NOT, AND THAT ASYMMETRY IS THE SPLIT. `BandBasis`
 * is a discriminant INSIDE `ForecastBasis`, so a consumer naming one has to be able to name the
 * other from the same place — re-exporting it costs nothing and keeps the domain vocabulary whole.
 * A re-exported `BAND_LABEL_HE`, by contrast, would leave `forecast.ts` a second address for every
 * string in the product, and T7c's exact-match guard would be pointing at a module that is not the
 * only way to reach what it is guarding. Copy is imported from `./forecastCopy`, by everyone.
 */
export type { BandBasis, ForecastInputKey, MonthConfidence, StatisticalGapReason } from './forecastCopy';

/**
 * Derives the layer from the basis. Total over the union; the `never` assignment in the default
 * branch makes adding a union member a BUILD failure, and the throw makes a hand-built object with
 * an unknown kind a loud runtime failure rather than a silent "certain".
 */
export function layerOf(basis: ForecastBasis): ForecastLayer {
  const kind = basis.kind;
  switch (basis.kind) {
    case 'recurring':
    case 'loan':
    case 'insurance':
    case 'installment':
      return 'certain';
    case 'movingAverage':
      return 'statistical';
    case 'assumption':
      return 'assumption';
    default: {
      const exhaustive: never = basis;
      void exhaustive;
      throw new Error(`layerOf: unrecognised basis kind "${String(kind)}"`);
    }
  }
}

/**
 * Maps an assumption's (scopeKind, scopeId) onto the (period, category) bucket precedence resolves
 * in. WITHOUT THIS, D19's most valuable disclosure never fires: a loan-scoped assumption and the
 * loan's own certain item would never share a key, so an assumption could not override a certain
 * item at all, while a test on a hand-built fixture passed.
 *
 * Returns `null` rather than guessing when a recurring scope names an item that is not in the
 * certain set — an assumption pointed at a deleted item must disappear, not land in `'שונות'`.
 */
export function resolveCategoryOfScope(
  scopeKind: AssumptionScopeKind,
  scopeId: string,
  certainItems: ForecastLineItem[]
): string | null {
  switch (scopeKind) {
    case 'recurring': {
      const match = certainItems.find(
        (item) => item.basis.kind === 'recurring' && item.basis.recurringId === scopeId
      );
      return match ? match.categoryId : null;
    }
    case 'loan':
      return CATEGORY_LOAN_REPAYMENT;
    case 'insurance':
      return CATEGORY_INSURANCE;
    case 'category':
      return scopeId;
    case 'seasonality':
      // DELIBERATELY NO CATEGORY — and for a SHARPER reason than `personalTarget`'s below.
      //
      // A seasonality assumption carries `factor` and, per D25's own comment, an UNUSED
      // `amountILS`. Every writer in this repo stamps that as `0`, because Rules require the field
      // to be a non-negative number. So if this returned the category out of `${categoryId}:${monthKey}`,
      // the assumption would land in that (period, category) bucket, D19 lets an assumption beat a
      // statistical item, and `resolveLayerPrecedence` would REPLACE the ₪2,400 groceries estimate
      // WITH ₪0 — silently, in the month the family said was expensive. A multiplier is not a
      // bucket entry; `seasonality.ts` applies it where the estimate is produced instead.
      return null;
    case 'personalTarget':
      // DELIBERATELY NO CATEGORY, and this is a mapping rather than an omission. A personalTarget
      // is what D29(d)'s allowance is computed AGAINST ("כמה נשאר לי להוציא") — it is not a line
      // item competing for a (period, categoryId) bucket. Giving it one would let a child's ₪500
      // target DISPLACE the family's ₪6,000 rent line, because D19 lets an assumption override a
      // CERTAIN item and precedence resolves per bucket. `null` means "overrides nothing", which is
      // exactly right here and is the same answer this function already gives a recurring scope
      // naming a deleted item.
      return null;
    default: {
      const exhaustive: never = scopeKind;
      void exhaustive;
      throw new Error(`resolveCategoryOfScope: unrecognised scope kind "${String(scopeKind)}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D22 — the certain layer: forward projectors
//
// These take structural `Pick<>` slices of the real document types rather than the whole shape, so
// a field rename in `types/finance.ts` breaks the build here instead of silently projecting
// `undefined`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type RecurringProjectionInput = Pick<
  RecurringItem,
  'id' | 'description' | 'category' | 'amount' | 'chargeDay' | 'status' | 'kind' | 'startDate' | 'endDate'
>;
export type LoanProjectionInput = Pick<
  Loan,
  'id' | 'name' | 'monthlyPayment' | 'startDate' | 'endDate' | 'status'
>;
export type InsuranceProjectionInput = Pick<
  Insurance,
  'id' | 'provider' | 'premium' | 'premiumFrequency' | 'status'
>;
export type AccountBalanceInput = Pick<Account, 'balance' | 'balanceUpdatedAt'>;

/**
 * The window `[fromPeriod, toPeriod]` intersected with `[startDate, endDate]`, or `null` when any
 * of the four cannot be read. `null` — never a silently widened window: an item whose dates cannot
 * be read is an item whose charges cannot be bounded, and the certain layer carries no band to
 * express doubt in.
 */
function boundedWindow(
  startDate: string | undefined,
  endDate: string | undefined,
  fromPeriod: string,
  toPeriod: string
): string[] | null {
  const start = periodOf(startDate);
  if (start === null) return null;

  // Only an ABSENT `endDate` means "open-ended". An empty string does NOT: `Loan.endDate` is a
  // required field, so `''` there is malformed data, and treating it as "no end" would project a
  // repayment forever. The distinction is `undefined`/`null` vs. any present value that must parse.
  const hasEnd = endDate !== undefined && endDate !== null;
  const end = hasEnd ? periodOf(endDate) : null;
  if (hasEnd && end === null) return null;

  // `laterPeriod`/`earlierPeriod`, not a hand-written `comparePeriod(...) ? :` ternary (T4 review
  // F-2). `comparePeriod` is total, so the ternary silently PICKED ONE SIDE when a bound was
  // malformed — here it would discard the caller's `fromPeriod` and project from the item's own
  // start, silently WIDENING the very window this function's header promises never to widen.
  const windowStart = laterPeriod(fromPeriod, start);
  const windowEnd = end !== null ? earlierPeriod(end, toPeriod) : toPeriod;
  return periodsBetween(windowStart, windowEnd);
}

/**
 * Projects a recurring item into every period of `[fromPeriod, toPeriod]` it is active for.
 *
 * THE A9 REGRESSION LIVES HERE. `computeDuePeriods` answers "which past periods does this item
 * still owe", and its range end is the CURRENT period — so it is `[]` for every forecast month.
 * This function answers a different question and shares only the primitives.
 *
 * `lastPostedPeriod` is deliberately absent from the input type: it is a CATCH-UP concept. Whether
 * September's charge has been posted yet says nothing about whether October's is coming.
 */
export function projectRecurringForward(
  item: RecurringProjectionInput,
  fromPeriod: string,
  toPeriod: string
): ForecastLineItem[] {
  if (item.status !== 'active') return [];
  const window = boundedWindow(item.startDate, item.endDate, fromPeriod, toPeriod);
  if (window === null) return [];

  const categoryId = item.category ?? CATEGORY_OTHER;
  const direction = item.kind === 'income' ? 'income' : 'expense';

  return window.map((period) => {
    const [year, month] = period.split('-').map(Number);
    return {
      period,
      categoryId,
      direction,
      amountILS: roundILS(item.amount),
      basis: {
        kind: 'recurring' as const,
        recurringId: item.id,
        description: item.description,
        // Clamped per period, not once: a chargeDay of 31 is the 28th in February and the 30th in
        // April — bank standing-order semantics, the same rule `RecurringService` posts by.
        chargeDay: clampDayToMonth(year, month, item.chargeDay),
      },
    };
  });
}

/**
 * Loan repayments. Contractual, so this is a certain-layer line with no band. The basis carries the
 * loan's NAME because D23 renders the certain layer itemised by name — that itemisation is the
 * whole mechanism by which a human can spot the loan/bank-row double count this stage discloses
 * rather than fixes.
 */
export function projectLoanForward(
  loan: LoanProjectionInput,
  fromPeriod: string,
  toPeriod: string
): ForecastLineItem[] {
  if (loan.status !== 'active') return [];
  const window = boundedWindow(loan.startDate, loan.endDate, fromPeriod, toPeriod);
  if (window === null) return [];

  return window.map((period) => ({
    period,
    categoryId: CATEGORY_LOAN_REPAYMENT,
    direction: 'expense' as const,
    amountILS: roundILS(loan.monthlyPayment),
    basis: { kind: 'loan' as const, loanId: loan.id, name: loan.name },
  }));
}

/**
 * Insurance premiums, NORMALISED TO A MONTHLY EQUIVALENT (`yearly ⇒ premium / 12`).
 *
 * The choice is stated rather than assumed, because the Stage 6 ledger already records the same
 * policy rendering as two different numbers on one screen. Charging a yearly premium once, in its
 * renewal month, would put a spike in the CERTAIN layer — a layer with no band — for a month the
 * family may never actually be billed in that pattern. The annual figure is shown alongside on
 * hover; the renderer has `insuranceId` and reads it from the policy.
 *
 * There is no end bound: `Insurance` has a `renewalDate`, which is a RENEWAL, not an end. `status`
 * is the lifecycle field, and a lapsed or cancelled policy projects nothing.
 */
export function projectInsuranceForward(
  insurance: InsuranceProjectionInput,
  fromPeriod: string,
  toPeriod: string
): ForecastLineItem[] {
  if (insurance.status !== 'active') return [];
  const monthlyEquivalent =
    insurance.premiumFrequency === 'yearly' ? insurance.premium / MONTHS_PER_YEAR : insurance.premium;

  return periodsBetween(fromPeriod, toPeriod).map((period) => ({
    period,
    categoryId: CATEGORY_INSURANCE,
    direction: 'expense' as const,
    amountILS: roundILS(monthlyEquivalent),
    basis: { kind: 'insurance' as const, insuranceId: insurance.id, provider: insurance.provider },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D10 — committed instalments
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** An already-observed `transaction_lines` row that carries instalment metadata. */
export interface ObservedInstalmentRow {
  date: string;
  description?: string;
  vendor?: string | null;
  amount: number;
  category?: string;
  /**
   * `null` is a REAL value here, not "absent": `FileProcessor.ts` writes
   * `installmentNumber: item.installmentNumber ?? null`. A `!== undefined` check reads that `null`
   * as present and then projects from `NaN`.
   */
  installmentNumber?: number | null;
  totalInstallments?: number | null;
}

/**
 * ⚠ THERE IS NO PLAN ID IN THE DATA. Plans are identified by a derived key over
 * (vendor, totalInstallments, amount), and this heuristic WILL mis-group two identical-looking
 * plans from the same vendor — two ₪300×4 purchases a month apart are indistinguishable under it.
 * The colliding-plans fixture is a permanent test documenting that known-wrong output; the hover
 * copy says the same thing to the reader.
 */
function planKeyOf(row: ObservedInstalmentRow): string {
  return `${row.vendor ?? ''}|${row.totalInstallments}|${row.amount.toFixed(2)}`;
}

/**
 * Projects the instalments a plan still owes. A row `(installmentNumber: 3, totalInstallments: 12,
 * amount: 250)` implies 9 further ₪250 charges in the 9 months after it, capped at the horizon.
 *
 * ⚠ `amount` IS ASSUMED TO BE THE PER-INSTALMENT CHARGE, NOT THE PLAN TOTAL. That assumption could
 * not be checked: the corpus contains ZERO instalment rows and no fixture in the tree sets
 * `installmentNumber` to a number. It is derived from the extraction prompt's own worked example at
 * `functions/src/handlers/aiExtractDocument.ts:149-158`, and it is marked UNCONFIRMED in
 * `__tests__/fixtures/instalmentPlan.ts`. If it is wrong, every committed plan is overstated by a
 * factor of `totalInstallments`, in a layer with no band.
 *
 * DOUBLE COUNTING ON RE-IMPORT is prevented by projecting only numbers strictly greater than the
 * highest OBSERVED number for that plan. When two observations tie on that number, the LATER one
 * anchors — under-projecting rather than over-projecting, which is the conservative direction for a
 * layer that renders as contractual fact.
 */
export function projectInstalmentsForward(
  rows: ObservedInstalmentRow[],
  fromPeriod: string,
  toPeriod: string
): ForecastLineItem[] {
  // The ONLY one of the four forward projectors that does not walk a window — its loop is bounded
  // by `totalInstallments`, so it could never hang. What it did instead was RETURN `[]`, because
  // every `comparePeriod` against a malformed bound answered the same way: on a forecast screen
  // that is indistinguishable from "this plan has finished paying". Same window contract as its
  // three siblings, so the same answer to the same bad input (T4 review F-2).
  const window = new Set(periodsBetween(fromPeriod, toPeriod));
  interface PlanAnchor {
    row: ObservedInstalmentRow;
    period: string;
    observedNumber: number;
    totalInstallments: number;
  }

  const anchors = new Map<string, PlanAnchor>();
  for (const row of rows) {
    // `== null` on purpose: it is the one comparison that catches BOTH the `null` FileProcessor
    // writes and the `undefined` an older row has. A `!== undefined` check here is the defect.
    if (row.installmentNumber == null || row.totalInstallments == null) continue;
    const period = periodOf(row.date);
    if (period === null) continue;

    const key = planKeyOf(row);
    const current = anchors.get(key);
    const candidate: PlanAnchor = {
      row,
      period,
      observedNumber: row.installmentNumber,
      totalInstallments: row.totalInstallments,
    };
    if (
      current === undefined ||
      candidate.observedNumber > current.observedNumber ||
      (candidate.observedNumber === current.observedNumber &&
        comparePeriod(candidate.period, current.period) > 0)
    ) {
      anchors.set(key, candidate);
    }
  }

  const projected: ForecastLineItem[] = [];
  for (const [planKey, anchor] of anchors) {
    let period = anchor.period;
    for (let number = anchor.observedNumber + 1; number <= anchor.totalInstallments; number++) {
      period = nextPeriod(period);
      if (comparePeriod(period, toPeriod) > 0) break;
      if (!window.has(period)) continue;
      projected.push({
        period,
        categoryId: anchor.row.category ?? CATEGORY_OTHER,
        direction: 'expense',
        amountILS: roundILS(anchor.row.amount),
        basis: {
          kind: 'installment',
          planKey,
          observedNumber: anchor.observedNumber,
          totalInstallments: anchor.totalInstallments,
        },
      });
    }
  }
  return projected.sort((a, b) => comparePeriod(a.period, b.period));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D20 — precedence as a TOTAL order
// ─────────────────────────────────────────────────────────────────────────────────────────────

type AssumptionBasis = Extract<ForecastBasis, { kind: 'assumption' }>;
type AssumptionLineItem = ForecastLineItem & { basis: AssumptionBasis };

function isAssumptionItem(item: ForecastLineItem): item is AssumptionLineItem {
  return item.basis.kind === 'assumption';
}

const LAYER_RANK: Record<ForecastLayer, number> = { assumption: 0, statistical: 1, certain: 2 };

/**
 * A stable, input-order-independent key for a basis. Every branch is derived from data the basis
 * already carries, so two items that sort equal here are genuinely indistinguishable.
 */
function basisSortKey(basis: ForecastBasis): string {
  switch (basis.kind) {
    case 'recurring':
      return `recurring|${basis.recurringId}`;
    case 'loan':
      return `loan|${basis.loanId}`;
    case 'insurance':
      return `insurance|${basis.insuranceId}`;
    case 'installment':
      return `installment|${basis.planKey}|${basis.observedNumber}`;
    case 'movingAverage':
      return `movingAverage|${basis.monthsObserved}|${basis.periods.join(',')}`;
    case 'assumption':
      return `assumption|${basis.assumptionId}`;
    default: {
      const exhaustive: never = basis;
      void exhaustive;
      throw new Error('basisSortKey: unrecognised basis kind');
    }
  }
}

/**
 * THE TOTAL ORDER, and the reason it exists: `list('family')` returns every member's assumptions,
 * and two members can collide on the same (period, category). `source: 'user'` beats `'insight'` →
 * then the LATEST `updatedAt` → then `id` ascending.
 *
 * The final `id` tiebreak is not decoration. Two parents editing the same category in the same
 * minute is ordinary, and without it the winner is Firestore's iteration order — a headline number
 * no one could reproduce. `id` is available because `createOwnedCollectionRepo.save` stamps
 * `merged.id` into the document body; T2 asserts the repo is the only writer, because
 * `list` returns `d.data()` WITHOUT `d.id` and this tiebreak degenerates silently for anything
 * written another way.
 */
function compareAssumptions(a: AssumptionLineItem, b: AssumptionLineItem): number {
  const sourceRank = (item: AssumptionLineItem) => (item.basis.source === 'user' ? 0 : 1);
  if (sourceRank(a) !== sourceRank(b)) return sourceRank(a) - sourceRank(b);
  if (a.basis.updatedAt !== b.basis.updatedAt) return a.basis.updatedAt > b.basis.updatedAt ? -1 : 1;
  return a.basis.assumptionId < b.basis.assumptionId ? -1 : a.basis.assumptionId > b.basis.assumptionId ? 1 : 0;
}

function compareByBasis(a: ForecastLineItem, b: ForecastLineItem): number {
  const rank = LAYER_RANK[layerOf(a.basis)] - LAYER_RANK[layerOf(b.basis)];
  if (rank !== 0) return rank;
  const keyA = basisSortKey(a.basis);
  const keyB = basisSortKey(b.basis);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a.amountILS - b.amountILS;
}

function compareOutput(a: ForecastLineItem, b: ForecastLineItem): number {
  const byPeriod = comparePeriod(a.period, b.period);
  if (byPeriod !== 0) return byPeriod;
  if (a.categoryId !== b.categoryId) return a.categoryId < b.categoryId ? -1 : 1;
  if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
  return compareByBasis(a, b);
}

/**
 * The bucket precedence resolves in.
 *
 * D19 states the key as (period, categoryId). `direction` is carried too, and that is a deliberate
 * REFINEMENT rather than a deviation: without it, an assumption about a category's SPEND would
 * swallow an income line that happens to sit in the same category and month, and the money would
 * vanish rather than be overridden. The refinement can only ever refuse to net two things that
 * mean opposite directions; it can never merge two things D19's key would have kept apart.
 */
function bucketKey(item: ForecastLineItem): string {
  // JSON.stringify, not a delimiter-joined string. Category ids are free Hebrew text written by
  // the extractor and by users, so ANY separator character could occur inside one and merge two
  // buckets that must stay apart. (The first draft of this line used a NUL separator, which is
  // collision-proof but makes the whole SOURCE FILE binary to `grep` and `git diff` — and this
  // repo's guards are grep- and AST-based over source text, so a file they silently skip is a
  // guard that fails open. Caught by the mutation sweep, on this line.)
  return JSON.stringify([item.period, item.categoryId, item.direction]);
}

/**
 * Resolves which source speaks for each (period, category, direction) bucket, and records what the
 * winner displaced.
 *
 * NOT a deduplicator. Two recurring charges in one category in one month are two real payments and
 * both survive — precedence is about which source speaks when sources DISAGREE about the same
 * quantity, never about collapsing facts that do not disagree.
 *
 * An assumption may override a CERTAIN item, not only a statistical one. That is the canonical §4.4
 * scenario: a user who knows the rent rises to ₪6,000 in October is the most valuable assumption in
 * the system. The certain item is not deleted — it is pushed onto `overrides`, nearest-overridden
 * first, so the card can show both numbers and name what was displaced.
 *
 * The returned array is fully sorted by `compareOutput`, which is what makes the whole function
 * order-independent rather than merely "picks the same winner".
 */
export function resolveLayerPrecedence(items: ForecastLineItem[]): ForecastLineItem[] {
  const buckets = new Map<string, ForecastLineItem[]>();
  for (const item of items) {
    const key = bucketKey(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const resolved: ForecastLineItem[] = [];
  for (const bucket of buckets.values()) {
    const assumptions = bucket.filter(isAssumptionItem).sort(compareAssumptions);
    if (assumptions.length === 0) {
      resolved.push(...bucket.slice().sort(compareByBasis));
      continue;
    }
    const others = bucket.filter((item) => !isAssumptionItem(item)).sort(compareByBasis);
    const winner = assumptions[0];
    const overrides = [
      ...assumptions.slice(1).map((item) => item.basis as ForecastBasis),
      ...others.map((item) => item.basis),
    ];
    resolved.push({ ...winner, basis: { ...winner.basis, overrides } });
  }
  return resolved.sort(compareOutput);
}

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
// D16 — the opening balance, and why its staleness is rendered
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type BalanceStaleness = 'current' | 'stale' | 'very-stale';

export interface OpeningBalance {
  amountILS: number;
  /** `max(accounts.balanceUpdatedAt)` — `netWorth.ts`'s `latestOf` precedent. */
  asOf: string;
  accountsCounted: number;
  staleness: BalanceStaleness;
}

/**
 * The opening balance is THE LEAST CERTAIN INPUT IN THE WHOLE COMPUTATION and is not allowed to sit
 * inside a solid "certain" figure. A balance last touched in March, projected three months forward,
 * is wrong by the whole intervening period — so the staleness grade travels with the number and the
 * screen says the date in words.
 *
 * Returns `null` — never `0` — for an empty account list. A ₪0 opening balance and an unknown
 * opening balance are opposite statements, and a forecast built on the first while meaning the
 * second is wrong by the family's entire savings. D17 turns that `null` into a named gap.
 *
 * Archived accounts are NOT filtered here. This function reflects exactly what the caller passed,
 * which is `netWorth.ts`'s stated convention for the same collection — the caller applies its own
 * data selection, the same way Rules-enforced scope is already resolved before this is reached.
 */
export function computeOpeningBalance(
  accounts: AccountBalanceInput[],
  referenceDate: string
): OpeningBalance | null {
  if (accounts.length === 0) return null;

  const amountILS = roundILS(accounts.reduce((sum, account) => sum + account.balance, 0));
  const asOf = accounts
    .map((account) => account.balanceUpdatedAt)
    .reduce((latest, candidate) => (latest > candidate ? latest : candidate));

  const ageInDays = daysBetweenDates(asOf, referenceDate);
  // An UNREADABLE timestamp fails toward disclosure. "We do not know how old this is" has exactly
  // one honest rendering on a staleness axis, and it is the worst one — never 'current'.
  const staleness: BalanceStaleness =
    ageInDays === null
      ? 'very-stale'
      : ageInDays <= STALENESS_CURRENT_MAX_DAYS
        ? 'current'
        : ageInDays <= STALENESS_STALE_MAX_DAYS
          ? 'stale'
          : 'very-stale';

  return { amountILS, asOf, accountsCounted: accounts.length, staleness };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D32 — the horizon, the forward anchor clamp, and the composed result
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `months` periods starting at `anchorPeriod`, inclusive.
 *
 * REFUSES rather than returning `[]` (T1-review follow-up 2). The old `if (months < 1) return []`
 * had no test on it and no caller validating what it was handed, so `0`, `-1`, `2.5` and `NaN` all
 * produced an empty horizon that renders exactly like a horizon with nothing in it. This module's
 * standing rule since `computeDuePeriods`' empty-`startDate` heap death is that malformed input
 * refuses loudly instead of degrading into a plausible-looking empty answer.
 */
export function horizonPeriods(anchorPeriod: string, months: number): string[] {
  if (!Number.isInteger(months) || months < 1 || months > MAX_HORIZON_MONTHS) {
    throw new Error(
      `horizonPeriods: months must be an integer in 1..${MAX_HORIZON_MONTHS}, got ${String(months)}`
    );
  }
  let end = anchorPeriod;
  for (let i = 1; i < months; i++) end = nextPeriod(end);
  return periodsBetween(anchorPeriod, end);
}

export interface ForecastPeriodTotals {
  period: string;
  /**
   * The three layer totals are OUTFLOW ONLY — they are the split of what leaves in a month (D39's
   * stacked bar), and they sum to `expenseILS`. Income is carried separately in `incomeILS`; a
   * certain salary line is an inflow and must never be counted into `certainILS`.
   */
  certainILS: number;
  statisticalILS: number;
  assumptionILS: number;
  incomeILS: number;
  expenseILS: number;
}

export interface ForecastResult {
  /** After the forward clamp — this is the month the forecast actually starts at. */
  anchorPeriod: string;
  /** True when the caller's anchor was in the past and was moved forward (D32a). */
  anchorClamped: boolean;
  horizon: string[];
  /** Precedence-resolved and fully sorted; only items inside `horizon`. */
  lineItems: ForecastLineItem[];
  /** One row per horizon month, ALWAYS — a month with nothing in it is a zero row, not a gap. */
  byPeriod: ForecastPeriodTotals[];
}

export interface ComposeForecastInput {
  /** The month the viewer selected via מתי. May be in the past; it is clamped, not honoured. */
  anchorPeriod: string;
  /**
   * The current period, PASSED IN. This module reads no clock — which month it is depends on a
   * timezone, and that decision belongs to the caller (`APP_TIMEZONE`), not to arithmetic.
   */
  todayPeriod: string;
  horizonMonths?: number;
  lineItems: ForecastLineItem[];
}

/**
 * Composes projected line items into the result the screen renders.
 *
 * THE ANCHOR IS CLAMPED FORWARD (D32a). מתי is a month stepper with unbounded previous arrows, and
 * a past month is not forecastable. Silently back-projecting it is the only unacceptable option —
 * but so is silently ignoring the control the user just used, which is why `anchorClamped` is
 * reported rather than the clamp being applied invisibly.
 */
/**
 * D32(a)'s forward clamp and the horizon it produces — SPLIT OUT IN T7a, because the caller needs
 * the clamped window BEFORE it can project anything into it.
 *
 * `useForecast` has to know `[from, to]` in order to run the four forward projectors and to build
 * the lookback window, and it then hands the resulting items back to `composeForecast`. Without
 * this split the hook would have to re-derive the clamp, and a clamp rule spelled in two places is
 * a clamp rule that disagrees once — on the one control (מתי) whose misbehaviour A18 called the
 * only unacceptable option.
 *
 * The clamp itself is unchanged and its reasoning is unchanged. The T4 review's proof that the
 * horizon hang was REACHABLE was this line: `comparePeriod('', '')` is 0, so with both inputs
 * malformed "the clamp does not fire" and the walk ran forever. `laterPeriod` refuses both
 * operands, so the clamp not firing is no longer a state this function can be in.
 */
export function forecastHorizonOf(input: {
  anchorPeriod: string;
  todayPeriod: string;
  horizonMonths?: number;
}): { anchorPeriod: string; anchorClamped: boolean; horizon: string[] } {
  const anchorPeriod = laterPeriod(input.anchorPeriod, input.todayPeriod);
  const anchorClamped = anchorPeriod !== input.anchorPeriod;
  const horizon = horizonPeriods(anchorPeriod, input.horizonMonths ?? DEFAULT_HORIZON_MONTHS);
  return { anchorPeriod, anchorClamped, horizon };
}

export function composeForecast(input: ComposeForecastInput): ForecastResult {
  const { anchorPeriod, anchorClamped, horizon } = forecastHorizonOf(input);
  const inHorizon = new Set(horizon);

  const lineItems = resolveLayerPrecedence(input.lineItems.filter((item) => inHorizon.has(item.period)));

  const byPeriod: ForecastPeriodTotals[] = horizon.map((period) => {
    const totals: ForecastPeriodTotals = {
      period,
      certainILS: 0,
      statisticalILS: 0,
      assumptionILS: 0,
      incomeILS: 0,
      expenseILS: 0,
    };
    for (const item of lineItems) {
      if (item.period !== period) continue;
      if (item.direction === 'income') {
        totals.incomeILS = roundILS(totals.incomeILS + item.amountILS);
        continue;
      }
      totals.expenseILS = roundILS(totals.expenseILS + item.amountILS);
      const layer = layerOf(item.basis);
      if (layer === 'certain') totals.certainILS = roundILS(totals.certainILS + item.amountILS);
      else if (layer === 'statistical') totals.statisticalILS = roundILS(totals.statisticalILS + item.amountILS);
      else totals.assumptionILS = roundILS(totals.assumptionILS + item.amountILS);
    }
    return totals;
  });

  return { anchorPeriod, anchorClamped, horizon, lineItems, byPeriod };
}

export interface ProjectedBalancePoint {
  period: string;
  projectedBalanceILS: number;
}

/**
 * D16's formula, month by month:
 *
 *     projectedBalance(p) = openingBalance + Σ_{m ≤ p} income(m) − Σ_{m ≤ p} expense(m)
 *
 * It lives here rather than in `useForecast` because it IS the headline number's definition, and a
 * formula that lives in a React hook is a formula no pure test can hold.
 *
 * Returns `[]` when `openingBalanceILS` is `null`. Substituting `0` would print a confident balance
 * built on a number nobody has — and D17's rule is that if ANY balance-contributing input is not
 * `'ok'`, the balance is `null` and a named gap renders in its place. The caller decides which
 * inputs were readable; this function refuses to invent the one it was not given.
 */
export function projectedBalanceByPeriod(
  openingBalanceILS: number | null,
  byPeriod: ForecastPeriodTotals[]
): ProjectedBalancePoint[] {
  if (openingBalanceILS === null || openingBalanceILS === undefined) return [];
  let running = openingBalanceILS;
  return byPeriod.map((month) => {
    running = roundILS(running + month.incomeILS - month.expenseILS);
    return { period: month.period, projectedBalanceILS: running };
  });
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

/**
 * D26 row 0's onboarding path: the inputs that are missing, BY NAME, in a fixed order.
 *
 * The order is the order a family would sensibly fill them in, and it is fixed so the count and the
 * list cannot disagree between renders. T7b turns each key into a deep link with Stage 5 D11's
 * pre-filled navigation payload; T5 owns which inputs there are and what they are called.
 */
const FORECAST_INPUT_ORDER: ForecastInputKey[] = [
  'accounts',
  'incomes',
  'recurring',
  'loans',
  'insurances',
  'history',
];

export function missingForecastInputs(
  present: Record<ForecastInputKey, boolean>
): Array<{ key: ForecastInputKey; labelHe: string }> {
  return FORECAST_INPUT_ORDER.filter((key) => !present[key]).map((key) => ({
    key,
    labelHe: FORECAST_INPUT_LABEL_HE[key],
  }));
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
 * The certain layer's own empty state (A9). `''` when there are items to itemise.
 *
 * §12's SECOND no-₪0 corpus shape. A horizon month with no recurring, loan or insurance charge at
 * all has `certainILS: 0` — a real and correct total — but the ITEMISED list D23 promises has
 * nothing in it, and rendering "₪0" where the list would be says "the committed part of this month
 * costs nothing", which is a claim about contracts rather than about our data. The sentence says
 * what is actually true: none are known.
 */
export function certainLayerSummaryHe(items: ForecastLineItem[]): string {
  const certain = items.filter((item) => layerOf(item.basis) === 'certain');
  return certain.length === 0 ? CERTAIN_LAYER_EMPTY_HE : '';
}

/**
 * Narrows the GATED history corpus into the instalment shape D10's projector reads.
 *
 * ── !! IT TAKES THE HANDLE, NOT ROWS, AND THAT IS T7a-REVIEW F1 ───────────────────────────────
 *
 * It used to take `ReadonlyArray<Record<string, unknown>>`, and `useForecast` handed it
 * `read.rows` — `StatisticalHistoryResult`'s RAW row array, the ungated sibling travelling beside
 * the sealed handle rather than through it. Both came out of the same `loadStatisticalHistory`
 * call, so it read as safe; the door gated the handle and the rows walked past it.
 *
 * The review built the exploit: a REAL sealed handle over three ₪100 grocery rows, paired with a
 * result whose `rows` was one ungated `{vendor: 'FORGED', amount: 9999, installmentNumber: 1,
 * totalInstallments: 12}`, produced `basis.kind: 'installment'`, `amountILS: 9999`, in EVERY
 * horizon month — inside `certainILS`, which is the highest-confidence bucket this app has and
 * the one D38 renders as `מזה כבר סגור`. Not reachable from `DEFAULT_FORECAST_READERS` as it
 * stood, and reachable the moment T7b re-slices rows for D21(b)'s מי filter, which is both the
 * obvious move and silently wrong.
 *
 * So the instalment layer takes its rows off the handle, through the same two checks
 * `buildStatisticalLayer` makes and in the same order: a refusal yields nothing, and a handle that
 * did not come through the door THROWS rather than being averaged. There is no exported entry
 * point that accepts an array, because an entry point that accepts an array is the bypass.
 *
 * ── WHY THE NARROWING IS A FUNCTION AND NOT A CAST ────────────────────────────────────────────
 *
 * `transaction_lines` is schemaless, read through a NON-STRICT tsconfig, and T0's live probes put
 * a `date` of the NUMBER `12345` into it from a parent's account. `rows as ObservedInstalmentRow[]`
 * compiles and then hands `planKeyOf` a `row.amount.toFixed` that does not exist. Every field is
 * read here, where the document meets the declared shape, which is the same place
 * `countsTowardMovingAverage` does its own narrowing and for the same reason.
 *
 * A row with no readable `date` or `amount` is DROPPED rather than defaulted: it cannot anchor a
 * plan, and a defaulted amount would silently join a plan key it does not belong to. `null` is
 * PRESERVED on the two instalment fields, because `FileProcessor` writes `installmentNumber: null`
 * for manual rows and D10's `== null` check is what distinguishes that from a real number.
 */
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

export function observedInstalmentRowsOf(
  history: StatisticalHistoryHandle
): ObservedInstalmentRow[] {
  // A refusal is not an error here: D21(d) means there is no corpus in memory at all, so there is
  // nothing to commit and nothing to disclose. The history INPUT's own grade already says so.
  if (history.status !== 'ready') return [];
  // The runtime half of the door, identical to `buildStatisticalLayer`'s and deliberately not
  // abbreviated to a brand read: everything readable off the object is copyable, and the review
  // that closed this class proved it three ways.
  if (!isGatedStatisticalHistory(history)) {
    throw new Error(
      '[observedInstalmentRowsOf] refusing history that did not come through `loadStatisticalHistory`: ' +
        'these rows become CERTAIN line items, so an ungated corpus lands in the highest-confidence ' +
        'bucket on the card.'
    );
  }
  const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const observed: ObservedInstalmentRow[] = [];
  for (const sealedRow of history.rows) {
    // `StatisticalHistoryRow` names the seven fields the STATISTICAL layer consults; the instalment
    // fields are not among them, and adding them there would claim the document's field set is
    // closed when it is not. One widening at the point of use, to the type the document actually
    // has — every value `unknown`, narrowed on the next five lines.
    const row: Record<string, unknown> = sealedRow;
    if (typeof row.date !== 'string') continue;
    const amount = numberOrNull(row.amount);
    if (amount === null) continue;
    observed.push({
      date: row.date,
      amount,
      description: typeof row.description === 'string' ? row.description : undefined,
      vendor: typeof row.vendor === 'string' ? row.vendor : null,
      category: typeof row.category === 'string' ? row.category : undefined,
      installmentNumber: numberOrNull(row.installmentNumber),
      totalInstallments: numberOrNull(row.totalInstallments),
    });
  }
  return observed;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7a — THE THREE PURE PIECES `useForecast` NEEDS AND NOBODY HAD BUILT
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// T7a is the first production consumer of this module, and wiring it surfaced three joints that
// every earlier task had assumed somebody else owned:
//
//   1. `resolveCategoryOfScope` (T1) had ZERO production callers, because NOTHING TURNS AN
//      ASSUMPTION DOCUMENT INTO A LINE ITEM. `resolveLayerPrecedence`'s assumption branch — D19's
//      whole override mechanism, and §4.4's canonical "the rent rises to ₪6,000 in October"
//      scenario — was therefore unreachable from real data while its tests passed on hand-built
//      fixtures. That is A13's defect ("its most valuable disclosure never fires while its test
//      passes") arriving one layer lower than A13 found it. `assumptionLineItems` is the joint.
//
//   2. D17's suppression rule had no home. It is arithmetic about which figure may render, so it
//      belongs beside the figure's definition and not inside a React hook where no pure test can
//      hold it — the same argument `projectedBalanceByPeriod`'s own header already makes.
//
//   3. D38's verdict state had no threshold. "Near-zero" was a word in the plan; `NEAR_ZERO_ILS`
//      is the number, named rather than inlined at the one call site, because a colour rule with an
//      invisible boundary is a rule the next renderer re-invents.

/**
 * Turns the `forecast_assumptions` a family has authored into line items precedence can resolve.
 *
 * ── WHY EVERY REFUSAL BELOW IS A SKIP AND NOT A THROW ────────────────────────────────────────
 *
 * These values come off DOCUMENTS. This module's own register (stated in `computeAllowance`'s
 * comment) is that document-sourced malformation is refused quietly and caller-contract violation
 * throws — `parseHebrewGoalPeriod` returns `null`, `horizonPeriods` throws. An assumption with an
 * unreadable amount is a family's data being wrong, not this app's arithmetic being wrong, and one
 * bad row must not take the whole card down.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────────
 *
 * `'seasonality'` and `'personalTarget'` produce NO line item, and that is not an omission — it is
 * `resolveCategoryOfScope` returning `null` for both, for the two reasons written out at that
 * function. A seasonality assumption carries an unused `amountILS` that every writer stamps as `0`,
 * so giving it a bucket would REPLACE a real estimate with ₪0 in the month a family said was
 * expensive. A `personalTarget` is what an allowance is computed against, not a charge.
 *
 * `direction` is always `'expense'`. `ForecastAssumption` has no direction field, and the four
 * scopes that map to a category (`recurring`, `loan`, `insurance`, `category`) are all outflow
 * buckets — a recurring INCOME item's own line is `direction: 'income'`, so it sits in a different
 * `bucketKey` and an assumption cannot silently swallow it. That is `resolveLayerPrecedence`'s
 * documented refinement, and this function relies on it rather than restating it.
 */
export function assumptionLineItems(input: {
  assumptions: ForecastAssumption[];
  certainItems: ForecastLineItem[];
  horizon: string[];
}): ForecastLineItem[] {
  const items: ForecastLineItem[] = [];
  for (const assumption of input.assumptions) {
    if (assumption.status !== 'active') continue;
    // A `source` this stage does not ship a renderer for is not rendered. D25(b)/A16 cut the
    // `'insight'` renderer and kept the field so Stage 8 is a RULES widening rather than a schema
    // migration; a client that drew one anyway would defeat a boundary enforced in `firestore.rules`
    // from the one side Rules cannot see.
    if (assumption.source !== 'user') continue;
    if (!Number.isFinite(assumption.amountILS) || assumption.amountILS < 0) continue;
    const categoryId = resolveCategoryOfScope(
      assumption.scopeKind,
      assumption.scopeId,
      input.certainItems
    );
    if (categoryId === null) continue;
    for (const period of input.horizon) {
      if (!windowCoversAnyPeriod(assumption.fromPeriod, assumption.toPeriod, [period])) continue;
      items.push({
        period,
        categoryId,
        direction: 'expense',
        amountILS: roundILS(assumption.amountILS),
        basis: {
          kind: 'assumption',
          assumptionId: assumption.id,
          source: assumption.source,
          updatedAt: String(assumption.updatedAt),
          // EMPTY HERE, FILLED BY PRECEDENCE. `resolveLayerPrecedence` is the only function that
          // knows what this assumption displaced, and D19's stack is ordered nearest-overridden
          // first. Pre-populating it here would be a second, disagreeing answer to the same
          // question.
          overrides: [],
        },
      });
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D17 — suppression by input PRESENCE, graded per input
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The keys `useForecast` grades. `ForecastInputKey`'s six are the balance-contributing ones (D17's
 * table); `assumptions` and `goals` are read too, and neither adds or removes money from the
 * balance — one modifies amounts, the other names a target — so neither may suppress it.
 *
 * D18 spells this union with `transactionHistory` and a ninth `budgetConfig` member. Both are
 * departed from, deliberately, and §the T7a report says so:
 *   · `history` rather than `transactionHistory`, because `ForecastInputKey` already names that
 *     input and D26 row 0 already labels it. Two spellings of one input is how the count and the
 *     list disagree.
 *   · NO `budgetConfig`. The T6 review measured `settings/budgetConfig` to hold per-category SPEND
 *     CAPS while every target this stage resolves is savings-shaped, removed it as a target source,
 *     and put a repo-wide assertion on the field name. An input key for a document nothing reads is
 *     the invented-field defect that measurement deleted.
 */
export type ForecastInputStateKey = ForecastInputKey | 'assumptions' | 'goals';

/**
 * D17's grading. `'empty'` is a SUCCESSFUL read of nothing, which is the case A2 was about.
 *
 * !! `'unresolved'` IS T7a-REVIEW F9, AND IT REPLACES A STATE THAT WAS A LIE. The hook's
 * placeholder — what every input reports before the reads settle — was `{state: 'error'}`, so
 * during loading all eight inputs claimed a fault. It was inert in `ForecastCard` only because
 * that component branches on the scalar `status` first and never reaches the record; the finding
 * was that T7b must remember to do the same or render eight false error states, which is a
 * requirement no test held. A state that means "this read has not answered yet" is the honest
 * name for it, and it costs T7b nothing to get right.
 *
 * It suppresses, like every non-`'ok'` state: an unresolved input is not a present one.
 */
export type ForecastInputState = 'ok' | 'denied' | 'empty' | 'error' | 'unresolved';

export interface ForecastInputStatus {
  scope: 'own' | 'family' | 'none';
  state: ForecastInputState;
  count: number;
}

/**
 * The inputs `projectedBalance` is built from — D17's table, as a value.
 *
 * IT IS `FORECAST_INPUT_ORDER` ITSELF, not a second list that happens to agree. Every input D26 row
 * 0 names as missing is an input the balance needs, and the onboarding order is the order the gap
 * sentence should read in, so one array serves both and cannot drift from itself. `goals` and
 * `assumptions` are absent for the reason above.
 */
export const BALANCE_CONTRIBUTING_INPUTS: readonly ForecastInputKey[] = FORECAST_INPUT_ORDER;

/**
 * D17, and this is the whole rule: **if ANY balance-contributing input is not `'ok'`,
 * `projectedBalance` is `null` and a named gap renders in its place.**
 *
 * Returned in `BALANCE_CONTRIBUTING_INPUTS` order so the count and the sentence can never disagree
 * about which inputs are missing or in what order they are read out.
 *
 * !! `'empty'` SUPPRESSES, AND THAT IS THE FINDING A2 IS BUILT ON. v1's rule keyed on PERMISSION,
 * and the measured corpus has `incomes: 0`, `accounts: 0`, `recurring: 0` — income is zero BY
 * ABSENCE, for everyone, in family scope, on the Dashboard. A permission-keyed guard would not fire
 * and a plunging negative balance would render at glance scale, authoritative and false.
 */
export function suppressedBalanceInputs(
  inputs: Record<ForecastInputStateKey, ForecastInputStatus>
): ForecastInputKey[] {
  return suppressedInputs(inputs, BALANCE_CONTRIBUTING_INPUTS);
}

/**
 * The inputs an OUTFLOW figure is built from — the `'own'` card's glance number (D29d/D38).
 *
 * `accounts` and `incomes` are absent because neither adds to what goes OUT. The other four are all
 * of it: three forward projectors and the moving average.
 */
export const OUTFLOW_CONTRIBUTING_INPUTS: readonly ForecastInputKey[] = [
  'recurring',
  'loans',
  'insurances',
  'history',
];

/**
 * D17 GENERALISED, because the `'own'` card needs the identical rule over a different set.
 *
 * !! AND THE REASON IT NEEDS ONE AT ALL IS WORTH STATING. `projectedExpense` is a SUM: with the
 * statistical layer refused or the recurring list unreadable it does not go wrong, it goes SMALL —
 * and "₪1,200 will go out this quarter" rendered at glance scale, on a card headed `צפוי לצאת`,
 * while three of its four inputs are missing, is the same lie as a false balance told in the
 * quieter direction. A figure that is understated by an unknown amount is not a figure.
 *
 * The two sets are DIFFERENT and both are named, rather than one rule reused with a comment: an
 * empty `accounts` collection must not blank the `'own'` card, because the `'own'` card never draws
 * a balance and has no use for an opening balance.
 */
export function suppressedOutflowInputs(
  inputs: Record<ForecastInputStateKey, ForecastInputStatus>
): ForecastInputKey[] {
  return suppressedInputs(inputs, OUTFLOW_CONTRIBUTING_INPUTS);
}

/** The shared body. One filter, two named sets — never two filters that agree until one is edited. */
function suppressedInputs(
  inputs: Record<ForecastInputStateKey, ForecastInputStatus>,
  keys: readonly ForecastInputKey[]
): ForecastInputKey[] {
  return keys.filter((key) => inputs[key].state !== 'ok');
}

/**
 * The one line that decides whether a projected balance exists — and the one place the two rules
 * that answer that question are made to agree.
 *
 * ── !! T7a-REVIEW F5/F6, WHICH IS WHY THIS IS A FUNCTION AND NOT AN EXPRESSION ────────────────
 *
 * Two independent rules govern the headline figure. D17's SUPPRESSION rule asks whether every
 * balance-contributing input graded `'ok'`; the BALANCE-EXISTENCE rule asks whether
 * `computeOpeningBalance` produced a number to project from. The review rendered and captured
 * them disagreeing: with every account ARCHIVED, `accounts` graded `'ok'` because the collection
 * has documents, so nothing was suppressed — while the opening balance was `null`, because the
 * archived accounts were filtered out before it was computed. The card took its gap branch with
 * an EMPTY gap list and rendered a glance `"0"` above `לא ניתן להציג יתרה צפויה — חסרים 0 נתונים: `
 * — a trailing colon with nothing after it, and a zero in the position D26 row 0 reserves for a
 * COUNT.
 *
 * `useForecast` now grades `accounts` on the ACTIVE accounts, which is the same set the opening
 * balance is computed from, so the reachable instance is gone. This function is what refuses the
 * disagreement itself. It THROWS rather than returning `null`, on this module's standing register:
 * document-sourced malformation is refused quietly, and caller-contract violation throws. "No
 * balance and no named gap" is not a state the family's data can be in — it is this app's own two
 * rules having come apart, and the hook's catch renders it as the error card, which is the state
 * that means somebody has to go and fix something.
 */
export function resolveProjectedBalanceILS(
  suppressed: readonly ForecastInputKey[],
  balancePoints: readonly ProjectedBalancePoint[]
): number | null {
  if (suppressed.length > 0) return null;
  if (balancePoints.length === 0) {
    throw new Error(
      '[resolveProjectedBalanceILS] no balance and no named gap: every balance-contributing input ' +
        'graded `ok` while the opening balance was absent, so D17`s suppression rule and the ' +
        'balance-existence rule disagree. The card would render a glance `0` above an empty gap list.'
    );
  }
  return balancePoints[balancePoints.length - 1].projectedBalanceILS;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D38 — the verdict state
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The half-width of D38's neutral band, in shekels.
 *
 * A projected balance of ₪40 is not "the family is fine" and it is not "the family is short" — it
 * is the arithmetic landing inside its own uncertainty, and colouring it green or amber asserts a
 * precision the inputs do not have. ₪100 is a stated round number rather than a derived one, and
 * saying so is the honest form: there is no distribution here to take a standard error from, which
 * is the same reason D3 refuses a symmetric multiplier.
 */
export const NEAR_ZERO_ILS = 100;

/**
 * D38's three verdict states. DECLARED IN `forecastCopy.ts`, beside the words that carry them, and
 * re-exported here under the same asymmetry this module already states: the TYPES are re-exported
 * so a consumer naming one can name its siblings from one place, and the STRINGS never are.
 */
export type { BalanceVerdict } from './forecastCopy';

/**
 * D38's conditional colour rule, as a value the renderer switches on.
 *
 * IT IS A FUNCTION AND NOT A TERNARY IN A COMPONENT, because D38 requires a Hebrew word to carry
 * the state alongside the colour — so two renderers (the card now, the screen in T7b) must reach
 * the same three-way answer, and a rule spelled twice is a rule that disagrees once.
 *
 * REFUSES a non-finite balance. Unlike an assumption's amount this is THIS APP'S OWN ARITHMETIC —
 * `projectedBalanceByPeriod` over amounts every producer has already rounded — so a `NaN` here is a
 * caller-contract violation, and `computeAllowance`'s register applies: a non-finite figure that
 * reaches a comparison satisfies neither `> 0` nor `< 0` and lands in whichever branch is last.
 */
export function balanceVerdictOf(balanceILS: number): BalanceVerdict {
  if (!Number.isFinite(balanceILS)) {
    throw new Error(
      `balanceVerdictOf: balanceILS must be a finite number, got ${String(balanceILS)}. ` +
        'A non-finite balance satisfies no comparison and would be coloured by whichever branch is last.'
    );
  }
  if (Math.abs(balanceILS) < NEAR_ZERO_ILS) return 'near-zero';
  // !! A KNOWN EQUIVALENT MUTANT, REPORTED RATHER THAN HIDDEN — this module's convention, and its
  // third instance after the two in `statisticalHistory.ts`. Replacing `> 0` with `>= 0` survives
  // every test, twice, and no input can distinguish the two: the line above has already returned
  // for every balance inside the neutral band, so `0` — the only value the two spellings disagree
  // about — can never reach here. The strict comparison stays because "positive" is what the
  // branch means, and the boundary that IS load-bearing (`NEAR_ZERO_ILS` itself, on both sides of
  // zero) is pinned by a test.
  return balanceILS > 0 ? 'positive' : 'negative';
}
