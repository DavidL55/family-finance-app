// Stage 7 T5 — the statistical layer ON THE T4 CORPUS.
//
// ── WHY THIS FILE EXISTS SEPARATELY FROM `statisticalLayer.test.ts` ────────────────────────────
//
// A predicate tested only against fixtures it was written beside is a predicate whose mutation
// changes a fixture. §12's rule for every guard in this stage is "what makes it able to fail, and
// where its data comes from", and for the three D23 rulings the answer is the same: the T4 corpus
// emits, in one category and one month the average actually reads, both the row that must be
// counted and the row that must not — so removing an exclusion moves a NUMBER rather than a count.
//
//   · `recurringId`   — `בריאות` carries a recurring-posted row AND a manual row in each of three
//                       periods. Removing the exclusion changes that category's estimate.
//   · `isExpenseRow`  — one `isCredit: true` + `paymentType: 'refund'` row sits in `מזון וצריכה`
//                       inside the window. It is the ONLY shape where `isExpenseRow` and
//                       `isExpenseListRow` disagree, so swapping them changes that estimate.
//   · the ₪0 branches — an n=1 category whose single observation is ₪0, and A9's horizon month
//                       with no certain charge at all. Both are named T4 conditions.
//
// !! LIVE EMULATOR: NOT REQUIRED, and the plan says so by name for T5. Everything here is a pure
// function over the corpus builder's output. The one Firestore-shaped fact — that the seeded
// marker must PARSE — is checked through `parseBackfillMarker` itself rather than through a probe,
// because the parser is the thing that decides it.
import { describe, expect, it } from 'vitest';
import {
  DEMO_CATEGORY_EDUCATION,
  DEMO_LARGE_MEMBER_COUNT,
  DEMO_WINDOW_MONTHS,
  buildDemoCorpus,
  type DemoCorpus,
  type DemoTransactionLine,
} from '../utils/demoCorpus';
import { certainLineItems } from '../utils/demoCorpusConditions';
import {
  CONFIDENCE_COMMITTED_FAIR,
  CONFIDENCE_COMMITTED_STRONG,
  CONFIDENCE_MONTHS_FAIR,
  CONFIDENCE_MONTHS_STRONG,
  HISTORY_ROW_CEILING,
  LOOKBACK_MONTHS_MAX,
  LOOKBACK_MONTHS_MIN,
  buildStatisticalLayer,
  certainLayerSummaryHe,
  committedShareOf,
  composeForecast,
  monthConfidenceOf,
  statisticalCategoryOf,
  weakestMonthsObserved,
  type StatisticalCategoryEstimate,
} from '../utils/forecast';
import { STATISTICAL_GAP_REASON_HE } from '../utils/forecastCopy';
import { sealStatisticalHistory, type StatisticalHistoryRow } from '../utils/statisticalHistory';
import {
  TRANSACTION_PERIOD_BACKFILL_KEY,
  parseBackfillMarker,
  statisticalLayerGate,
} from '../utils/backfillMarker';
import { UNKNOWN_PERIOD, monthKeyOf } from '../utils/periodMath';
import {
  SEASONALITY_OFFERS,
  observedSeasonalFactor,
  offeredSeasonalityAssumptions,
  parseSeasonalityScopeId,
} from '../utils/seasonality';
import { CATEGORY_MAP } from '../utils/categoryMap';
import type { ForecastAssumption } from '../types/finance';
import { isExpenseListRow, isExpenseRow } from '../utils/transactionFilters';

const corpus = buildDemoCorpus();

/**
 * The rows `loadStatisticalHistory` would return for this corpus: the window, PLUS `'unknown'`.
 * The seventh `in` value is on every window query, so the unparseable rows are part of the read
 * whether or not the average wants them — which is exactly why the average has to exclude them.
 */
function readRows(c: DemoCorpus): DemoTransactionLine[] {
  const window = new Set(c.windowPeriods);
  return c.transactionLines.filter((line) => window.has(line.period) || line.period === UNKNOWN_PERIOD);
}

function markerOf(c: DemoCorpus) {
  const parsed = parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: c.backfillMarker });
  if (parsed === null) throw new Error('the demo corpus marker must parse — see DemoBackfillMarker');
  return parsed;
}

function layerOverCorpus(c: DemoCorpus, rows: StatisticalHistoryRow[] = readRows(c)) {
  return buildStatisticalLayer({
    history: sealStatisticalHistory(markerOf(c), rows),
    windowPeriods: c.windowPeriods,
    horizon: c.horizonPeriods,
  });
}

function readyLayer(c: DemoCorpus = corpus) {
  const result = layerOverCorpus(c);
  if (result.status !== 'ready') throw new Error(`expected a ready layer, got ${result.status}`);
  return result;
}

function estimateFor(categoryId: string): StatisticalCategoryEstimate {
  const found = readyLayer().categories.find((c) => c.categoryId === categoryId);
  if (!found) throw new Error(`no category ${categoryId} in the layer`);
  return found;
}

