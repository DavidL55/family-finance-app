// src/__tests__/forecastView.test.ts — Stage 7 T7b. THE RENDER MODEL D39–D41 ARE DRAWN FROM.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHY THERE IS A MODULE BETWEEN THE ENGINE AND THE CHART AT ALL
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// D39, D40 and D41 are three rulings about ONE bar, and every one of them is a decision that can be
// got wrong in a way a rendered-DOM assertion cannot see. "The gap is not a bar" is the clearest
// case: all three obvious renderings emit no `₪0` and pass a string check, and A21 says so in as
// many words. So the SHAPE of each bar — which segments exist, which are `null`, what the axis is
// allowed to see — is computed by pure functions here and asserted here, and the component's job is
// reduced to drawing what it is handed.
//
// It also keeps the composition OUT of `forecast.ts`, which the T6 review asked for by name before
// T7b added a screen's worth of it. That request was to SPLIT `forecast.ts`; this does not do that,
// and the report says so. What it does is add none of T7b's composition to it.
import { describe, expect, it } from 'vitest';
import {
  forecastAxisMaxILS,
  forecastMonthBarsOf,
  monthBandBasisOf,
  allowanceCategoriesFromLineItems,
  gapMarkerHeightILS,
  GAP_MARKER_AXIS_FRACTION,
  type ForecastMonthBar,
} from '../utils/forecastView';
import type { ForecastLineItem } from '../utils/forecastBasis';
import type { ForecastPeriodTotals } from '../utils/forecast';

const PERIOD = '2026-09';

function totals(over: Partial<ForecastPeriodTotals> = {}): ForecastPeriodTotals {
  return {
    period: PERIOD,
    certainILS: 0,
    statisticalILS: 0,
    assumptionILS: 0,
    incomeILS: 0,
    expenseILS: 0,
    ...over,
  };
}

function movingAverageItem(over: Partial<ForecastLineItem> = {}, band: { lowILS: number; midILS: number; highILS: number } | null = null, monthsObserved = 4): ForecastLineItem {
  return {
    period: PERIOD,
    categoryId: 'מזון',
    direction: 'expense',
    amountILS: 1000,
    basis: {
      kind: 'movingAverage',
      monthsObserved,
      periods: [],
      seasonalFactor: null,
      band,
      bandBasis: band === null ? 'insufficient-history' : 'observed-range',
    },
    ...over,
  };
}

function certainItem(over: Partial<ForecastLineItem> = {}): ForecastLineItem {
  return {
    period: PERIOD,
    categoryId: 'החזרי הלוואות',
    direction: 'expense',
    amountILS: 2000,
    basis: { kind: 'loan', loanId: 'l1', name: 'משכנתא' },
    ...over,
  };
}

