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
// ── WHAT IS LEFT HERE AFTER T7c'S SPLIT, AND WHERE THE REST WENT ───────────────────────────────
//
// This file was 2,181 lines and ~74 exports. The T5 review named two seams, the T6 review restated
// them, and T7b deferred the work on the correct grounds that a 2,100-line refactor does not belong
// inside a 4,000-line feature commit. T7c is that refactor, in its own commit, adding no feature
// and changing no behaviour:
//
//   · `./forecastBasis` — D19/D20. WHAT a forecast line item is (`ForecastBasis`, `ForecastLineItem`,
//     `ObservedBand`), the layer it derives to (`layerOf`), the bucket an assumption's scope maps
//     onto (`resolveCategoryOfScope`), which source speaks for a bucket (`resolveLayerPrecedence`),
//     the three `CATEGORY_*` bucket keys, and `roundILS`.
//   · `./statisticalLayer` — T5/T6. The moving average over sealed history, end to end, plus the
//     band, the cold-start table, the row ceiling and the per-month confidence chip.
//
// What remains is the CERTAIN LAYER'S FORWARD PROJECTORS and the COMPOSER: the four things that
// turn documents into future line items, the opening balance, the horizon and its forward clamp,
// `composeForecast`, `projectedBalanceByPeriod`, and D17/D38's rules about when the headline figure
// may render at all. The dependency runs one way — this file imports both new modules' vocabulary
// and neither imports it back.
//
// ── THE ONE SENTENCE THAT GOVERNS THIS STAGE ───────────────────────────────────────────────────
//
// This is the first thing in the app that states something about the future, and a forecast that
// looks authoritative and is wrong is worse than no forecast. Two structural consequences live in
// this stage, and the split did not change either of them:
//
//   1. `computeDuePeriods` CANNOT PROJECT FORWARD. It caps its range end at the current period, so
//      for any future month it returns `[]`. Reusing it for the certain layer ships a layer that
//      is empty in every forecast month WITH GREEN TESTS, because the line items are absent rather
//      than wrong. `projectRecurringForward` below is a genuinely new function, and importing
//      `computeDuePeriods` here is banned — by name, in `forecastPurity.test.ts`.
//
//   2. PRECEDENCE MUST BE A TOTAL ORDER. Two members can hold assumptions colliding on the same
//      (period, category). Without a tiebreak the winner is whatever order Firestore returned —
//      non-deterministic money on the headline number. `resolveLayerPrecedence` sorts, and its
//      canonical test shuffles the input and asserts the output does not move. It now lives in
//      `./forecastBasis`, beside the union it sorts; `composeForecast` calls it and nothing else
//      in this file needs to know how it decides.
//
// ── HOW `layer` IS CARRIED ─────────────────────────────────────────────────────────────────────
//
// It is NOT a field. `layerOf(basis)` — in `./forecastBasis` — derives it, and the compiler enforces
// exhaustiveness over the union. A stored `layer` breaks in snapshots and fixtures where the
// pinning test does not look, and here the redundancy buys nothing at all.
import {
  CATEGORY_INSURANCE,
  CATEGORY_LOAN_REPAYMENT,
  CATEGORY_OTHER,
  layerOf,
  resolveCategoryOfScope,
  resolveLayerPrecedence,
  roundILS,
} from './forecastBasis';
import type { ForecastLineItem } from './forecastBasis';
// T5-review F8 — THE COPY LIVES IN ITS OWN MODULE, and the dependency runs ONE WAY: this file
// imports strings, `forecastCopy.ts` imports nothing. The seven blocks of Hebrew UI copy that used
// to sit in the middle of this arithmetic are there, together with the four key unions that index
// them. `forecastCopy.test.ts` holds the seam — including that no new UI sentence can appear in
// any of the three engine modules T7c's split produced without the guard seeing it.
import { CERTAIN_LAYER_EMPTY_HE, FORECAST_INPUT_LABEL_HE } from './forecastCopy';
import type { BalanceVerdict, ForecastInputKey } from './forecastCopy';
import {
  clampDayToMonth,
  comparePeriod,
  daysBetweenDates,
  earlierPeriod,
  laterPeriod,
  nextPeriod,
  periodOf,
  periodsBetween,
  windowCoversAnyPeriod,
} from './periodMath';
import { isGatedStatisticalHistory } from './statisticalHistory';
import type { StatisticalHistoryHandle } from './statisticalHistory';
import type {
  Account,
  ForecastAssumption,
  Insurance,
  Loan,
  RecurringItem,
} from '../types/finance';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Named constants — no bare literals, and each one is pinned to something that already exists
// ─────────────────────────────────────────────────────────────────────────────────────────────

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

const MONTHS_PER_YEAR = 12;

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
// D26 row 0 — the inputs, by name
//
// The rest of D26's table — which row a family is in, and what each row draws — is keyed on
// `monthsObserved` and went to `./statisticalLayer` with the history that produces it (T7c). What
// stays here is the INPUT LIST itself, because `BALANCE_CONTRIBUTING_INPUTS` below IS this array
// and D17's suppression rule reads it: one array serves the onboarding sentence and the balance
// gate, and it cannot drift from itself.
// ─────────────────────────────────────────────────────────────────────────────────────────────

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
 * `ForecastInputKey`, re-exported from where its labels live — the copy type that appears inside
 * `ForecastInputStateKey` below and inside `FORECAST_INPUT_ORDER` above.
 *
 * The asymmetry `forecastBasis.ts` states for `BandBasis` holds here too: the TYPE is re-exported
 * so a consumer naming `ForecastInputStateKey` can name its six-member half from the same place,
 * and `FORECAST_INPUT_LABEL_HE` — the STRINGS — is never re-exported from a computation module.
 */
export type { ForecastInputKey } from './forecastCopy';

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
