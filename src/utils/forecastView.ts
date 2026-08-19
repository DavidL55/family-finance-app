// src/utils/forecastView.ts — Stage 7 T7b. THE RENDER MODEL, PURE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS MODULE IS FOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// D39, D40 and D41 are three rulings about ONE bar. Between them they decide which segments exist,
// which are absent, where the whisker is anchored, what the axis is allowed to see, and which chip
// the month carries. Every one of those is a decision that a rendered-DOM assertion cannot check:
// A21 says outright that all three obvious gap renderings pass a "no ₪0" string guard, because that
// guard tests the string and not the picture.
//
// So the SHAPE is computed here, by pure functions with their own table-driven tests, and the chart
// component draws what it is handed. `ForecastChart.tsx` contains no arithmetic at all.
//
// ── WHY IT IS NOT IN `forecast.ts` ────────────────────────────────────────────────────────────
//
// The T6 review's closing note asked for `forecast.ts` to be SPLIT before T7b added a screen's
// worth of composition to it. This module does not perform that split — the report says so plainly
// rather than implying otherwise — but it does mean T7b adds none of its own composition to a file
// that is already 2,100 lines. `forecast.ts` gains exactly one line from this task: `roundILS`
// becomes exported, so there is not a third private copy of it.
//
// ── PURITY ────────────────────────────────────────────────────────────────────────────────────
//
// This module is on `FORECAST_ENTRY_MODULES`, so `forecastPurity.test.ts` walks it: no
// `firebase/*`, no `src/services`, no `src/contexts`, no `src/components`, and no clock. It renders
// no strings either — every Hebrew sentence on the screen comes from `forecastCopy.ts`, which is
// where the copy guards can see it.
import {
  bandBasisOf,
  committedShareOf,
  layerOf,
  monthConfidenceOf,
  roundILS,
  type BandBasis,
  type ForecastLineItem,
  type ForecastPeriodTotals,
  type MonthConfidence,
  type ObservedBand,
} from './forecast';
import type { AllowanceCategory } from './forecastTargets';

/**
 * One month, as the chart draws it.
 *
 * `estimatedILS` is the only nullable figure, and the null is D40: it means "the statistical layer
 * is absent here", which is a different message from `0` and must never be drawn as one.
 */
export interface ForecastMonthBar {
  period: string;
  /** The contractual portion, at its TRUE height, always (D40). `0` is a real value here. */
  certainILS: number;
  /**
   * Everything in the month that is not contractual — the moving average plus anything set
   * manually. `null` when there is nothing to draw AND no history to have drawn it from.
   */
  estimatedILS: number | null;
  /** `certainILS + (estimatedILS ?? 0)`. Never used as the bar's height when `gap` is true. */
  totalILS: number;
  /** D40's state, in one boolean, so the component branches on a name rather than on a null. */
  gap: boolean;
  /**
   * D39's whisker, on the ESTIMATED segment only, summed across every estimated category in the
   * month. `null` below `monthsObserved = 3` and for a month with nothing estimated.
   */
  band: ObservedBand | null;
  /** Where the whisker hangs from: exactly where the certain segment ends. Never below it (D3). */
  bandFloorILS: number;
  /** The WEAKEST basis among the month's expense items — never the average (D26's rule, reused). */
  bandBasis: BandBasis | null;
  /** D39's per-bar chip, present only when the basis is `insufficient-history`. */
  historyDepthMonths: number | null;
  /** D41's chip. `null` in D26's row 0 and in D40's month. */
  confidence: MonthConfidence | null;
  /**
   * What this month is allowed to contribute to the axis maximum (D40).
   *
   * For a gap month that is the CERTAIN value alone, so the ragged edge cannot imply a magnitude.
   * For every other month it is the taller of the stack and the top of the whisker, so a band is
   * never silently clipped — a clipped band draws the estimate as more certain than it is.
   */
  axisContributionILS: number;
}

