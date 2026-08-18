// Stage 7 T5 — the statistical layer, D26's cold-start table, D3's band, D41's chip and D33's
// ceiling.
//
// ── WHAT IS SYNTHETIC HERE AND WHAT IS NOT ─────────────────────────────────────────────────────
//
// The table-driven predicates are exercised on SYNTHETIC input, because a table is exactly the
// thing a corpus cannot prove exhaustively — the real corpus reaches four of the five cold-start
// rows and three of the four `monthConfidenceOf` outcomes, and a row nothing reaches is a row
// nothing holds.
//
// Everything about a NUMBER is exercised on the T4 corpus. `statisticalLayerCorpus.test.ts` holds
// that half: the `recurringId` exclusion, the `isExpenseRow`-vs-`isExpenseListRow` divergence, the
// weakest-n month and the ₪0 branches all move a real figure there, which is what makes their
// mutations fail rather than merely differ.
//
// !! LIVE EMULATOR: NOT REQUIRED, AND THE PLAN SAYS SO BY NAME. The layer is a pure function over
// arrays the caller fetched; T4 supplies the corpus; the one Firestore fact in reach — that
// `loadStatisticalHistory` issues no query without the marker — was proven live in T3 and is held
// here by the type, not by a probe.
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_OTHER,
  CONFIDENCE_COMMITTED_FAIR,
  CONFIDENCE_COMMITTED_STRONG,
  CONFIDENCE_MONTHS_FAIR,
  CONFIDENCE_MONTHS_STRONG,
  HISTORY_ROW_CEILING,
  LOOKBACK_MONTHS_MAX,
  LOOKBACK_MONTHS_MIN,
  bandBasisOf,
  bandBasisOfObservations,
  buildStatisticalLayer,
  certainLayerSummaryHe,
  coldStartBehaviourOf,
  coldStartRowOf,
  committedShareOf,
  countsTowardMovingAverage,
  hasRecurringId,
  historyWindowStateOf,
  lookbackWindowPeriods,
  missingForecastInputs,
  monthConfidenceOf,
  observedBandOf,
  statisticalCategoryOf,
  statisticalEstimateOf,
  weakestMonthsObserved,
  type ColdStartRow,
  type ForecastInputKey,
  type ForecastLineItem,
} from '../utils/forecast';
import {
  CERTAIN_LAYER_EMPTY_HE,
  FORECAST_INPUT_LABEL_HE,
  STATISTICAL_GAP_REASON_HE,
} from '../utils/forecastCopy';
import {
  refuseStatisticalHistory,
  sealStatisticalHistory,
  type StatisticalHistoryRow,
} from '../utils/statisticalHistory';
import { BACKFILL_INCOMPLETE_REASON_HE, type TransactionPeriodBackfillMarker } from '../utils/backfillMarker';

const MARKER: TransactionPeriodBackfillMarker = {
  completedAt: '2026-08-18T09:00:00.000Z',
  sourceCommit: '1473b76',
  rowsStamped: 10,
  rowsUnknown: 0,
  lastRunAt: '2026-08-18T09:00:00.000Z',
  lastRunCommit: '1473b76',
  transactionRows: 10,
};

const WINDOW = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const HORIZON = ['2026-08', '2026-09', '2026-10'];

function row(over: Partial<StatisticalHistoryRow> = {}): StatisticalHistoryRow {
  return {
    id: 'r',
    period: '2026-07',
    category: 'מזון וצריכה',
    amount: 100,
    isCredit: false,
    paymentType: 'card',
    recurringId: null,
    ...over,
  };
}