function assumptionItem(over: Partial<ForecastLineItem> = {}): ForecastLineItem {
  return {
    period: PERIOD,
    categoryId: 'שכר דירה',
    direction: 'expense',
    amountILS: 6000,
    basis: { kind: 'assumption', assumptionId: 'a1', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', overrides: [] },
    ...over,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D40 — THE GAP IS NOT A BAR
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D40 — a month with no history renders its certain portion and a marker, never a zero', () => {
  it('estimatedILS is `null`, not 0 — the two are different messages and only one is true', () => {
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 4200, expenseILS: 4200 })],
      lineItems: [certainItem({ amountILS: 4200 })],
      monthsObserved: 0,
    });
    expect(bar.certainILS).toBe(4200);
    expect(bar.estimatedILS).toBeNull();
    expect(bar.gap).toBe(true);
  });

  it('!! the AXIS MAXIMUM sees the certain value only, so the ragged edge implies no magnitude', () => {
    // The whole reason the axis is computed here rather than left to the chart library: recharts
    // would derive its domain from whatever number the gap segment carried, and every candidate
    // number for that segment is a lie about a quantity. `monthsObserved` is a property of the
    // WINDOW, so when it is 0 every month in the horizon is a gap month — the axis is therefore the
    // tallest CERTAIN column and nothing else.
    const bars = forecastMonthBarsOf({
      byPeriod: [
        totals({ period: '2026-09', certainILS: 4200, expenseILS: 4200 }),
        totals({ period: '2026-10', certainILS: 1000, expenseILS: 1000 }),
      ],
      lineItems: [],
      monthsObserved: 0,
    });
    expect(bars.map((b) => b.axisContributionILS)).toEqual([4200, 1000]);
    expect(bars.every((b) => b.gap)).toBe(true);
    expect(forecastAxisMaxILS(bars)).toBe(4200);
  });

  it('!! an INCONSISTENT corpus fails toward SHOWING the money, not toward hiding it', () => {
    // `monthsObserved === 0` and a non-zero statistical total cannot both be true of a corpus the
    // engine produced — the layer emits no line items when it observed nothing. This fixture
    // deliberately asserts what happens if they ever disagree, because the two candidate rules
    // differ only here and the difference matters: keying the gap on `monthsObserved` ALONE would
    // draw a ragged edge over ₪9,000 of real spend, silently removing it from the picture. Keying
    // it on "no history AND nothing to show" draws the number.
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 1000, statisticalILS: 9000, expenseILS: 10000 })],
      lineItems: [],
      monthsObserved: 0,
    });
    expect(bar.gap).toBe(false);
    expect(bar.estimatedILS).toBe(9000);
  });

  it('!! a month with no history but a MANUALLY SET amount is NOT a gap — the family asserted it', () => {
    // A stated refinement of D40, not a contradiction of it. D40's rule is "the statistical layer is
    // absent, so we cannot know the variable spend". A user-set amount is knowledge we DO have, from
    // the one source D19 ranks above every other. Drawing it as a ragged edge would refuse a number
    // the family typed in themselves.
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 1000, assumptionILS: 6000, expenseILS: 7000 })],
      lineItems: [certainItem({ amountILS: 1000 }), assumptionItem()],
      monthsObserved: 0,
    });
    expect(bar.gap).toBe(false);
    expect(bar.estimatedILS).toBe(6000);
    expect(bar.axisContributionILS).toBe(7000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D39 — THE SPLIT, THE WHISKER, AND THE PER-BAR MARKER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D39 — the committed portion is at true height and the estimate is what is left', () => {
  it('splits the month into the contractual portion and everything else', () => {
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 4200, statisticalILS: 2900, expenseILS: 7100 })],
      lineItems: [certainItem({ amountILS: 4200 }), movingAverageItem({ amountILS: 2900 }, { lowILS: 2000, midILS: 2900, highILS: 4100 })],
      monthsObserved: 4,
    });
    expect(bar.certainILS).toBe(4200);
    expect(bar.estimatedILS).toBe(2900);
    expect(bar.totalILS).toBe(7100);
  });

  it('!! the whisker is anchored where the CERTAIN segment ends and never spans it', () => {
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 4200, statisticalILS: 2900, expenseILS: 7100 })],
      lineItems: [certainItem({ amountILS: 4200 }), movingAverageItem({ amountILS: 2900 }, { lowILS: 2000, midILS: 2900, highILS: 4100 })],
      monthsObserved: 4,
    });
    expect(bar.band).toEqual({ lowILS: 2000, midILS: 2900, highILS: 4100 });
    expect(bar.bandFloorILS).toBe(4200);
    // The axis has to leave room for the top of the whisker, or the band is silently clipped and
    // the picture says the estimate is more certain than it is.
    expect(bar.axisContributionILS).toBe(4200 + 4100);
  });

  it('!! BELOW n=3 there is NO whisker, and the bar carries a per-bar chip instead of a paragraph', () => {
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 1000, statisticalILS: 500, expenseILS: 1500 })],
      lineItems: [certainItem({ amountILS: 1000 }), movingAverageItem({ amountILS: 500 }, null, 2)],
      monthsObserved: 2,
    });
    expect(bar.band).toBeNull();
    expect(bar.bandBasis).toBe('insufficient-history');
    expect(bar.historyDepthMonths).toBe(2);
  });

  it('!! A MIXED month draws NO whisker even though one category HAS a band — the second survivor', () => {
    // The previous thin-history fixture had ONE category with no band at all, so `monthBandOf`
    // returned `null` and the `bandBasis === 'observed-range'` guard could be deleted without
    // changing a thing. The case that separates them is a month where one category is mature and
    // another is thin: the month is thin (D26's weakest-wins rule), and drawing the mature
    // category's range as THE MONTH'S range would report a precision the month does not have.
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 1000, statisticalILS: 900, expenseILS: 1900 })],
      lineItems: [
        certainItem({ amountILS: 1000 }),
        movingAverageItem({ amountILS: 500 }, { lowILS: 400, midILS: 500, highILS: 700 }),
        movingAverageItem({ categoryId: 'תחבורה', amountILS: 400 }, null, 1),
      ],
      monthsObserved: 1,
    });
    expect(bar.bandBasis).toBe('insufficient-history');
    expect(bar.band).toBeNull();
    // …and the axis therefore stops at the stack, not at a whisker nobody draws.
    expect(bar.axisContributionILS).toBe(1900);
  });

  it('a full-window month carries NO depth chip — the chip is the exception, not a label on every bar', () => {
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 1000, statisticalILS: 500, expenseILS: 1500 })],
      lineItems: [certainItem({ amountILS: 1000 }), movingAverageItem({ amountILS: 500 }, { lowILS: 400, midILS: 500, highILS: 700 })],
      monthsObserved: 4,
    });
    expect(bar.bandBasis).toBe('observed-range');
    expect(bar.historyDepthMonths).toBeNull();
  });

  it('sums the band across every estimated category in the month', () => {
    const [bar] = forecastMonthBarsOf({
      byPeriod: [totals({ statisticalILS: 900, expenseILS: 900 })],
      lineItems: [
        movingAverageItem({ amountILS: 500 }, { lowILS: 400, midILS: 500, highILS: 700 }),
        movingAverageItem({ categoryId: 'תחבורה', amountILS: 400 }, { lowILS: 300, midILS: 400, highILS: 600 }),
      ],
      monthsObserved: 4,
    });
    expect(bar.band).toEqual({ lowILS: 700, midILS: 900, highILS: 1300 });
  });
});