/**
 * The weakest band basis among a month's EXPENSE items, or `null` when the month estimates nothing.
 *
 * Precedence is `insufficient-history` → `observed-range` → `assumption-fixed`, and it is the same
 * argument D26 makes about `monthsObserved`: one thin category behind five mature ones makes the
 * month thin, because the reader is being told how much to trust ONE number and that number
 * contains the thin one.
 *
 * A purely contractual month returns `null` rather than a basis. A contract has no band by D3, and
 * reporting `assumption-fixed` (the only other "no whisker" basis) for it would describe a
 * mortgage as something somebody typed in.
 */
export function monthBandBasisOf(items: ForecastLineItem[]): BandBasis | null {
  const bases = items
    .filter((item) => item.direction === 'expense')
    .map((item) => bandBasisOf(item.basis))
    .filter((basis): basis is BandBasis => basis !== null);
  if (bases.length === 0) return null;
  if (bases.includes('insufficient-history')) return 'insufficient-history';
  if (bases.includes('observed-range')) return 'observed-range';
  return 'assumption-fixed';
}

/** The month's band, summed across its estimated categories. `null` when no category carries one. */
function monthBandOf(items: ForecastLineItem[]): ObservedBand | null {
  let low = 0;
  let mid = 0;
  let high = 0;
  let found = false;
  for (const item of items) {
    if (item.direction !== 'expense') continue;
    if (item.basis.kind !== 'movingAverage' || item.basis.band === null) continue;
    found = true;
    low += item.basis.band.lowILS;
    mid += item.basis.band.midILS;
    high += item.basis.band.highILS;
  }
  return found ? { lowILS: roundILS(low), midILS: roundILS(mid), highILS: roundILS(high) } : null;
}

/** The observed depth behind a month's thinnest estimated category, for D39's per-bar chip. */
function monthHistoryDepthOf(items: ForecastLineItem[], fallbackMonthsObserved: number): number {
  const depths = items
    .filter((item) => item.direction === 'expense' && item.basis.kind === 'movingAverage')
    .map((item) => (item.basis.kind === 'movingAverage' ? item.basis.monthsObserved : fallbackMonthsObserved));
  return depths.length === 0 ? fallbackMonthsObserved : Math.min(...depths);
}

export interface ForecastMonthBarsInput {
  byPeriod: ForecastPeriodTotals[];
  /** The composed, precedence-resolved line items. Filtered per month here. */
  lineItems: ForecastLineItem[];
  /**
   * The WEAKEST `monthsObserved` across contributing categories (D26), for the whole window.
   *
   * It is one number rather than one per month on purpose, and D41 is why: the moving average is
   * identical in every projected month, so history depth cannot vary across the horizon. What DOES
   * vary is the committed share, and that is the half of D41's `or` rule that makes two months
   * report different chips off the same history.
   */
  monthsObserved: number;
}

