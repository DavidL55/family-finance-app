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
import {
  clampDayToMonth,
  comparePeriod,
  daysBetweenDates,
  earlierPeriod,
  laterPeriod,
  nextPeriod,
  periodOf,
  periodsBetween,
} from './periodMath';
import type { Account, AssumptionScopeKind, Insurance, Loan, RecurringItem } from '../types/finance';

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
function roundILS(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D19 — the provenance union
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** D24: a seasonal multiplier always names where it came from and how many months backed it. */
export interface SeasonalFactor {
  factor: number;
  source: 'observed' | 'user';
  n: number;
}

export type ForecastBasis =
  | { kind: 'recurring'; recurringId: string; description: string; chargeDay: number }
  | { kind: 'loan'; loanId: string; name: string }
  | { kind: 'insurance'; insuranceId: string; provider: string }
  | { kind: 'installment'; planKey: string; observedNumber: number; totalInstallments: number }
  | { kind: 'movingAverage'; monthsObserved: number; periods: string[]; seasonalFactor: SeasonalFactor | null }
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
export function composeForecast(input: ComposeForecastInput): ForecastResult {
  // D32(a)'s forward clamp, expressed as the clamp it is. The T4 review's proof that the horizon
  // hang was REACHABLE was this line: `comparePeriod('', '')` is 0, so with both inputs malformed
  // "the clamp does not fire" and the walk ran forever. `laterPeriod` refuses both operands, so
  // the clamp not firing is no longer a state this function can be in.
  const anchorPeriod = laterPeriod(input.anchorPeriod, input.todayPeriod);
  const anchorClamped = anchorPeriod !== input.anchorPeriod;
  const horizon = horizonPeriods(anchorPeriod, input.horizonMonths ?? DEFAULT_HORIZON_MONTHS);
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