function gated(rows: StatisticalHistoryRow[]) {
  return sealStatisticalHistory(MARKER, rows);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D23 — what the average counts
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('hasRecurringId — D23(b), the discriminator the certain layer already projects', () => {
  it('is true for a non-empty string id', () => {
    expect(hasRecurringId({ recurringId: 'demo-rec-clinic-a' })).toBe(true);
  });

  it('is false for null, undefined and an ABSENT field — the manual-row shapes', () => {
    expect(hasRecurringId({ recurringId: null })).toBe(false);
    expect(hasRecurringId({ recurringId: undefined })).toBe(false);
    expect(hasRecurringId({})).toBe(false);
  });

  it("is false for '' — a falsy-but-present value is a manual row, not an engine with an empty id", () => {
    expect(hasRecurringId({ recurringId: '' })).toBe(false);
  });

  it('is false for a NUMBER, because the documents are schemaless and the tsconfig is not strict', () => {
    expect(hasRecurringId({ recurringId: 12345 as unknown as string })).toBe(false);
  });
});

describe('countsTowardMovingAverage — the four exclusions, one at a time', () => {
  const window = new Set(WINDOW);

  it('counts an ordinary manual expense row inside the window', () => {
    expect(countsTowardMovingAverage(row(), window)).toBe(true);
  });

  it('EXCLUDES a recurring-posted row — or the certain layer counts it twice (D23b)', () => {
    expect(countsTowardMovingAverage(row({ recurringId: 'demo-rec-clinic-a' }), window)).toBe(false);
  });

  it('EXCLUDES every credit, including a refund — `isExpenseRow`, not `isExpenseListRow` (D23a)', () => {
    // THE ONE SHAPE WHERE THE TWO PREDICATES DISAGREE. `isExpenseListRow` keeps this row so a
    // reader can see the refund happened; an average that keeps it counts money that came BACK as
    // money that went out, in every future month.
    expect(countsTowardMovingAverage(row({ isCredit: true, paymentType: 'refund' }), window)).toBe(false);
    expect(countsTowardMovingAverage(row({ isCredit: true, paymentType: 'cancellation' }), window)).toBe(false);
    expect(countsTowardMovingAverage(row({ isCredit: true, paymentType: 'card' }), window)).toBe(false);
  });

  it('EXCLUDES an income-category row, in both the mapped and the legacy spelling', () => {
    expect(countsTowardMovingAverage(row({ category: 'הכנסות והשקעות' }), window)).toBe(false);
    expect(countsTowardMovingAverage(row({ category: 'Income_Investments' }), window)).toBe(false);
  });

  it("EXCLUDES a `period: 'unknown'` row — the query returns it deliberately, the average must not", () => {
    // A5's whole mechanism keeps unparseable rows VISIBLE as a count. Visible is not the same as
    // averaged: the row's month is unknown, so it belongs to no month's total.
    expect(countsTowardMovingAverage(row({ period: 'unknown' }), window)).toBe(false);
  });

  it('EXCLUDES a row outside the window, and a row whose `period` is not a string at all', () => {
    expect(countsTowardMovingAverage(row({ period: '2025-01' }), window)).toBe(false);
    expect(countsTowardMovingAverage(row({ period: 202607 }), window)).toBe(false);
    expect(countsTowardMovingAverage(row({ period: undefined }), window)).toBe(false);
  });

  it('!! EXCLUDES `unknown` EVEN WHEN THE CALLER PASSES THE QUERY`S OWN `in` VALUES AS THE WINDOW', () => {
    // FOUND BY THE MUTATION SWEEP: deleting the `'unknown'` check survived the whole suite, because
    // every fixture passed a clean six-period window. `buildHistoryClauses` sends
    // `[...window, UNKNOWN_PERIOD]` — that exact array is one function away and passing it verbatim
    // is the obvious mistake. With the check gone, every unparseable row in the ledger would land
    // in whichever month the caller named, at full confidence.
    const queryValues = new Set([...WINDOW, 'unknown']);
    expect(countsTowardMovingAverage(row({ period: 'unknown' }), queryValues)).toBe(false);
    expect(countsTowardMovingAverage(row({ period: '2026-07' }), queryValues)).toBe(true);
  });

  it('the two checks are INDEPENDENT — a row outside a window that has no `unknown` in it', () => {
    expect(countsTowardMovingAverage(row({ period: '2020-01' }), new Set(WINDOW))).toBe(false);
  });

  it('still counts a row F-1 stripped of its amount — the REFUSAL is downstream, not here', () => {
    // Deliberate. If this predicate silently dropped an amount-less row, the category would average
    // its readable rows and render at full confidence — which is exactly the "four of six rows"
    // failure `totalObservedILS` exists to refuse. The row is counted IN so the refusal can see it.
    expect(countsTowardMovingAverage(row({ amount: undefined }), window)).toBe(true);
  });
});

describe('statisticalCategoryOf — the bucket, including the shapes a schemaless row can hold', () => {
  it('is the category when there is one', () => {
    expect(statisticalCategoryOf(row({ category: 'תחבורה ורכב' }))).toBe('תחבורה ורכב');
  });

  it('!! an EMPTY STRING falls into `שונות`, not into a nameless bucket of its own', () => {
    // FOUND BY THE MUTATION SWEEP: `typeof row.category === 'string'` alone survived, because no
    // fixture carried `''`. `FileProcessor` writes whatever the extractor returned, so it is a
    // shape the tree produces — and an empty-string bucket renders as a category with no name
    // sitting beside the `שונות` that should have held it.
    expect(statisticalCategoryOf(row({ category: '' }))).toBe(CATEGORY_OTHER);
  });

  it('an absent, null or non-string category falls into `שונות` too', () => {
    expect(statisticalCategoryOf(row({ category: undefined }))).toBe(CATEGORY_OTHER);
    expect(statisticalCategoryOf(row({ category: null }))).toBe(CATEGORY_OTHER);
    expect(statisticalCategoryOf(row({ category: 12345 }))).toBe(CATEGORY_OTHER);
  });

  it('!! `שונות` is the recurring engine`s own default, so the two layers share the bucket', () => {
    // `RecurringService` stamps `category: item.category ?? 'שונות'`. If these drift, a recurring
    // item's forward projection and its posted rows land in different buckets and D23's
    // double-count disclosure quietly stops lining up.
    expect(CATEGORY_OTHER).toBe('שונות');
  });

  it('an uncategorised row is AVERAGED, not dropped — it is real spend', () => {
    const estimate = statisticalEstimateOf(
      CATEGORY_OTHER,
      [
        row({ id: 'a', period: '2026-06', category: '', amount: 100 }),
        row({ id: 'b', period: '2026-07', category: undefined, amount: 300 }),
      ],
      WINDOW
    );
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    expect(estimate.estimateILS).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D23(b) — the exclusion is the SAME RULE for both collections
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D23(b) — `recurringId` excludes in BOTH collections, and it is ONE rule', () => {
  // `RecurringService.postDueItems` writes an EXPENSE into `transaction_lines` and an INCOME into
  // `incomes`, and stamps `recurringId` on both. The double count is the same double count: the
  // certain layer projects the recurring item forward, so a row it already posted must not also be
  // averaged. These are the two shapes that writer actually persists.
  const postedExpenseRow = {
    owner: 'עומר',
    amount: 220,
    date: '2026-07-05',
    category: 'בריאות',
    description: 'מנוי מרפאה',
    isCredit: false,
    expenseClassification: 'Fixed',
    recurringId: 'demo-rec-clinic-a',
    recurringPeriod: '2026-07',
    period: '2026-07',
    ownerId: 'omer-levy',
  };
  const postedIncomeRow = {
    name: 'משכורת',
    amount: 18500,
    date: '2026-07-01',
    month: '07',
    year: '2026',
    recurringId: 'demo-rec-salary',
    recurringPeriod: '2026-07',
    period: '2026-07',
  };

  it('excludes the posted EXPENSE row `transaction_lines` receives', () => {
    expect(hasRecurringId(postedExpenseRow)).toBe(true);
    expect(countsTowardMovingAverage(postedExpenseRow, new Set(WINDOW))).toBe(false);
  });

  it('excludes the posted INCOME row `incomes` receives — the exact mirror, same predicate', () => {
    expect(hasRecurringId(postedIncomeRow)).toBe(true);
  });

  it('and does NOT exclude the manual row either collection also holds', () => {
    expect(hasRecurringId({ ...postedExpenseRow, recurringId: null })).toBe(false);
    expect(hasRecurringId({ ...postedIncomeRow, recurringId: null })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D3 — the band
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! observedBandOf — D3: the family`s own min/median/max, never a multiplier', () => {
  it('is min / median / max of the observed monthly totals', () => {
    expect(observedBandOf([900, 400, 1200, 700, 1000])).toEqual({
      lowILS: 400,
      midILS: 900,
      highILS: 1200,
    });
  });

  it('averages the two middle values on an EVEN count — the six-month window is even', () => {
    expect(observedBandOf([100, 200, 300, 400])).toEqual({ lowILS: 100, midILS: 250, highILS: 400 });
  });

  it('does not mutate the caller`s array while sorting', () => {
    const totals = [900, 400, 1200];
    observedBandOf(totals);
    expect(totals).toEqual([900, 400, 1200]);
  });

  it(`!! DEGENERATES VISIBLY below ${LOOKBACK_MONTHS_MIN} months — returns null, draws nothing`, () => {
    expect(observedBandOf([500, 600])).toBeNull();
    expect(observedBandOf([500])).toBeNull();
    expect(observedBandOf([])).toBeNull();
  });

  it(`draws at exactly ${LOOKBACK_MONTHS_MIN}, which is the floor and not one above it`, () => {
    expect(observedBandOf([500, 600, 700])).toEqual({ lowILS: 500, midILS: 600, highILS: 700 });
  });

  it('!! is NOT a symmetric multiplier — width follows the data, not a constant', () => {
    // The rejected implementation is `mid × 0.85 / mid × 1.15`, whose width is a FIXED fraction of
    // the middle regardless of what the family actually did. Two categories with the same median
    // and different volatility must not get the same band.
    const calm = observedBandOf([990, 1000, 1010]);
    const wild = observedBandOf([200, 1000, 4000]);
    expect(calm.midILS).toBe(wild.midILS);
    expect(wild.highILS - wild.lowILS).toBeGreaterThan(calm.highILS - calm.lowILS);
    // and the multiplier would have produced these, which nothing here does:
    expect(calm.lowILS).not.toBe(1000 * 0.85);
    expect(calm.highILS).not.toBe(1000 * 1.15);
  });
});

describe('bandBasisOfObservations / bandBasisOf — carried, not inferred', () => {
  it(`is 'insufficient-history' below ${LOOKBACK_MONTHS_MIN} and 'observed-range' at or above`, () => {
    expect(bandBasisOfObservations(0)).toBe('insufficient-history');
    expect(bandBasisOfObservations(LOOKBACK_MONTHS_MIN - 1)).toBe('insufficient-history');
    expect(bandBasisOfObservations(LOOKBACK_MONTHS_MIN)).toBe('observed-range');
    expect(bandBasisOfObservations(LOOKBACK_MONTHS_MAX)).toBe('observed-range');
  });

  it('!! the CERTAIN layer has NO band — null for all four contractual bases (D3)', () => {
    expect(bandBasisOf({ kind: 'recurring', recurringId: 'r', description: 'd', chargeDay: 5 })).toBeNull();
    expect(bandBasisOf({ kind: 'loan', loanId: 'l', name: 'משכנתא' })).toBeNull();
    expect(bandBasisOf({ kind: 'insurance', insuranceId: 'i', provider: 'הראל' })).toBeNull();
    expect(
      bandBasisOf({ kind: 'installment', planKey: 'p', observedNumber: 3, totalInstallments: 4 })
    ).toBeNull();
  });

  it("!! an ASSUMPTION-set amount gets 'assumption-fixed' — no error bars on someone's assertion", () => {
    expect(
      bandBasisOf({ kind: 'assumption', assumptionId: 'a', source: 'user', updatedAt: 'x', overrides: [] })
    ).toBe('assumption-fixed');
  });

  it('!! READS the carried value on a movingAverage basis rather than re-deriving it', () => {
    // The mutation this kills: `return basis.monthsObserved >= LOOKBACK_MONTHS_MIN ? … : …`, which
    // looks identical on every honestly-built basis and silently overrides a carried discriminant.
    expect(
      bandBasisOf({
        kind: 'movingAverage',
        monthsObserved: LOOKBACK_MONTHS_MAX,
        periods: WINDOW,
        seasonalFactor: null,
        band: null,
        bandBasis: 'insufficient-history',
      })
    ).toBe('insufficient-history');
  });

  it('throws on an unrecognised kind rather than defaulting to a band', () => {
    expect(() => bandBasisOf({ kind: 'nonsense' } as never)).toThrow(/unrecognised basis kind/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D41 — the confidence chip
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('committedShareOf', () => {
  it('is certain / expense, and income is NOT in the denominator', () => {
    expect(committedShareOf({ certainILS: 3000, expenseILS: 4000 })).toBeCloseTo(0.75);
  });

  it('is 0 for a month with no outflow at all — there is no share to report', () => {
    expect(committedShareOf({ certainILS: 0, expenseILS: 0 })).toBe(0);
  });

  it('is 0, never NaN or Infinity, for a zero or negative denominator', () => {
    expect(committedShareOf({ certainILS: 500, expenseILS: 0 })).toBe(0);
    expect(committedShareOf({ certainILS: 500, expenseILS: -100 })).toBe(0);
    expect(committedShareOf({ certainILS: NaN, expenseILS: 100 })).toBe(0);
  });

  it('is capped at 1 so a rounding drift cannot report more than the whole month', () => {
    expect(committedShareOf({ certainILS: 4001, expenseILS: 4000 })).toBe(1);
  });
});

describe('!! monthConfidenceOf — D41`s table, every cell', () => {
  const table: Array<[number, number, string | null]> = [
    [0, 0, null],
    [0, 1, null],
    [1, 0, 'rough-estimate'],
    [CONFIDENCE_MONTHS_FAIR - 1, CONFIDENCE_COMMITTED_FAIR - 0.01, 'rough-estimate'],
    [CONFIDENCE_MONTHS_FAIR, 0, 'estimate'],
    [1, CONFIDENCE_COMMITTED_FAIR, 'estimate'],
    [CONFIDENCE_MONTHS_STRONG - 1, 0, 'estimate'],
    [CONFIDENCE_MONTHS_STRONG, 0, 'well-based'],
    [1, CONFIDENCE_COMMITTED_STRONG, 'well-based'],
    [LOOKBACK_MONTHS_MAX, 1, 'well-based'],
  ];

  it.each(table)('monthsObserved=%s committedShare=%s → %s', (months, share, expected) => {
    expect(monthConfidenceOf(months, share)).toBe(expected);
  });

  it('!! `or`, NOT `and` — a 90%-contractual month on ONE month of history is well-based', () => {
    // The `and` mutation reports 'rough-estimate' here, which would label the most reliable thing
    // the screen draws as the least reliable.
    expect(monthConfidenceOf(1, 0.9)).toBe('well-based');
    // and the mirror: six months of history with nothing committed is well-based too.
    expect(monthConfidenceOf(LOOKBACK_MONTHS_MAX, 0)).toBe('well-based');
  });

  it(`!! CONFIDENCE_MONTHS_STRONG sits ABOVE the band floor — n=${LOOKBACK_MONTHS_MIN} is not top`, () => {
    // D41 states it as a decision: a month that has only just earned a band has not yet earned the
    // top label. If the two constants ever collapse into one, this fails.
    expect(CONFIDENCE_MONTHS_STRONG).toBeGreaterThan(LOOKBACK_MONTHS_MIN);
    expect(monthConfidenceOf(LOOKBACK_MONTHS_MIN, 0)).toBe('estimate');
  });

  it('no chip at monthsObserved 0 — D26 row 0 and D40`s month (chip ABSENT, not a third label)', () => {
    expect(monthConfidenceOf(0, 0.95)).toBeNull();
    expect(monthConfidenceOf(-1, 1)).toBeNull();
    expect(monthConfidenceOf(NaN, 1)).toBeNull();
  });
});

describe('!! weakestMonthsObserved — the WEAKEST contributing category, never the average', () => {
  it('reports 1 for the mixed n=6 / n=1 month D26 pins the rule with', () => {
    const categories = [{ monthsObserved: 6 }, { monthsObserved: 1 }];
    expect(weakestMonthsObserved(categories)).toBe(1);
    // the average is 3.5 — above CONFIDENCE_MONTHS_FAIR, so the two rules give DIFFERENT chips,
    // which is what makes the mutation `average` visible rather than merely different.
    const average = categories.reduce((s, c) => s + c.monthsObserved, 0) / categories.length;
    expect(average).toBeGreaterThan(CONFIDENCE_MONTHS_FAIR);
    expect(monthConfidenceOf(weakestMonthsObserved(categories), 0)).not.toBe(
      monthConfidenceOf(average, 0)
    );
  });

  it('!! a GAP category counts and drags — confidence must not RISE because a category got worse', () => {
    expect(weakestMonthsObserved([{ monthsObserved: 6 }, { monthsObserved: 6 }])).toBe(6);
    expect(weakestMonthsObserved([{ monthsObserved: 6 }, { monthsObserved: 6 }, { monthsObserved: 1 }])).toBe(1);
  });

  it('is 0 for no categories at all — no chip, which is D40`s month', () => {
    expect(weakestMonthsObserved([])).toBe(0);
  });

  it('!! EVERY category the layer emits has monthsObserved >= 1, which is why it needs no filter', () => {
    // A SHADOWING PROBE from the sweep: adding `.filter((c) => c.monthsObserved > 0)` here survives
    // the whole suite, because a category only exists in the layer if it had a counted row. That
    // makes the filter an equivalent mutant — but only while the invariant holds, and the invariant
    // was implicit. It is a test now, so the day a zero-observation category is emitted this fails
    // rather than the mean quietly changing meaning.
    const result = buildStatisticalLayer({
      history: gated([
        row({ id: 'a', period: '2026-07', category: 'מזון וצריכה', amount: 100 }),
        row({ id: 'b', period: '2026-06', category: 'דיור וחשבונות', amount: 0 }),
        row({ id: 'c', period: 'unknown', category: 'חינוך', amount: 300 }),
      ]),
      windowPeriods: WINDOW,
      horizon: HORIZON,
    });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.categories.length).toBeGreaterThan(0);
    for (const category of result.categories) expect(category.monthsObserved).toBeGreaterThanOrEqual(1);
    // and the category that only had an `'unknown'` row is ABSENT, not present with zero
    expect(result.categories.map((c) => c.categoryId)).not.toContain('חינוך');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D26 — the cold-start table, every row
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! coldStartRowOf — D26`s table, INCLUDING row 0', () => {
  const table: Array<[number, boolean, ColdStartRow]> = [
    [0, false, 'empty'],
    [0, true, 'no-statistical-history'],
    [1, false, 'thin-history'],
    [2, true, 'thin-history'],
    [LOOKBACK_MONTHS_MIN, true, 'full-window'],
    [LOOKBACK_MONTHS_MAX - 1, true, 'full-window'],
    [LOOKBACK_MONTHS_MAX, true, 'window-capped'],
    [LOOKBACK_MONTHS_MAX, false, 'window-capped'],
  ];

  it.each(table)('monthsObserved=%s certainInputs=%s → %s', (months, certain, expected) => {
    expect(coldStartRowOf({ monthsObserved: months, certainInputsPresent: certain })).toBe(expected);
  });

  it('!! row 0 and the no-history row are DIFFERENT rows, and the certain layer is what tells them apart', () => {
    // v1's table presumed a "certain layer only" best case. On the real day-one ledger `recurring`,
    // `loans`, `insurances` and `accounts` do not exist as collections at all, so that best case is
    // unreachable and its actual day-one state was not in the table. These are the two rows.
    expect(coldStartRowOf({ monthsObserved: 0, certainInputsPresent: false })).toBe('empty');
    expect(coldStartRowOf({ monthsObserved: 0, certainInputsPresent: true })).toBe(
      'no-statistical-history'
    );
  });
});

describe('coldStartBehaviourOf — what each row DOES', () => {
  it('!! draws no band below the floor, and does draw one at or above it', () => {
    expect(coldStartBehaviourOf('thin-history').bandDrawn).toBe(false);
    expect(coldStartBehaviourOf('full-window').bandDrawn).toBe(true);
    expect(coldStartBehaviourOf('window-capped').bandDrawn).toBe(true);
  });

  it('draws no statistical layer at all in either zero-history row', () => {
    expect(coldStartBehaviourOf('empty').statisticalLayerDrawn).toBe(false);
    expect(coldStartBehaviourOf('no-statistical-history').statisticalLayerDrawn).toBe(false);
  });

  it('!! only row 0 puts a COUNT in the glance position — a number and a path, not an apology', () => {
    expect(coldStartBehaviourOf('empty').glanceHoldsMissingInputCount).toBe(true);
    for (const other of ['no-statistical-history', 'thin-history', 'full-window', 'window-capped'] as const) {
      expect(coldStartBehaviourOf(other).glanceHoldsMissingInputCount).toBe(false);
    }
  });

  it('allows seasonality only where a band is drawn — D24 needs the same history D3 does', () => {
    expect(coldStartBehaviourOf('thin-history').seasonalityAllowed).toBe(false);
    expect(coldStartBehaviourOf('full-window').seasonalityAllowed).toBe(true);
  });

  it('throws on an unrecognised row rather than defaulting to the permissive one', () => {
    expect(() => coldStartBehaviourOf('nonsense' as ColdStartRow)).toThrow(/unrecognised cold-start row/);
  });
});

describe('missingForecastInputs — D26 row 0`s onboarding path', () => {
  const allMissing: Record<ForecastInputKey, boolean> = {
    accounts: false,
    incomes: false,
    recurring: false,
    loans: false,
    insurances: false,
    history: false,
  };

  it('names every missing input, in a FIXED order so the count and the list agree', () => {
    const missing = missingForecastInputs(allMissing);
    expect(missing.map((m) => m.key)).toEqual([
      'accounts',
      'incomes',
      'recurring',
      'loans',
      'insurances',
      'history',
    ]);
    expect(missing.every((m) => m.labelHe.length > 0)).toBe(true);
  });

  it('names only the ones that are missing', () => {
    const missing = missingForecastInputs({ ...allMissing, accounts: true, incomes: true });
    expect(missing.map((m) => m.key)).toEqual(['recurring', 'loans', 'insurances', 'history']);
  });

  it('is empty when everything is present', () => {
    const present = Object.fromEntries(
      Object.keys(allMissing).map((k) => [k, true])
    ) as Record<ForecastInputKey, boolean>;
    expect(missingForecastInputs(present)).toEqual([]);
  });

  it('every key has a Hebrew label — an unlabelled deep link is a link to nowhere', () => {
    for (const key of Object.keys(allMissing) as ForecastInputKey[]) {
      expect(FORECAST_INPUT_LABEL_HE[key]).toBeTruthy();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D33 — the ceiling
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! historyWindowStateOf — D33`s explicit degradation', () => {
  it('is ok at and below the ceiling', () => {
    expect(historyWindowStateOf(HISTORY_ROW_CEILING, LOOKBACK_MONTHS_MAX).status).toBe('ok');
    expect(historyWindowStateOf(0, LOOKBACK_MONTHS_MAX).status).toBe('ok');
  });

  it('degrades EXPLICITLY one row above the ceiling, naming the count and offering a shorter window', () => {
    const state = historyWindowStateOf(HISTORY_ROW_CEILING + 1, LOOKBACK_MONTHS_MAX);
    expect(state.status).toBe('too-many-rows');
    if (state.status !== 'too-many-rows') throw new Error('unreachable');
    expect(state.rowsReturned).toBe(HISTORY_ROW_CEILING + 1);
    expect(state.ceiling).toBe(HISTORY_ROW_CEILING);
    expect(state.reasonHe).toContain(String(HISTORY_ROW_CEILING + 1));
    expect(state.reasonHe).toContain(String(state.suggestedWindowMonths));
  });

  it('offers 5 months on the T4 corpus`s measured 2,182 rows — a real, shorter window', () => {
    const state = historyWindowStateOf(2182, LOOKBACK_MONTHS_MAX);
    if (state.status !== 'too-many-rows') throw new Error('expected degradation');
    expect(state.suggestedWindowMonths).toBe(5);
  });

  it(`!! never offers a window below ${LOOKBACK_MONTHS_MIN} — an offer that loses the band is not an offer`, () => {
    const state = historyWindowStateOf(HISTORY_ROW_CEILING * 100, LOOKBACK_MONTHS_MAX);
    if (state.status !== 'too-many-rows') throw new Error('expected degradation');
    expect(state.suggestedWindowMonths).toBe(LOOKBACK_MONTHS_MIN);
  });

  it('always offers something STRICTLY shorter than the window that failed', () => {
    for (const rows of [HISTORY_ROW_CEILING + 1, 2182, 3000, 4800]) {
      const state = historyWindowStateOf(rows, LOOKBACK_MONTHS_MAX);
      if (state.status !== 'too-many-rows') throw new Error('expected degradation');
      expect(state.suggestedWindowMonths).toBeLessThan(LOOKBACK_MONTHS_MAX);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The window
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('lookbackWindowPeriods', () => {
  it('is the months STRICTLY BEFORE the anchor, ascending', () => {
    expect(lookbackWindowPeriods('2026-08', 3)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('defaults to the full window and crosses a year boundary by arithmetic, not by slicing', () => {
    expect(lookbackWindowPeriods('2026-02')).toEqual([
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('!! never includes the anchor — averaging a month still running divides a partial month', () => {
    expect(lookbackWindowPeriods('2026-08')).not.toContain('2026-08');
  });

  it('REFUSES a malformed anchor, from `previousPeriod`, one frame down', () => {
    expect(() => lookbackWindowPeriods('')).toThrow();
    expect(() => lookbackWindowPeriods('unknown')).toThrow();
  });

  it(`refuses a width outside 1..${LOOKBACK_MONTHS_MAX} rather than silently capping it`, () => {
    expect(() => lookbackWindowPeriods('2026-08', 0)).toThrow(/months must be an integer/);
    expect(() => lookbackWindowPeriods('2026-08', LOOKBACK_MONTHS_MAX + 1)).toThrow(/months must be an integer/);
    expect(() => lookbackWindowPeriods('2026-08', 2.5)).toThrow(/months must be an integer/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// statisticalEstimateOf — the per-category answer, and the ₪0 branch
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('statisticalEstimateOf', () => {
  it('averages over months OBSERVED, not over the window width', () => {
    const estimate = statisticalEstimateOf(
      'מזון וצריכה',
      [
        row({ id: 'a', period: '2026-05', amount: 300 }),
        row({ id: 'b', period: '2026-06', amount: 500 }),
        row({ id: 'c', period: '2026-07', amount: 400 }),
      ],
      WINDOW
    );
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    expect(estimate.monthsObserved).toBe(3);
    // 1200 / 3 = 400. Dividing by the six-month window would give 200 and label it n=3.
    expect(estimate.estimateILS).toBe(400);
    expect(estimate.periods).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('!! F5 — `periods` IS ASCENDING, and it is ascending because of the sort and nothing else', () => {
    // A T5-review survivor, and the reason it matters is the doc comment on the field: "The
    // observed periods, ascending." Nothing on the read path makes that true —
    // `listTransactionHistory` issues NO `orderBy`, and the periods come out of a `Map` in
    // insertion order, i.e. Firestore document order. Deleting `periods.sort()` passed every test
    // in the suite. A doc comment asserting a property no test checks is a defect, so here is the
    // test: the rows arrive newest-first and the field still comes back oldest-first.
    //
    // `monthlyTotalsILS` is built by walking `periods`, so the order is not cosmetic — it is the
    // order of the array D3's band and T7b's sparkline are read from.
    const newestFirst = [
      row({ id: 'c', period: '2026-07', amount: 700 }),
      row({ id: 'a', period: '2026-05', amount: 500 }),
      row({ id: 'b', period: '2026-06', amount: 600 }),
    ];
    const estimate = statisticalEstimateOf('מזון וצריכה', newestFirst, WINDOW);
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    expect(estimate.periods).toEqual(['2026-05', '2026-06', '2026-07']);
    // unsorted, the Map would have yielded ['2026-07', '2026-05', '2026-06'] — a different array
    expect(estimate.periods).not.toEqual(newestFirst.map((r) => String(r.period)));
    expect(estimate.monthlyTotalsILS).toEqual([500, 600, 700]);
    expect(estimate.periods).toHaveLength(estimate.monthsObserved);
  });

  it('!! F5 — the `gap` members carry an ascending `periods` too, by the same sort', () => {
    // The unreadable-amount gap reports the periods it looked at. Same field, same promise, and it
    // reaches it down a different branch — so the sort has to be above the branch, not inside one.
    const newestFirst = [
      row({ id: 'c', period: '2026-07', amount: 700 }),
      row({ id: 'a', period: '2026-05', amount: 'not a number' }),
      row({ id: 'b', period: '2026-06', amount: 600 }),
    ];
    const estimate = statisticalEstimateOf('מזון וצריכה', newestFirst, WINDOW);
    if (estimate.status !== 'gap') throw new Error('expected a gap');
    expect(estimate.gapReason).toBe('unreadable-amounts');
    expect(estimate.periods).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('sums MULTIPLE rows in one month into that month`s total before averaging', () => {
    const estimate = statisticalEstimateOf(
      'מזון וצריכה',
      [
        row({ id: 'a', period: '2026-06', amount: 100 }),
        row({ id: 'b', period: '2026-06', amount: 200 }),
        row({ id: 'c', period: '2026-07', amount: 900 }),
      ],
      WINDOW
    );
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    expect(estimate.monthlyTotalsILS).toEqual([300, 900]);
    expect(estimate.estimateILS).toBe(600);
  });

  it('carries the band and its basis at or above the floor', () => {
    const rows = ['2026-03', '2026-04', '2026-05', '2026-06'].map((period, i) =>
      row({ id: `r${i}`, period, amount: [200, 400, 600, 800][i] })
    );
    const estimate = statisticalEstimateOf('מזון וצריכה', rows, WINDOW);
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    expect(estimate.bandBasis).toBe('observed-range');
    expect(estimate.band).toEqual({ lowILS: 200, midILS: 500, highILS: 800 });
  });

  it('!! shows the average with NO BAND at n=1 and n=2, and says which basis that is', () => {
    const estimate = statisticalEstimateOf(
      'פנאי ונסיעות',
      [
        row({ id: 'a', period: '2026-06', category: 'פנאי ונסיעות', amount: 140 }),
        row({ id: 'b', period: '2026-07', category: 'פנאי ונסיעות', amount: 160 }),
      ],
      WINDOW
    );
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    expect(estimate.monthsObserved).toBe(2);
    expect(estimate.estimateILS).toBe(150);
    expect(estimate.band).toBeNull();
    expect(estimate.bandBasis).toBe('insufficient-history');
  });

  it('!! ZERO HISTORY is a STATED GAP, and there is no amount field on it at all', () => {
    const estimate = statisticalEstimateOf('חינוך', [], WINDOW);
    expect(estimate.status).toBe('gap');
    if (estimate.status !== 'gap') throw new Error('unreachable');
    expect(estimate.gapReason).toBe('no-history');
    expect(estimate.reasonHe).toBe(STATISTICAL_GAP_REASON_HE['no-history']);
    expect(estimate).not.toHaveProperty('estimateILS');
  });

  it('!! AN n=1 CATEGORY WHOSE SINGLE OBSERVATION WAS ₪0 IS A GAP, NOT A ₪0 ESTIMATE', () => {
    // §12's first no-₪0 branch, and the one v1 could not see: the zero-HISTORY early return emits
    // no symbols at all, so a guard scoped to it is vacuous. THIS is the branch that renders a
    // misleading ₪0 — an observation exists and it is zero, which is a fully-credited bill, not a
    // category that costs nothing.
    const estimate = statisticalEstimateOf(
      'דיור וחשבונות',
      [row({ id: 'demo-tx-housing-zero', period: '2026-07', category: 'דיור וחשבונות', amount: 0 })],
      WINDOW
    );
    expect(estimate.status).toBe('gap');
    if (estimate.status !== 'gap') throw new Error('unreachable');
    expect(estimate.monthsObserved).toBe(1);
    expect(estimate.gapReason).toBe('no-spend-observed');
    expect(estimate).not.toHaveProperty('estimateILS');
    // and the sentence it renders instead carries no money symbol at all
    expect(estimate.reasonHe).not.toMatch(/₪/);
  });

  it('a net-credit history is the same gap — never a negative or zero estimate', () => {
    const estimate = statisticalEstimateOf(
      'דיור וחשבונות',
      [
        row({ id: 'a', period: '2026-06', category: 'דיור וחשבונות', amount: -50 }),
        row({ id: 'b', period: '2026-07', category: 'דיור וחשבונות', amount: 0 }),
      ],
      WINDOW
    );
    expect(estimate.status).toBe('gap');
    if (estimate.status !== 'gap') throw new Error('unreachable');
    expect(estimate.gapReason).toBe('no-spend-observed');
  });

  it('!! REFUSES THE WHOLE CATEGORY on an unreadable amount, naming every offending row', () => {
    // F-1's live finding: a parent can strip `amount` off a row and it still comes back from the
    // query. Averaging the readable rows renders IDENTICALLY to averaging all of them.
    const estimate = statisticalEstimateOf(
      'מזון וצריכה',
      [
        row({ id: 'good', period: '2026-06', amount: 400 }),
        row({ id: 'stripped', period: '2026-07', amount: undefined }),
        row({ id: 'text', period: '2026-07', amount: 'שלוש מאות' }),
      ],
      WINDOW
    );
    expect(estimate.status).toBe('gap');
    if (estimate.status !== 'gap') throw new Error('unreachable');
    expect(estimate.gapReason).toBe('unreadable-amounts');
    expect(estimate.unreadable.map((u) => u.id).sort()).toEqual(['stripped', 'text']);
    expect(estimate.unreadable.map((u) => u.reason).sort()).toEqual(['absent', 'not-a-number']);
  });

  it('refuses on NaN specifically — `typeof NaN` is "number" and NaN contaminates every sum', () => {
    const estimate = statisticalEstimateOf(
      'מזון וצריכה',
      [row({ id: 'nan', period: '2026-07', amount: NaN })],
      WINDOW
    );
    if (estimate.status !== 'gap') throw new Error('expected a gap');
    expect(estimate.unreadable[0].reason).toBe('not-finite');
  });

  it('a poisoned category does not delete a healthy one — the refusal is per category', () => {
    const rows = [
      row({ id: 'a', period: '2026-06', category: 'מזון וצריכה', amount: undefined }),
      row({ id: 'b', period: '2026-06', category: 'תחבורה', amount: 420 }),
      row({ id: 'c', period: '2026-07', category: 'תחבורה', amount: 380 }),
    ];
    expect(statisticalEstimateOf('מזון וצריכה', rows, WINDOW).status).toBe('gap');
    expect(statisticalEstimateOf('תחבורה', rows, WINDOW).status).toBe('estimated');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// buildStatisticalLayer — the door, the ceiling, and the horizon
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! buildStatisticalLayer — the marker refusal comes FIRST', () => {
  it('refuses without reading a row when the history handle is a refusal', () => {
    const result = buildStatisticalLayer({
      history: refuseStatisticalHistory(BACKFILL_INCOMPLETE_REASON_HE),
      windowPeriods: WINDOW,
      horizon: HORIZON,
    });
    expect(result.status).toBe('refused-backfill-incomplete');
    expect(result.lineItems).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.reasonHe).toBe(BACKFILL_INCOMPLETE_REASON_HE);
  });

  it('!! THROWS on a FORGED ready handle — the runtime half of the door', () => {
    // The compiler lets an `as` assertion through between overlapping shapes. This is the frame
    // where that stops: the brand is a module-private symbol nothing else can write.
    const forged = {
      status: 'ready',
      rows: [row()],
      markerCompletedAt: MARKER.completedAt,
      markerSourceCommit: MARKER.sourceCommit,
    } as unknown as ReturnType<typeof sealStatisticalHistory>;
    expect(() =>
      buildStatisticalLayer({ history: forged, windowPeriods: WINDOW, horizon: HORIZON })
    ).toThrow(/loadStatisticalHistory/);
  });

  it('!! F1, MEASURED ON THE LAYER — a SPREAD of a real handle, with the corpus swapped, THROWS', () => {
    // This is the T5 review's measurement, run forwards. Seal three ₪100 rows, spread the sealed
    // handle and replace the corpus with one ungated ₪9999 row: before the fix the layer returned
    // `status: 'ready'`, `rowsRead: 1`, `estimateILS: 9999` — an average over a corpus that never
    // passed the marker, rendering IDENTICALLY to one that did. The spread carries a GENUINE brand
    // (proven in `statisticalHistory.test.ts`), so nothing readable off the object could refuse it;
    // what refuses it is that a spread is a different object.
    const real = gated([
      row({ id: 'a', period: '2026-05', amount: 100 }),
      row({ id: 'b', period: '2026-06', amount: 100 }),
      row({ id: 'c', period: '2026-07', amount: 100 }),
    ]);
    const honest = buildStatisticalLayer({ history: real, windowPeriods: WINDOW, horizon: HORIZON });
    if (honest.status !== 'ready') throw new Error('expected ready');
    expect(honest.rowsRead).toBe(3);

    const spread = { ...real, rows: [row({ id: 'forged', period: '2026-07', amount: 9999 })] };
    expect(() =>
      buildStatisticalLayer({ history: spread, windowPeriods: WINDOW, horizon: HORIZON })
    ).toThrow(/loadStatisticalHistory/);

    // `Object.assign` and an `Object.create` heir take the same road and meet the same door.
    const assigned = Object.assign({}, real, { rows: [row({ id: 'forged', amount: 9999 })] });
    expect(() =>
      buildStatisticalLayer({ history: assigned, windowPeriods: WINDOW, horizon: HORIZON })
    ).toThrow(/loadStatisticalHistory/);
    const heir: typeof real = Object.create(real);
    expect(() =>
      buildStatisticalLayer({ history: heir, windowPeriods: WINDOW, horizon: HORIZON })
    ).toThrow(/loadStatisticalHistory/);
  });

  it('carries the marker`s provenance out with the answer', () => {
    const result = buildStatisticalLayer({
      history: gated([row({ period: '2026-07', amount: 300 })]),
      windowPeriods: WINDOW,
      horizon: HORIZON,
    });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.markerCompletedAt).toBe(MARKER.completedAt);
    expect(result.markerSourceCommit).toBe(MARKER.sourceCommit);
  });
});

describe('buildStatisticalLayer — the ceiling, checked before any arithmetic', () => {
  it(`degrades explicitly above ${HISTORY_ROW_CEILING} rows and computes NOTHING`, () => {
    const rows = Array.from({ length: HISTORY_ROW_CEILING + 1 }, (_, i) =>
      row({ id: `r${i}`, period: '2026-07', amount: 100 })
    );
    const result = buildStatisticalLayer({
      history: gated(rows),
      windowPeriods: WINDOW,
      horizon: HORIZON,
    });
    expect(result.status).toBe('refused-too-many-rows');
    expect(result.lineItems).toEqual([]);
    expect(result.rowsRead).toBe(HISTORY_ROW_CEILING + 1);
    // !! AND THE ROWS WERE ALL READ. `limit()` would have returned 2000 of them and averaged
    // happily — the truncated average this ruling exists to prevent.
    expect(result.reasonHe).toContain(String(HISTORY_ROW_CEILING + 1));
  });

  it('computes normally at exactly the ceiling', () => {
    const rows = Array.from({ length: HISTORY_ROW_CEILING }, (_, i) =>
      row({ id: `r${i}`, period: WINDOW[i % WINDOW.length], amount: 100 })
    );
    const result = buildStatisticalLayer({ history: gated(rows), windowPeriods: WINDOW, horizon: HORIZON });
    expect(result.status).toBe('ready');
  });
});

describe('buildStatisticalLayer — the projection', () => {
  const rows: StatisticalHistoryRow[] = [
    ...WINDOW.map((period, i) => row({ id: `g${i}`, period, category: 'מזון וצריכה', amount: 1000 + i * 100 })),
    row({ id: 'l0', period: '2026-06', category: 'פנאי ונסיעות', amount: 200 }),
    row({ id: 'l1', period: '2026-07', category: 'פנאי ונסיעות', amount: 300 }),
    row({ id: 'z0', period: '2026-07', category: 'דיור וחשבונות', amount: 0 }),
  ];

  it('emits one line item per estimated category per horizon month, and none for a gap', () => {
    const result = buildStatisticalLayer({ history: gated(rows), windowPeriods: WINDOW, horizon: HORIZON });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.lineItems).toHaveLength(HORIZON.length * 2);
    expect([...new Set(result.lineItems.map((i) => i.categoryId))].sort()).toEqual([
      'מזון וצריכה',
      'פנאי ונסיעות',
    ]);
    // the ₪0 category is present as a CATEGORY and absent as a LINE ITEM
    expect(result.categories.map((c) => c.categoryId)).toContain('דיור וחשבונות');
  });

  it('every emitted item is `statistical`, expense, positive, and carries its band basis', () => {
    const result = buildStatisticalLayer({ history: gated(rows), windowPeriods: WINDOW, horizon: HORIZON });
    if (result.status !== 'ready') throw new Error('expected ready');
    for (const item of result.lineItems) {
      expect(item.direction).toBe('expense');
      expect(item.amountILS).toBeGreaterThan(0);
      expect(item.basis.kind).toBe('movingAverage');
      expect(bandBasisOf(item.basis)).not.toBeNull();
    }
  });

  it('!! the band is IDENTICAL in every projected month — D41`s reason for the chip', () => {
    // v1 required "month 3 strictly more estimated than month 1". It is false of this data: the
    // band is the same history in every projected month, and only a synthetic fixture satisfies it.
    const result = buildStatisticalLayer({ history: gated(rows), windowPeriods: WINDOW, horizon: HORIZON });
    if (result.status !== 'ready') throw new Error('expected ready');
    const groceries = result.lineItems.filter((i) => i.categoryId === 'מזון וצריכה');
    const bands = groceries.map((i) => JSON.stringify(i.basis.kind === 'movingAverage' ? i.basis.band : null));
    expect(new Set(bands).size).toBe(1);
  });

  it('!! the layer`s weakest n is the ₪0 category`s 1, not the mean of 6 and 2 and 1', () => {
    const result = buildStatisticalLayer({ history: gated(rows), windowPeriods: WINDOW, horizon: HORIZON });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.weakestMonthsObserved).toBe(1);
  });

  it('reports rowsRead and rowsCounted separately — the exclusions are visible, not silent', () => {
    const withExcluded = [
      ...rows,
      row({ id: 'rec', period: '2026-07', recurringId: 'demo-rec-clinic-a', amount: 220 }),
      row({ id: 'refund', period: '2026-07', isCredit: true, paymentType: 'refund', amount: 137.9 }),
      row({ id: 'unk', period: 'unknown', amount: 88.5 }),
    ];
    const result = buildStatisticalLayer({
      history: gated(withExcluded),
      windowPeriods: WINDOW,
      horizon: HORIZON,
    });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.rowsRead).toBe(withExcluded.length);
    expect(result.rowsCounted).toBe(rows.length);
  });

  it('!! F5 — the CATEGORY ORDER is sorted, not the order Firestore happened to return', () => {
    // A T5-review survivor: deleting `categoryIds.sort()` in `buildStatisticalLayer` passed every
    // test, and `result.categories` is the array T7b renders. Without the sort the rendered order
    // is FIRST-APPEARANCE order in the query result — which is Firestore document order, which
    // nothing on the read path pins (`listTransactionHistory` issues no `orderBy`). The list would
    // reshuffle between reads with no diff and no failing test.
    //
    // The rows below are deliberately fed in an order that is NOT the sorted one, so a missing
    // sort is a DIFFERENT array rather than the same one arrived at by luck.
    const outOfOrder: StatisticalHistoryRow[] = [
      row({ id: 'x0', period: '2026-06', category: 'תחבורה', amount: 400 }),
      row({ id: 'x1', period: '2026-06', category: 'מזון וצריכה', amount: 900 }),
      row({ id: 'x2', period: '2026-07', category: 'דיור וחשבונות', amount: 2500 }),
    ];
    const firstAppearance = ['תחבורה', 'מזון וצריכה', 'דיור וחשבונות'];
    const sorted = [...firstAppearance].sort();
    expect(sorted).not.toEqual(firstAppearance); // the fixture can tell the two apart

    const result = buildStatisticalLayer({
      history: gated(outOfOrder),
      windowPeriods: WINDOW,
      horizon: HORIZON,
    });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.categories.map((c) => c.categoryId)).toEqual(sorted);
  });

  it('!! F5 — and the same corpus SHUFFLED produces the identical category order', () => {
    // The property stated directly: the output order is a function of the categories, not of the
    // input order. `resolveLayerPrecedence` already holds this for line items; nothing held it for
    // the category array until now.
    const base: StatisticalHistoryRow[] = [
      row({ id: 'y0', period: '2026-06', category: 'תחבורה', amount: 400 }),
      row({ id: 'y1', period: '2026-06', category: 'מזון וצריכה', amount: 900 }),
      row({ id: 'y2', period: '2026-07', category: 'דיור וחשבונות', amount: 2500 }),
      row({ id: 'y3', period: '2026-07', category: 'פנאי ונסיעות', amount: 150 }),
    ];
    const orderOf = (rowsIn: StatisticalHistoryRow[]): string[] => {
      const result = buildStatisticalLayer({ history: gated(rowsIn), windowPeriods: WINDOW, horizon: HORIZON });
      if (result.status !== 'ready') throw new Error('expected ready');
      return result.categories.map((c) => c.categoryId);
    };
    expect(orderOf([...base].reverse())).toEqual(orderOf(base));
    expect(orderOf([base[2], base[0], base[3], base[1]])).toEqual(orderOf(base));
  });

  it('an EMPTY corpus with a good marker is ready with nothing in it — never a refusal', () => {
    const result = buildStatisticalLayer({ history: gated([]), windowPeriods: WINDOW, horizon: HORIZON });
    expect(result.status).toBe('ready');
    expect(result.categories).toEqual([]);
    expect(result.lineItems).toEqual([]);
    expect(result.weakestMonthsObserved).toBe(0);
    // and that is D26 row 0's input: no chip, no ₪0, an onboarding path.
    expect(monthConfidenceOf(result.weakestMonthsObserved, 0)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A9 — the empty certain layer
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! certainLayerSummaryHe — §12`s SECOND no-₪0 branch', () => {
  const certainItem: ForecastLineItem = {
    period: '2026-09',
    categoryId: 'החזרי הלוואות',
    direction: 'expense',
    amountILS: 4200,
    basis: { kind: 'loan', loanId: 'l1', name: 'משכנתא' },
  };
  const statisticalItem: ForecastLineItem = {
    period: '2026-09',
    categoryId: 'מזון וצריכה',
    direction: 'expense',
    amountILS: 1200,
    basis: {
      kind: 'movingAverage',
      monthsObserved: 6,
      periods: WINDOW,
      seasonalFactor: null,
      band: { lowILS: 1000, midILS: 1200, highILS: 1400 },
      bandBasis: 'observed-range',
    },
  };

  it('says the committed part is UNKNOWN, and says it with no money symbol', () => {
    expect(certainLayerSummaryHe([])).toBe(CERTAIN_LAYER_EMPTY_HE);
    expect(CERTAIN_LAYER_EMPTY_HE).not.toMatch(/₪/);
  });

  it('!! fires on a month holding ONLY statistical items — certainILS 0 with nothing to itemise', () => {
    // A9's branch. `certainILS: 0` is a real total; the ITEMISED list D23 promises is empty, and
    // "₪0" there would be a claim about contracts rather than about our data.
    expect(certainLayerSummaryHe([statisticalItem])).toBe(CERTAIN_LAYER_EMPTY_HE);
  });

  it('is silent when there is something to itemise', () => {
    expect(certainLayerSummaryHe([certainItem, statisticalItem])).toBe('');
  });
});