describe('!! monthBandBasisOf — the WEAKEST basis in the month wins', () => {
  it('one thin category makes the whole month thin — never the average, per D26', () => {
    expect(
      monthBandBasisOf([
        movingAverageItem({ amountILS: 500 }, { lowILS: 1, midILS: 1, highILS: 1 }),
        movingAverageItem({ categoryId: 'תחבורה', amountILS: 400 }, null, 1),
      ])
    ).toBe('insufficient-history');
  });

  it('an all-observed month reports the observed range', () => {
    expect(monthBandBasisOf([movingAverageItem({ amountILS: 500 }, { lowILS: 1, midILS: 1, highILS: 1 })])).toBe('observed-range');
  });

  it('a month whose only expense was SET MANUALLY gets no error bars around the assertion (D3)', () => {
    expect(monthBandBasisOf([assumptionItem()])).toBe('assumption-fixed');
  });

  it('a month with no expense at all has no basis — `null`, never a default', () => {
    expect(monthBandBasisOf([])).toBeNull();
  });

  it('!! INCOME IS NOT A BAND SUBJECT — the survivor that proved the old check was vacuous', () => {
    // The previous version of this assertion passed a LOAN-basis income item, and `bandBasisOf`
    // returns `null` for a loan whatever its direction — so dropping the `direction === 'expense'`
    // filter changed nothing and the mutant lived. The item has to carry a basis that WOULD produce
    // a basis if it were an expense. A month whose only banded item is income has nothing to draw a
    // whisker on, and reporting `observed-range` for it would put an uncertainty range on money
    // coming IN, which this stage does not estimate at all.
    const bandedIncome = movingAverageItem(
      { direction: 'income', categoryId: 'משכורת' },
      { lowILS: 1, midILS: 1, highILS: 1 }
    );
    expect(monthBandBasisOf([bandedIncome])).toBeNull();
    // …and it does not drag an expense month's basis around either.
    expect(monthBandBasisOf([bandedIncome, movingAverageItem({ amountILS: 1 }, null, 1)])).toBe(
      'insufficient-history'
    );
  });

  it('a purely CONTRACTUAL month has no band basis — a contract is not an estimate (D3)', () => {
    expect(monthBandBasisOf([certainItem()])).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D41 — THE CONFIDENCE CHIP, DRIVEN BY TWO REAL INPUTS
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D41 — distance is encoded explicitly, and the chip differs on committed share alone', () => {
  it('same history depth, different committed share — the chips DIFFER (the `or` rule`s own half)', () => {
    const bars = forecastMonthBarsOf({
      byPeriod: [
        totals({ period: '2026-09', certainILS: 9000, statisticalILS: 1000, expenseILS: 10000 }),
        totals({ period: '2026-10', certainILS: 1000, statisticalILS: 9000, expenseILS: 10000 }),
      ],
      lineItems: [],
      monthsObserved: 1,
    });
    expect(bars[0].confidence).toBe('well-based');
    expect(bars[1].confidence).toBe('rough-estimate');
  });

  it('no chip at all when there is no history AND nothing committed to lean on', () => {
    const [bar] = forecastMonthBarsOf({ byPeriod: [totals()], lineItems: [], monthsObserved: 0 });
    expect(bar.confidence).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D29 — WHAT THE ALLOWANCE BLOCK IS ALLOWED TO CALL "FLEXIBLE"
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! allowanceCategoriesFromLineItems — contractual spend is never offered as something to cut', () => {
  it('excludes the certain layer entirely — a mortgage is not a category to shave', () => {
    const rows = allowanceCategoriesFromLineItems([
      certainItem({ amountILS: 2000 }),
      movingAverageItem({ amountILS: 500 }),
    ]);
    expect(rows).toEqual([{ categoryId: 'מזון', projectedILS: 500 }]);
  });

  it('sums one category across every month of the horizon', () => {
    const rows = allowanceCategoriesFromLineItems([
      movingAverageItem({ period: '2026-09', amountILS: 500 }),
      movingAverageItem({ period: '2026-10', amountILS: 700 }),
    ]);
    expect(rows).toEqual([{ categoryId: 'מזון', projectedILS: 1200 }]);
  });

  it('a MANUALLY SET amount counts as spend — it is money going out, whatever set it', () => {
    const rows = allowanceCategoriesFromLineItems([assumptionItem()]);
    expect(rows).toEqual([{ categoryId: 'שכר דירה', projectedILS: 6000 }]);
  });

  it('income is never a category to reduce', () => {
    expect(allowanceCategoriesFromLineItems([movingAverageItem({ direction: 'income' })])).toEqual([]);
  });

  it('is ordered by category id, so two renders of one corpus cannot disagree', () => {
    const rows = allowanceCategoriesFromLineItems([
      movingAverageItem({ categoryId: 'תחבורה', amountILS: 1 }),
      movingAverageItem({ categoryId: 'מזון', amountILS: 1 }),
    ]);
    expect(rows.map((r) => r.categoryId)).toEqual(['מזון', 'תחבורה']);
  });
});

describe('forecastAxisMaxILS', () => {
  it('is 0 for an empty horizon rather than -Infinity, which would render as an empty chart', () => {
    expect(forecastAxisMaxILS([])).toBe(0);
  });

  it('takes the largest contribution, not the last one', () => {
    const bars = [
      { axisContributionILS: 100 },
      { axisContributionILS: 900 },
      { axisContributionILS: 300 },
    ] as ForecastMonthBar[];
    expect(forecastAxisMaxILS(bars)).toBe(900);
  });
});

describe('!! D40 — the gap MARKER is a mark, and the assertion is that it does not move', () => {
  it('is the SAME height on every gap month, whatever those months contain', () => {
    // The perceivable property. Two gap months whose contractual columns differ by ₪3,200 carry an
    // identical marker, so nothing about the marker reports anything about the month.
    const axisMax = 4200;
    expect(gapMarkerHeightILS(axisMax, true)).toBe(gapMarkerHeightILS(axisMax, true));
    expect(gapMarkerHeightILS(axisMax, true)).toBe(336);
  });

  it('is ZERO for a month that is not a gap — the marker exists only where the estimate does not', () => {
    expect(gapMarkerHeightILS(4200, false)).toBe(0);
  });

  it('!! is a FRACTION of the axis, and the axis was computed WITHOUT it — so it cannot be measured', () => {
    // If the marker fed the axis the two would chase each other and the mark would become a
    // quantity by the back door. `forecastAxisMaxILS` reads `axisContributionILS`, which is
    // certain-only for a gap month, and this function reads the finished axis.
    const bars = forecastMonthBarsOf({
      byPeriod: [totals({ certainILS: 4200, expenseILS: 4200 })],
      lineItems: [],
      monthsObserved: 0,
    });
    const axisMax = forecastAxisMaxILS(bars);
    expect(axisMax).toBe(4200);
    expect(gapMarkerHeightILS(axisMax, bars[0].gap)).toBeLessThan(axisMax);
    expect(GAP_MARKER_AXIS_FRACTION).toBeLessThan(0.25);
  });
});