function amountOf(estimate: StatisticalCategoryEstimate): number {
  if (estimate.status !== 'estimated') throw new Error('expected an estimate');
  return estimate.estimateILS;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The door, on the corpus that is actually seeded
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the seeded marker must PARSE, or the layer computes nothing at all', () => {
  it('parses through `parseBackfillMarker` and the gate allows', () => {
    // T4 shipped a FOUR-field marker while the T3 review had already made seven required. It
    // parsed as `null`, the gate refused, and the statistical layer computed nothing on the very
    // corpus that exists to give it evidence — with `demoCorpus.ts`'s own comment claiming the
    // opposite. Nothing could see it: T4 asserted `rowsUnknown` off the object and the emulator
    // test read `rowsStamped` off the raw document, and neither went through the parser.
    const parsed = parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: corpus.backfillMarker });
    expect(parsed).not.toBeNull();
    expect(statisticalLayerGate(parsed).status).toBe('allowed');
  });

  it('the layer is READY on the base corpus, which is the precondition for everything below', () => {
    expect(readyLayer().status).toBe('ready');
  });

  it('carries the corpus`s own provenance out with the answer', () => {
    expect(readyLayer().markerSourceCommit).toBe(corpus.backfillMarker.sourceCommit);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D26's cold-start table, on real data
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the corpus reaches four cold-start bands at once, per category', () => {
  it('reports the window CAP: a category with rows in eight periods reports six', () => {
    const groceries = estimateFor('מזון וצריכה');
    expect(groceries.monthsObserved).toBe(LOOKBACK_MONTHS_MAX);
    expect(corpus.historyPeriods.length).toBeGreaterThan(LOOKBACK_MONTHS_MAX);
    expect(DEMO_WINDOW_MONTHS).toBe(LOOKBACK_MONTHS_MAX);
  });

  it(`draws a band at n=${LOOKBACK_MONTHS_MIN} and NOT at n=2, on the corpus`, () => {
    const health = estimateFor('בריאות');
    const leisure = estimateFor('פנאי ובילוי');
    if (health.status !== 'estimated' || leisure.status !== 'estimated') throw new Error('x');
    expect(health.monthsObserved).toBe(LOOKBACK_MONTHS_MIN);
    expect(health.bandBasis).toBe('observed-range');
    expect(health.band).not.toBeNull();
    expect(leisure.monthsObserved).toBe(2);
    expect(leisure.bandBasis).toBe('insufficient-history');
    expect(leisure.band).toBeNull();
  });

  it('!! the band is the family`s OWN min/median/max, not a multiplier of the middle', () => {
    const groceries = estimateFor('מזון וצריכה');
    if (groceries.status !== 'estimated' || groceries.band === null) throw new Error('x');
    expect(groceries.band.lowILS).toBe(Math.min(...groceries.monthlyTotalsILS));
    expect(groceries.band.highILS).toBe(Math.max(...groceries.monthlyTotalsILS));
    // ×0.85/×1.15 of the middle would produce these. Nothing here does.
    expect(groceries.band.lowILS).not.toBeCloseTo(groceries.band.midILS * 0.85, 2);
    expect(groceries.band.highILS).not.toBeCloseTo(groceries.band.midILS * 1.15, 2);
    // and the band is ASYMMETRIC about the middle on real data, which a multiplier can never be
    const below = groceries.band.midILS - groceries.band.lowILS;
    const above = groceries.band.highILS - groceries.band.midILS;
    expect(below).not.toBeCloseTo(above, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D23 — the two exclusions, each moving a real number
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D23(b) — the `recurringId` exclusion, or the certain layer counts it TWICE', () => {
  it('the corpus really does carry both row kinds in the same category and month', () => {
    const health = corpus.transactionLines.filter(
      (l) => statisticalCategoryOf(l) === 'בריאות' && corpus.windowPeriods.includes(l.period)
    );
    const posted = health.filter((l) => l.recurringId !== null);
    const manual = health.filter((l) => l.recurringId === null);
    expect(posted.length).toBeGreaterThan(0);
    expect(manual.length).toBeGreaterThan(0);
    expect(new Set(posted.map((l) => l.period))).toEqual(new Set(manual.map((l) => l.period)));
  });

  it('!! removing the exclusion MOVES THE NUMBER — the double count, measured', () => {
    // Not a count: a figure. The recurring items are ALSO projected forward by the certain layer,
    // so every one of these ₪220 charges would appear twice in the same month's total.
    const excluded = amountOf(estimateFor('בריאות'));
    const withRecurringCounted = layerOverCorpus(
      corpus,
      readRows(corpus).map((row) => ({ ...row, recurringId: null }))
    );
    if (withRecurringCounted.status !== 'ready') throw new Error('x');
    const naive = withRecurringCounted.categories.find((c) => c.categoryId === 'בריאות');
    if (!naive || naive.status !== 'estimated') throw new Error('x');
    expect(naive.estimateILS).not.toBe(excluded);
    expect(naive.estimateILS - excluded).toBeCloseTo(220, 2);
  });

  it('the recurring item behind those rows really is projected into the horizon', () => {
    const projected = certainLineItems(corpus).filter(
      (item) => item.basis.kind === 'recurring' && item.basis.recurringId === 'demo-rec-clinic-a'
    );
    expect(projected.length).toBeGreaterThan(0);
  });
});

describe('!! D23(a) — `isExpenseRow`, NOT `isExpenseListRow`', () => {
  const refund = corpus.transactionLines.find((l) => l.id === 'demo-tx-refund');

  it('the corpus carries the ONE row shape where the two predicates disagree, inside the window', () => {
    if (!refund) throw new Error('the refund row is a named T4 condition');
    expect(refund.isCredit).toBe(true);
    expect(refund.paymentType).toBe('refund');
    expect(corpus.windowPeriods).toContain(refund.period);
    // the divergence itself, asserted rather than assumed
    expect(isExpenseRow(refund)).toBe(false);
    expect(isExpenseListRow(refund)).toBe(true);
  });

  it('!! swapping the predicate MOVES THE NUMBER — a refund counted as spend, every month', () => {
    if (!refund) throw new Error('the refund row is a named T4 condition');
    const correct = amountOf(estimateFor(statisticalCategoryOf(refund)));
    // The mutation, expressed as data: `isExpenseListRow` keeps this row, so feed the layer a
    // corpus in which it is not a credit at all — the same rows `isExpenseListRow` would have let
    // through, which is what makes the difference a figure rather than an argument.
    const asListRule = layerOverCorpus(
      corpus,
      readRows(corpus).map((row) =>
        isExpenseListRow(row) && !isExpenseRow(row) ? { ...row, isCredit: false } : row
      )
    );
    if (asListRule.status !== 'ready') throw new Error('x');
    const inflated = asListRule.categories.find((c) => c.categoryId === statisticalCategoryOf(refund));
    if (!inflated || inflated.status !== 'estimated') throw new Error('x');
    expect(inflated.estimateILS).toBeGreaterThan(correct);
    // ₪137.90 spread across the six-month window
    expect((inflated.estimateILS - correct) * LOOKBACK_MONTHS_MAX).toBeCloseTo(refund.amount, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §12 — no ₪0, on the two branches that would actually render one
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Whether a string contains a ₪ figure whose VALUE is zero, in any spelling.
 *
 * Written as "find every money figure, then ask whether one of them is zero" rather than as one
 * clever regex, because the clever regex was wrong on its first draft in exactly the direction that
 * matters: `/₪\s*0(?:[.,]0+)?(?!\d)/` matched the leading `₪0` of `₪0.50` and would have failed a
 * guard on a real, non-zero figure. An over-approximating guard that fires on innocent output is a
 * guard people delete — the same correction the loop-termination guard's structural half had to
 * make.
 */
function containsZeroMoney(text: string): boolean {
  // `: string[]` IS LOAD-BEARING, and the T6 review's F1 is why. `String.match` returns
  // `RegExpMatchArray | null`; `?? []` makes the type a UNION with the empty array literal, and
  // calling `.some` on a union of array types hands the callback the INTERSECTION of the element
  // types — `string & never` — so `figure.replace` does not exist. It compiled only because a built
  // `dist/` was joining the program under `allowJs` and suppressing the error; `tsconfig.json` now
  // excludes the build output (`typeCheckScope.test.ts`), so the annotation has to be here. It
  // states the type this line already depends on; it is not a cast.
  const figures: string[] = text.match(/₪\s*\d+(?:[.,]\d+)?/g) ?? [];
  return figures.some((figure) => Number(figure.replace(/[₪\s]/g, '').replace(',', '.')) === 0);
}

/** Every Hebrew string the statistical layer produces over one corpus, gaps and all. */
function everyStringTheLayerEmits(c: DemoCorpus): string[] {
  const layer = layerOverCorpus(c);
  const strings: string[] = [layer.reasonHe];
  for (const category of layer.categories) {
    if (category.status === 'gap') strings.push(category.reasonHe);
  }
  const forecast = composeForecast({
    anchorPeriod: c.anchorPeriod,
    todayPeriod: c.anchorPeriod,
    horizonMonths: c.horizonPeriods.length,
    lineItems: [...certainLineItems(c), ...layer.lineItems],
  });
  for (const period of forecast.horizon) {
    strings.push(certainLayerSummaryHe(forecast.lineItems.filter((i) => i.period === period)));
  }
  return strings.filter((s) => s.length > 0);
}

describe('!! no ₪0 — RE-SCOPED to the branches that can actually emit one (§12)', () => {
  it('the n=1 ₪0 category is a STATED GAP, and the corpus really does contain it', () => {
    const zeroRow = corpus.transactionLines.find((l) => l.id === 'demo-tx-housing-zero');
    if (!zeroRow) throw new Error('the ₪0 row is a named T4 condition');
    expect(zeroRow.amount).toBe(0);
    const housing = estimateFor(statisticalCategoryOf(zeroRow));
    expect(housing.status).toBe('gap');
    if (housing.status !== 'gap') throw new Error('x');
    expect(housing.monthsObserved).toBe(1);
    expect(housing.gapReason).toBe('no-spend-observed');
    expect(housing.reasonHe).toBe(STATISTICAL_GAP_REASON_HE['no-spend-observed']);
  });

  it('!! A9`s empty-certain month renders a SENTENCE, not ₪0', () => {
    const layer = readyLayer();
    const forecast = composeForecast({
      anchorPeriod: corpus.anchorPeriod,
      todayPeriod: corpus.anchorPeriod,
      horizonMonths: corpus.horizonPeriods.length,
      lineItems: [...certainLineItems(corpus), ...layer.lineItems],
    });
    const empty = forecast.byPeriod.find((m) => m.period === corpus.emptyCertainPeriod);
    if (!empty) throw new Error('the empty-certain month is a named T4 condition');
    expect(empty.certainILS).toBe(0);
    // and it is BRACKETED by months that are not empty — a corpus where the last month is empty
    // proves nothing about a gap in the middle.
    expect(forecast.byPeriod.filter((m) => m.certainILS > 0).length).toBeGreaterThan(1);
    expect(
      certainLayerSummaryHe(forecast.lineItems.filter((i) => i.period === corpus.emptyCertainPeriod))
    ).not.toBe('');
  });

  it('!! NOT ONE string the layer emits over this corpus contains a zero money figure', () => {
    const strings = everyStringTheLayerEmits(corpus);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(containsZeroMoney(s)).toBe(false);
  });

  it('!! THE CANARY — the same assertion FAILS the moment a gap formats its amount', () => {
    // Non-vacuity, and the specific non-vacuity §12 asks for: v1's version was scoped to the
    // zero-HISTORY branch, which emits no symbols at all, so it could not fail. This canary is the
    // renderer the ruling forbids — a gap category rendered as its (zero) average — and the regex
    // has to catch it or the assertion above is decoration.
    const layer = readyLayer();
    const canary = layer.categories
      .filter((c) => c.status === 'gap')
      .map((c) => `${c.categoryId}: ₪${0}`);
    expect(canary.length).toBeGreaterThan(0);
    expect(canary.some(containsZeroMoney)).toBe(true);
    // and the spellings the app can produce are all caught, including at the end of a sentence
    for (const spelling of ['₪0', '₪ 0', '₪0.00', '₪0,00', 'סך הכל ₪0.']) {
      expect(containsZeroMoney(spelling)).toBe(true);
    }
    // while a real figure that merely STARTS with a zero is not — the first draft failed this
    for (const real of ['₪04', '₪1,000', '₪0.50', '₪0.01']) expect(containsZeroMoney(real)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D26/D14 — the weakest contributing category, on the real mixed month
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the WEAKEST contributing category, never the average', () => {
  it('the corpus mixes a window-capped category with an n=1 one, and their mean is above the cut', () => {
    const counts = readyLayer().categories.map((c) => c.monthsObserved);
    expect(Math.max(...counts)).toBe(LOOKBACK_MONTHS_MAX);
    expect(Math.min(...counts)).toBe(1);
    const mean = counts.reduce((s, n) => s + n, 0) / counts.length;
    expect(mean).toBeGreaterThan(CONFIDENCE_MONTHS_FAIR);
  });

  it('!! the month reports 1 — and the AVERAGE rule would report a different chip', () => {
    const layer = readyLayer();
    expect(layer.weakestMonthsObserved).toBe(1);
    const counts = layer.categories.map((c) => c.monthsObserved);
    const mean = counts.reduce((s, n) => s + n, 0) / counts.length;
    // This is the mutation, run: swap `Math.min` for the mean and the chip changes on real data.
    expect(monthConfidenceOf(layer.weakestMonthsObserved, 0)).toBe('rough-estimate');
    expect(monthConfidenceOf(mean, 0)).toBe('estimate');
  });

  it('!! the ₪0 GAP category is the one dragging it — a gap contributes, it does not vanish', () => {
    const layer = readyLayer();
    const estimatedOnly = layer.categories.filter((c) => c.status === 'estimated');
    // Excluding gaps would raise the month's confidence BECAUSE a category got worse.
    expect(weakestMonthsObserved(estimatedOnly)).toBeGreaterThan(layer.weakestMonthsObserved);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D41 — what this corpus can and cannot show about the chip
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D41 on the corpus — three horizon months, same n, different committed share', () => {
  function monthRows() {
    const layer = readyLayer();
    const forecast = composeForecast({
      anchorPeriod: corpus.anchorPeriod,
      todayPeriod: corpus.anchorPeriod,
      horizonMonths: corpus.horizonPeriods.length,
      lineItems: [...certainLineItems(corpus), ...layer.lineItems],
    });
    return forecast.byPeriod.map((month) => ({
      period: month.period,
      share: committedShareOf(month),
      chip: monthConfidenceOf(layer.weakestMonthsObserved, committedShareOf(month)),
    }));
  }

  it('the committed share genuinely DIFFERS across the horizon', () => {
    const months = monthRows();
    expect(new Set(months.map((m) => m.share)).size).toBeGreaterThan(1);
    // A9's month is the 0 — nothing committed, and that is a fact about the corpus, not a bug.
    expect(months.find((m) => m.period === corpus.emptyCertainPeriod).share).toBe(0);
  });

  it('!! `monthsObserved` is IDENTICAL in every horizon month, BY CONSTRUCTION — D41`s own point', () => {
    // v1 required "month 3 strictly more estimated than month 1". Every estimated category is
    // projected into every horizon month from the same window, so the weakest n cannot vary across
    // months at all. Only a synthetic fixture satisfies v1's clause, which is why D41 struck it.
    const layer = readyLayer();
    for (const period of corpus.horizonPeriods) {
      const inMonth = layer.lineItems.filter((i) => i.period === period);
      const observed = inMonth.map((i) => (i.basis.kind === 'movingAverage' ? i.basis.monthsObserved : 0));
      expect(Math.min(...observed)).toBe(Math.min(...layer.lineItems.map((i) =>
        i.basis.kind === 'movingAverage' ? i.basis.monthsObserved : 0
      )));
    }
  });

  it('AS SEEDED, the three chips are equal — every month`s share is below the `fair` cut-point', () => {
    // A true fact about the corpus as it ships, and worth keeping: three visibly different shares
    // that still produce one chip is what the `or` rule looks like when neither arm has fired.
    const months = monthRows();
    expect(new Set(months.map((m) => m.chip)).size).toBe(1);
    expect(months[0].chip).toBe('rough-estimate');
    expect(Math.max(...months.map((m) => m.share))).toBeLessThan(CONFIDENCE_COMMITTED_FAIR);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T5-REVIEW F4 — D41's THIRD FIXTURE, BUILT ON THE REAL CORPUS
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ── THE CLAIM THAT WAS WRONG, AND THE TWO CORPORA IT CONFLATED ─────────────────────────────────
//
// T5 recorded this fixture as NOT BUILDABLE, on the grounds that "tuning would move the row-ceiling
// condition, which sits only 9.1% over". Two things were wrong with that in one sentence:
//
//   · THE 9.1% BELONGS TO A DIFFERENT CORPUS. The base corpus reads 264 rows against a ceiling of
//     2,000 — 13% OF it, not 9% OVER it. The figure quoted is the TWENTY-MEMBER corpus's (2,184
//     rows, 9.2% over), which is a separate `buildDemoCorpus` call and is not touched here.
//
//   · AND THE TUNING COULD NOT HAVE MOVED IT ANYWAY. Committed share is `certainILS / expenseILS`
//     — a ratio of AMOUNTS. Changing what a charge costs changes no row count, so the ceiling
//     condition is not on the same axis as the thing being varied. Both facts are asserted below
//     rather than restated, so this correction cannot go stale either.
//
// ── WHAT THIS FIXTURE IS, PRECISELY ───────────────────────────────────────────────────────────
//
// The real corpus, its real statistical layer, its real categories and row counts — with the
// CERTAIN line items of two horizon months scaled. Scaling is stated rather than smuggled: it is
// the one transformation that moves committed share and provably nothing else, and it is what makes
// the `or` rule's committed-share arm observable on this data at all. `monthsObserved` stays at its
// real value of 1 in every month, which is what makes the fixture worth having: with n=1 an `and`
// rule collapses all three months to `הערכה גסה`, so the three distinct chips below are produced BY
// the `or` and by nothing else.
//
// D41's `or` rule is the most-hovered element on the screen and was held only on synthetic input.

describe('!! F4 — same `monthsObserved`, three different committed shares, THREE DIFFERENT CHIPS', () => {
  /** The two months whose committed charges are scaled, and by how much. Nothing else is touched. */
  const SCALE_BY: Record<string, number> = {
    [corpus.horizonPeriods[0]]: 10,
    [corpus.horizonPeriods[2]]: 2,
  };

  function scaledMonths() {
    const layer = readyLayer();
    const certain = certainLineItems(corpus).map((item) =>
      SCALE_BY[item.period] ? { ...item, amountILS: item.amountILS * SCALE_BY[item.period] } : item
    );
    const forecast = composeForecast({
      anchorPeriod: corpus.anchorPeriod,
      todayPeriod: corpus.anchorPeriod,
      horizonMonths: corpus.horizonPeriods.length,
      lineItems: [...certain, ...layer.lineItems],
    });
    return {
      layer,
      months: forecast.byPeriod.map((month) => ({
        period: month.period,
        share: committedShareOf(month),
        statisticalILS: month.statisticalILS,
        chip: monthConfidenceOf(layer.weakestMonthsObserved, committedShareOf(month)),
      })),
    };
  }

  it('!! the three chips are `well-based`, `estimate` and `rough-estimate` — all three states, on real data', () => {
    const { months } = scaledMonths();
    expect(months.map((m) => m.chip)).toEqual(['well-based', 'rough-estimate', 'estimate']);
    expect(new Set(months.map((m) => m.chip)).size).toBe(3);
  });

  it('!! and `monthsObserved` is IDENTICAL — so the `or` rule is the only thing that moved', () => {
    // The whole point. With the weakest n at 1, `monthsObserved >= CONFIDENCE_MONTHS_FAIR` is false
    // in every month, so an `and` rule reports `rough-estimate` three times and the fixture goes
    // red. This is the mutation, run: swap either `||` in `monthConfidenceOf` for `&&`.
    const { layer, months } = scaledMonths();
    expect(layer.weakestMonthsObserved).toBe(1);
    expect(layer.weakestMonthsObserved).toBeLessThan(CONFIDENCE_MONTHS_FAIR);
    const underAnd = months.map((m) =>
      layer.weakestMonthsObserved >= CONFIDENCE_MONTHS_STRONG && m.share >= CONFIDENCE_COMMITTED_STRONG
        ? 'well-based'
        : layer.weakestMonthsObserved >= CONFIDENCE_MONTHS_FAIR && m.share >= CONFIDENCE_COMMITTED_FAIR
          ? 'estimate'
          : 'rough-estimate'
    );
    expect(new Set(underAnd).size).toBe(1);
    expect(underAnd[0]).toBe('rough-estimate');
  });

  it('the three shares straddle BOTH cut-points, which is why all three states are reachable', () => {
    const { months } = scaledMonths();
    const shares = months.map((m) => m.share);
    expect(Math.max(...shares)).toBeGreaterThanOrEqual(CONFIDENCE_COMMITTED_STRONG);
    expect(shares.some((s) => s >= CONFIDENCE_COMMITTED_FAIR && s < CONFIDENCE_COMMITTED_STRONG)).toBe(true);
    expect(Math.min(...shares)).toBeLessThan(CONFIDENCE_COMMITTED_FAIR);
  });

  it('!! THE EXCUSE, MEASURED: scaling an AMOUNT moves no row count, so the ceiling never moved', () => {
    // `rowsRead` is identical to the unscaled layer's, and it is 13% OF the ceiling rather than
    // anywhere near it. The statistical side of every month is byte-identical too — the scaling
    // touched the certain layer only.
    const { layer, months } = scaledMonths();
    expect(layer.rowsRead).toBe(readyLayer().rowsRead);
    expect(layer.rowsRead).toBe(readRows(corpus).length);
    expect(layer.rowsRead).toBeLessThan(HISTORY_ROW_CEILING / 2);
    expect(new Set(months.map((m) => m.statisticalILS)).size).toBe(1);
  });

  it('!! and the 9.1% belongs to the TWENTY-MEMBER corpus, which this fixture never touches', () => {
    // The conflation, named in numbers. Two different `buildDemoCorpus` calls, two different row
    // counts, on two different sides of the ceiling.
    const large = buildDemoCorpus({ memberCount: DEMO_LARGE_MEMBER_COUNT });
    expect(readRows(corpus).length).toBeLessThan(HISTORY_ROW_CEILING);
    expect(readRows(large).length).toBeGreaterThan(HISTORY_ROW_CEILING);
    // the base corpus is a fraction OF the ceiling; the large one is a fraction OVER it
    expect(readRows(corpus).length / HISTORY_ROW_CEILING).toBeLessThan(0.2);
    expect(readRows(large).length / HISTORY_ROW_CEILING - 1).toBeLessThan(0.2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D33 — the ceiling, on the 20-member corpus that crosses it
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D33 — the 20-member corpus crosses the ceiling and the layer degrades EXPLICITLY', () => {
  const large = buildDemoCorpus({ memberCount: DEMO_LARGE_MEMBER_COUNT });

  it('one window read really does return more than the ceiling', () => {
    expect(readRows(large).length).toBeGreaterThan(HISTORY_ROW_CEILING);
  });

  it('!! the layer refuses, names the row count, and offers a SHORTER window — never a truncated average', () => {
    const result = layerOverCorpus(large);
    expect(result.status).toBe('refused-too-many-rows');
    if (result.status !== 'refused-too-many-rows') throw new Error('x');
    expect(result.lineItems).toEqual([]);
    expect(result.rowsRead).toBe(readRows(large).length);
    expect(result.reasonHe).toContain(String(readRows(large).length));
    expect(result.window.status).toBe('too-many-rows');
    if (result.window.status !== 'too-many-rows') throw new Error('x');
    expect(result.window.suggestedWindowMonths).toBeLessThan(LOOKBACK_MONTHS_MAX);
    expect(result.window.suggestedWindowMonths).toBeGreaterThanOrEqual(LOOKBACK_MONTHS_MIN);
  });

  it('!! ALL the rows were read — a `limit()` would have returned the ceiling and averaged happily', () => {
    // The lie this ruling exists to prevent, stated as a number: with `limit(2000)` the read comes
    // back at exactly the ceiling, the layer computes, and the figure is an average over an
    // arbitrary slice of the window that renders identically to one over all of it.
    const result = layerOverCorpus(large);
    if (result.status !== 'refused-too-many-rows') throw new Error('x');
    expect(result.rowsRead).toBeGreaterThan(HISTORY_ROW_CEILING);
  });

  it('the base corpus stays comfortably under it, so the base tests are not measuring the ceiling', () => {
    expect(readRows(corpus).length).toBeLessThan(HISTORY_ROW_CEILING);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T6 / D24 — SEASONALITY APPLIED, ON THE CORPUS
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! a seasonality assumption scales one month and leaves the others alone', () => {
  const seasonal = corpus.forecastAssumptions.filter((a) => a.scopeKind === 'seasonality');
  const scope = parseSeasonalityScopeId(seasonal[0].scopeId);

  function layerWithAssumptions() {
    return buildStatisticalLayer({
      history: sealStatisticalHistory(markerOf(corpus), readRows(corpus)),
      windowPeriods: corpus.windowPeriods,
      horizon: corpus.horizonPeriods,
      assumptions: corpus.forecastAssumptions,
    });
  }

  it('the corpus carries exactly one seasonality assumption, and its scope parses', () => {
    expect(seasonal).toHaveLength(1);
    expect(scope).not.toBeNull();
  });

  it('the scoped category is one the layer actually estimates — otherwise the factor is inert', () => {
    // The T4 corpus scoped its factor at `DEMO_CATEGORY_EDUCATION`, which has n = 0 rows by
    // construction. A factor on a category with no estimate multiplies nothing, forever, and every
    // assertion about the document still passes.
    const estimate = readyLayer().categories.find((c) => c.categoryId === scope?.categoryId);
    expect(estimate?.status).toBe('estimated');
  });

  it('MULTIPLIES the scoped month, by the stored factor, and rounds to agorot', () => {
    const base = readyLayer();
    const scaled = layerWithAssumptions();
    if (scaled.status !== 'ready') throw new Error('expected a ready layer');

    const inScope = (item: { period: string; categoryId: string }): boolean =>
      item.categoryId === scope?.categoryId && item.period === seasonal[0].fromPeriod;

    const before = base.lineItems.find(inScope);
    const after = scaled.lineItems.find(inScope);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    const factor = seasonal[0].factor as number;
    expect(after?.amountILS).toBe(Math.round((before as { amountILS: number }).amountILS * factor * 100) / 100);
    // and the multiplication is REAL, not a rounding artefact
    expect(after?.amountILS).toBeGreaterThan((before as { amountILS: number }).amountILS);
  });

  it('leaves every OTHER month of the same category exactly where it was', () => {
    // The failure this catches is the one that makes seasonality worthless: a factor resolved per
    // CATEGORY rather than per (category, month) scales the whole horizon and stops being seasonal.
    const base = readyLayer();
    const scaled = layerWithAssumptions();
    if (scaled.status !== 'ready') throw new Error('expected a ready layer');
    const otherMonths = corpus.horizonPeriods.filter((p) => p !== seasonal[0].fromPeriod);
    expect(otherMonths.length).toBeGreaterThan(0);
    for (const period of otherMonths) {
      const before = base.lineItems.find((i) => i.categoryId === scope?.categoryId && i.period === period);
      const after = scaled.lineItems.find((i) => i.categoryId === scope?.categoryId && i.period === period);
      expect(after?.amountILS).toBe(before?.amountILS);
    }
  });

  it('leaves every other CATEGORY in the scoped month alone', () => {
    const base = readyLayer();
    const scaled = layerWithAssumptions();
    if (scaled.status !== 'ready') throw new Error('expected a ready layer');
    const others = base.lineItems.filter(
      (i) => i.period === seasonal[0].fromPeriod && i.categoryId !== scope?.categoryId
    );
    expect(others.length).toBeGreaterThan(0);
    for (const before of others) {
      const after = scaled.lineItems.find((i) => i.categoryId === before.categoryId && i.period === before.period);
      expect(after?.amountILS).toBe(before.amountILS);
    }
  });

  it('stamps the factor on the basis, so the hover can attribute it to a person', () => {
    const scaled = layerWithAssumptions();
    if (scaled.status !== 'ready') throw new Error('expected a ready layer');
    const item = scaled.lineItems.find(
      (i) => i.categoryId === scope?.categoryId && i.period === seasonal[0].fromPeriod
    );
    expect(item?.basis.kind).toBe('movingAverage');
    if (item?.basis.kind === 'movingAverage') {
      expect(item.basis.seasonalFactor).toEqual({ factor: seasonal[0].factor, source: 'user', n: 0 });
    }
  });

  it('OMITTING `assumptions` is the same number as before T6 — absence is not a silent scaling', () => {
    const base = readyLayer();
    const explicitEmpty = buildStatisticalLayer({
      history: sealStatisticalHistory(markerOf(corpus), readRows(corpus)),
      windowPeriods: corpus.windowPeriods,
      horizon: corpus.horizonPeriods,
      assumptions: [],
    });
    if (explicitEmpty.status !== 'ready') throw new Error('expected a ready layer');
    expect(explicitEmpty.lineItems.map((i) => i.amountILS)).toEqual(base.lineItems.map((i) => i.amountILS));
    for (const item of base.lineItems) {
      if (item.basis.kind === 'movingAverage') expect(item.basis.seasonalFactor).toBeNull();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // !! T6 review, F4 (the related tail) — THE THING A REAL FAMILY WILL ACTUALLY CLICK
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // The corpus DOCUMENT was driven end to end above. `SEASONALITY_OFFERS` — the one-click accept
  // path T7b wires — was not: it was asserted to parse and to be in range, which is the same
  // "checked beside the mechanism" shape the corpus document had before T6 fixed it. So the offers
  // are ACCEPTED here, through the real `offeredSeasonalityAssumptions`, and the resulting drafts
  // are fed to the real `buildStatisticalLayer`.
  //
  // What that measurement found is written into the assertions rather than into a comment: ONE of
  // the two shipped offers moves a number on this corpus and the other CANNOT, because it is scoped
  // at `DEMO_CATEGORY_EDUCATION` — n = 0 by construction, the exact category whose inertness was the
  // T4 finding.

  describe('!! an ACCEPTED offer, driven through the layer', () => {
    const accepted = (): Array<Omit<ForecastAssumption, 'id' | 'createdAt' | 'updatedAt'>> =>
      offeredSeasonalityAssumptions({
        offers: SEASONALITY_OFFERS,
        existing: [],
        ownerId: corpus.members[0].id,
        // Each offer names a MONTH; the draft's `fromPeriod` is the first horizon month, and the
        // scope id carries the month key. The horizon here does not contain either offered month,
        // which is exactly why the assertions below are about the layer's own line items rather
        // than about a particular horizon slot.
        fromPeriod: corpus.horizonPeriods[0],
      });

    /** The layer, computed with these drafts in play, over a horizon that CONTAINS `period`. */
    function layerOverHorizonIncluding(period: string, drafts: ForecastAssumption[]) {
      const horizon = [...new Set([...corpus.horizonPeriods, period])].sort();
      const withPeriod = buildStatisticalLayer({
        history: sealStatisticalHistory(markerOf(corpus), readRows(corpus)),
        windowPeriods: corpus.windowPeriods,
        horizon,
        assumptions: drafts,
      });
      const without = buildStatisticalLayer({
        history: sealStatisticalHistory(markerOf(corpus), readRows(corpus)),
        windowPeriods: corpus.windowPeriods,
        horizon,
      });
      if (withPeriod.status !== 'ready' || without.status !== 'ready') throw new Error('expected ready layers');
      return { withPeriod, without, horizon };
    }

    /** An offer's draft, dated so its own month is inside the horizon it is measured over. */
    function draftFor(offer: { categoryId: string; monthKey: string }): {
      draft: ForecastAssumption;
      period: string;
    } {
      const period = `${corpus.anchorPeriod.slice(0, 4)}-${offer.monthKey}`;
      const drafts = offeredSeasonalityAssumptions({
        offers: SEASONALITY_OFFERS.filter((o) => o.categoryId === offer.categoryId && o.monthKey === offer.monthKey),
        existing: [],
        ownerId: corpus.members[0].id,
        fromPeriod: period,
      });
      expect(drafts).toHaveLength(1);
      return { draft: { ...drafts[0], id: 'accepted', createdAt: '', updatedAt: '' }, period };
    }

    it('accepting produces one writable draft per offer, with a scope that PARSES', () => {
      const drafts = accepted();
      expect(drafts).toHaveLength(SEASONALITY_OFFERS.length);
      for (const draft of drafts) expect(parseSeasonalityScopeId(draft.scopeId)).not.toBeNull();
    });

    it('!! the APRIL offer moves a real number — accepted, through the shipped layer', () => {
      const april = SEASONALITY_OFFERS.find((o) => o.categoryId === CATEGORY_MAP.Groceries_Dining);
      if (!april) throw new Error('expected a groceries offer');
      const { draft, period } = draftFor(april);
      const { withPeriod, without } = layerOverHorizonIncluding(period, [draft]);

      const pick = (items: typeof withPeriod.lineItems) =>
        items.find((i) => i.period === period && i.categoryId === april.categoryId);
      const before = pick(without.lineItems);
      const after = pick(withPeriod.lineItems);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after?.amountILS).toBe(
        Math.round((before as { amountILS: number }).amountILS * april.factor * 100) / 100
      );
      expect(after?.amountILS).not.toBe(before?.amountILS);
    });

    it('!! and the SEPTEMBER offer is INERT ON THIS CORPUS — measured, and here is the reason', () => {
      // Not a comment: `DEMO_CATEGORY_EDUCATION` IS `CATEGORY_MAP.Education`, the offer's own
      // category, and that category has NO estimate in the layer because it has n = 0 rows. So a
      // member who clicks "accept" on the September suggestion writes a perfectly valid document
      // that changes nothing they can see, with no symptom.
      //
      // That is a PRODUCT requirement for T7b, recorded here as a measurement rather than as a
      // note: the accept surface must not offer a factor for a category the layer has no estimate
      // for — or must say what accepting will do. It is NOT closed by inventing an engine field for
      // it here; a readout with no renderer is exactly the invented-field defect F6 was about.
      const september = SEASONALITY_OFFERS.find((o) => o.categoryId !== CATEGORY_MAP.Groceries_Dining);
      if (!september) throw new Error('expected a second offer');
      expect(september.categoryId).toBe(DEMO_CATEGORY_EDUCATION);

      const { draft, period } = draftFor(september);
      const { withPeriod, without } = layerOverHorizonIncluding(period, [draft]);

      // The category the offer names is not estimated at all…
      expect(without.categories.find((c) => c.categoryId === september.categoryId)?.status).not.toBe('estimated');
      // …so accepting changes NOT ONE line item anywhere in the layer.
      expect(withPeriod.lineItems).toEqual(without.lineItems);
    });
  });

  it('the OBSERVED half cannot fire on this corpus, and the window is why', () => {
    // Every estimated category on this corpus reports at most `LOOKBACK_MONTHS_MAX` months, and two
    // observations of one calendar month are twelve periods apart. So `observedSeasonalFactor`
    // returns `insufficient-observations` for every (category, month) pair the layer produces — the
    // "dead code for a long time" the plan names, asserted rather than assumed.
    const ready = readyLayer();
    for (const category of ready.categories) {
      if (category.status !== 'estimated') continue;
      const observations = category.periods.map((period, index) => ({
        categoryId: category.categoryId,
        period,
        totalILS: category.monthlyTotalsILS[index],
      }));
      for (const period of corpus.horizonPeriods) {
        const result = observedSeasonalFactor(category.categoryId, monthKeyOf(period), observations);
        expect(result.status).not.toBe('factor');
      }
    }
  });
});
