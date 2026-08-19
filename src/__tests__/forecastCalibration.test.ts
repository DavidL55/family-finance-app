// src/__tests__/forecastCalibration.test.ts — Stage 7 T6, D28.
import { describe, expect, it } from 'vitest';
import { calibrationSnapshotOf, shouldWriteCalibration } from '../utils/forecastCalibration';
import type { ForecastLineItem } from '../utils/forecast';

const certain = (over: Partial<ForecastLineItem> = {}): ForecastLineItem => ({
  period: '2026-09',
  categoryId: 'דיור',
  direction: 'expense',
  amountILS: 6000,
  basis: { kind: 'recurring', recurringId: 'rec-rent', description: 'שכר דירה', chargeDay: 1 },
  ...over,
});

const statistical = (over: Partial<ForecastLineItem> = {}): ForecastLineItem => ({
  period: '2026-09',
  categoryId: 'מזון וצריכה',
  direction: 'expense',
  amountILS: 2400,
  basis: {
    kind: 'movingAverage',
    monthsObserved: 4,
    periods: ['2026-05', '2026-06', '2026-07', '2026-08'],
    seasonalFactor: null,
    band: null,
    bandBasis: 'observed-range',
  },
  ...over,
});

describe('calibrationSnapshotOf stores the ANCHOR month, per category AND per layer', () => {
  it('keeps only the anchor month — the horizon months are not what calibration compares', () => {
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain(), statistical(), certain({ period: '2026-10', amountILS: 6000 })],
      horizonMonths: 3,
      computedAt: '2026-09-02T06:00:00.000Z',
    });
    expect(snapshot.period).toBe('2026-09');
    expect(snapshot.expenseILS).toBe(8400);
    expect(snapshot.categories).toHaveLength(2);
  });

  it('splits one category across its layers, because that is the only diagnostic it carries', () => {
    // A certain-layer miss is a wrong contract; a statistical miss is an average that did not hold.
    // Collapsing them into one figure per category throws away the reason the snapshot exists.
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain({ categoryId: 'בריאות', amountILS: 300 }), statistical({ categoryId: 'בריאות', amountILS: 200 })],
      horizonMonths: 3,
      computedAt: '2026-09-02T06:00:00.000Z',
    });
    expect(snapshot.categories).toEqual([
      { categoryId: 'בריאות', layer: 'certain', amountILS: 300 },
      { categoryId: 'בריאות', layer: 'statistical', amountILS: 200 },
    ]);
  });

  it('does NOT net income against expense inside one category', () => {
    // T1 found this exact shape in D19's own bucket key. Same fix (`direction` in the key), same
    // reason: a ₪9,000 salary and a ₪500 spend in one category must not become a ₪8,500 anything.
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [
        certain({ categoryId: 'הכנסות והשקעות', direction: 'income', amountILS: 9000 }),
        certain({ categoryId: 'הכנסות והשקעות', direction: 'expense', amountILS: 500 }),
      ],
      horizonMonths: 3,
      computedAt: '2026-09-02T06:00:00.000Z',
    });
    expect(snapshot.incomeILS).toBe(9000);
    expect(snapshot.expenseILS).toBe(500);
    expect(snapshot.categories).toHaveLength(2);
  });

  it('stores computedAt and horizonMonths — a 10-day-old projection means something different', () => {
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain()],
      horizonMonths: 6,
      computedAt: '2026-09-20T18:30:00.000Z',
    });
    expect(snapshot.computedAt).toBe('2026-09-20T18:30:00.000Z');
    expect(snapshot.horizonMonths).toBe(6);
  });

  it('is order-stable — two computations of one month are byte-comparable', () => {
    const items = [statistical(), certain(), statistical({ categoryId: 'פנאי ובילוי', amountILS: 100 })];
    const a = calibrationSnapshotOf({ anchorPeriod: '2026-09', lineItems: items, horizonMonths: 3, computedAt: 'x' });
    const b = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [...items].reverse(),
      horizonMonths: 3,
      computedAt: 'x',
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is an EMPTY snapshot rather than a wrong one when the anchor has no line items', () => {
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain({ period: '2026-10' })],
      horizonMonths: 3,
      computedAt: 'x',
    });
    expect(snapshot.categories).toEqual([]);
    expect(snapshot.expenseILS).toBe(0);
  });

  it('REFUSES a malformed anchor — it becomes a document id', () => {
    for (const anchor of ['', 'unknown', '2026-9', '2026-13', '0-NaN']) {
      expect(() =>
        calibrationSnapshotOf({ anchorPeriod: anchor, lineItems: [], horizonMonths: 3, computedAt: 'x' })
      ).toThrow(/anchorPeriod/);
    }
  });
});

describe('shouldWriteCalibration — create-only, and never a back-filled month', () => {
  it('writes the very first snapshot', () => {
    expect(shouldWriteCalibration('2026-09', [])).toBe(true);
  });

  it('does NOT rewrite the month it already has — a late projection is not an early one', () => {
    expect(shouldWriteCalibration('2026-09', ['2026-09'])).toBe(false);
  });

  it('writes the NEXT month', () => {
    expect(shouldWriteCalibration('2026-10', ['2026-08', '2026-09'])).toBe(true);
  });

  it('does NOT back-fill an older month — that document would be indistinguishable from a real one', () => {
    // The second condition, tested on its own: no document exists for 2026-07, so the "already
    // stored" check passes and only the ordering check can refuse. If that half were missing this
    // would return true and Stage 8 would read a mid-October projection as September's opening one.
    expect(shouldWriteCalibration('2026-07', ['2026-09'])).toBe(false);
  });

  it('ignores malformed ids already in the collection rather than comparing against them', () => {
    // `comparePeriod` is TOTAL, so `'unknown'` sorts after every real period ("u" > "2") and a
    // single junk document would refuse every future write forever.
    expect(shouldWriteCalibration('2026-10', ['unknown', '2026-09'])).toBe(true);
  });

  it('!! the two conditions are pinned in the relationship they actually stand in (survivor M45)', () => {
    // Dropping the "already stored" check SURVIVED, and the reason is arithmetic: an anchor that is
    // already stored cannot be LATER than the newest stored month, so the ordering comparison
    // refuses it anyway. The check stays because it states the rule — create-only, idempotent by
    // doc id — and the subsumption is asserted here so the day the ordering rule changes, THIS
    // fails rather than the kept line silently becoming load-bearing and untested.
    for (const known of [['2026-09'], ['2026-08', '2026-09'], ['2026-09', '2026-07']]) {
      for (const anchor of known) {
        expect(shouldWriteCalibration(anchor, known)).toBe(false);
        // the subsumption itself: a stored anchor is never later than the newest stored month
        const newest = [...known].sort().at(-1) as string;
        expect(anchor <= newest).toBe(true);
      }
    }
  });

  it('REFUSES a malformed anchor rather than deciding for it', () => {
    for (const anchor of ['', 'unknown', '2026-9']) {
      expect(() => shouldWriteCalibration(anchor, [])).toThrow(/anchorPeriod/);
    }
  });
});