export function forecastMonthBarsOf(input: ForecastMonthBarsInput): ForecastMonthBar[] {
  return input.byPeriod.map((month) => {
    const items = input.lineItems.filter((item) => item.period === month.period);
    const certainILS = roundILS(month.certainILS);
    // Everything that is not contractual. Read off the TOTALS rather than re-summed from the items,
    // so this figure and D38's card can never disagree about what `מזה כבר סגור` is the complement
    // of — the card computes `committedILS` from the same `certainILS` field.
    const nonCertainILS = roundILS(month.expenseILS - certainILS);
    // !! D40, WITH ONE STATED REFINEMENT.
    //
    // D40's rule is `monthsObserved === 0` ⇒ marker. Its REASON is "we have no basis on which to
    // estimate this month's variable spend". A manually-set amount is a basis — the one D19 ranks
    // above every other — so a month with no history and an assumption in it has a real number to
    // draw, and drawing it as a ragged edge would refuse a figure the family typed in themselves.
    //
    // Hence: the gap is "no history AND nothing else to show", not "no history". The refinement is
    // declared in the plan-departure section of this task's report rather than left here alone.
    const gap = input.monthsObserved === 0 && nonCertainILS === 0;
    const estimatedILS = gap ? null : nonCertainILS;
    const band = gap ? null : monthBandOf(items);
    const bandBasis = gap ? null : monthBandBasisOf(items);
    return {
      period: month.period,
      certainILS,
      estimatedILS,
      totalILS: roundILS(certainILS + (estimatedILS ?? 0)),
      gap,
      // A band is drawn ONLY on an observed range. `insufficient-history` is D3's "degenerates
      // visibly" state and `assumption-fixed` is "the user asserted a number; we do not add error
      // bars to their assertion" — both mean no whisker, for different reasons.
      band: bandBasis === 'observed-range' ? band : null,
      bandFloorILS: certainILS,
      bandBasis,
      historyDepthMonths:
        bandBasis === 'insufficient-history' ? monthHistoryDepthOf(items, input.monthsObserved) : null,
      confidence: monthConfidenceOf(
        input.monthsObserved,
        committedShareOf({ certainILS: month.certainILS, expenseILS: month.expenseILS })
      ),
      axisContributionILS: roundILS(
        Math.max(
          certainILS + (estimatedILS ?? 0),
          bandBasis === 'observed-range' && band !== null ? certainILS + band.highILS : 0
        )
      ),
    };
  });
}

/**
 * The axis maximum, computed from the bars rather than left to the chart library.
 *
 * `0` for an empty horizon, not `-Infinity`: `Math.max()` of nothing is `-Infinity`, which recharts
 * turns into an empty chart with no axis at all — a blank rectangle where the screen's whole
 * subject should be.
 */
export function forecastAxisMaxILS(bars: Array<Pick<ForecastMonthBar, 'axisContributionILS'>>): number {
  return bars.reduce((max, bar) => Math.max(max, bar.axisContributionILS), 0);
}

/**
 * D40's marker height, and the one number that makes it a MARK rather than a QUANTITY.
 *
 * The marker is a CONSTANT fraction of the axis, identical on every gap bar in the horizon, and the
 * axis itself is computed without it (`axisContributionILS` is certain-only for a gap month). So
 * two gap months with wildly different contractual columns carry the SAME marker, which is the
 * property a reader can actually perceive: a mark that does not change with the data is not
 * reporting the data. A dashed outline or an omitted segment would both have read as zero, and a
 * full-height grey one as a huge expense — A21's three wrong renderings, all of which pass a
 * string-level "no ₪0" check.
 */
export const GAP_MARKER_AXIS_FRACTION = 0.08;

export function gapMarkerHeightILS(axisMaxILS: number, gap: boolean): number {
  return gap ? roundILS(axisMaxILS * GAP_MARKER_AXIS_FRACTION) : 0;
}

/**
 * D29's candidate categories — every NON-CONTRACTUAL expense, totalled over the whole horizon.
 *
 * The certain layer is excluded outright: "reduce your mortgage by 4%" is the advice v1's
 * proportional shave produced, and A28 rejected it by name. `flexibleCategoryIds` narrows this
 * further using the family's own `flexible: false` assumptions; this is the pool that narrowing
 * runs over.
 *
 * A manually-set amount IS in the pool. It is money going out, and the fact that a person typed it
 * rather than the average producing it does not make it contractual — it makes it the one figure on
 * the screen the family can change by editing one document.
 */
export function allowanceCategoriesFromLineItems(items: ForecastLineItem[]): AllowanceCategory[] {
  const byCategory = new Map<string, number>();
  for (const item of items) {
    if (item.direction !== 'expense') continue;
    if (layerOf(item.basis) === 'certain') continue;
    byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + item.amountILS);
  }
  return [...byCategory.entries()]
    .map(([categoryId, projectedILS]) => ({ categoryId, projectedILS: roundILS(projectedILS) }))
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId));
}
