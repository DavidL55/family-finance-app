// src/__tests__/forecastCalibration.test.ts — Stage 7 T6, D28.
import { describe, expect, it } from 'vitest';
import {
  calibrationSnapshotOf,
  calibrationWriteDecision,
  shouldWriteCalibration,
  snapshotHasProjection,
} from '../utils/forecastCalibration';
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

  it('!! builds an EMPTY snapshot when the anchor has no line items — and it is NOT stored', () => {
    // T6 pinned the empty snapshot as CORRECT. The decision-level pass reversed that: on the
    // measured day-one corpus the very first snapshot this app would ever write is
    // `{expenseILS: 0, incomeILS: 0, categories: []}`, and Stage 8 reads it as 100% error for the
    // family's first month. `calibrationSnapshotOf` is pure and still BUILDS it — the decision about
    // whether it is worth storing belongs to the write path, not to the arithmetic.
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain({ period: '2026-10' })],
      horizonMonths: 3,
      computedAt: 'x',
    });
    expect(snapshot.categories).toEqual([]);
    expect(snapshot.expenseILS).toBe(0);
    expect(snapshotHasProjection(snapshot)).toBe(false);
  });

  it('!! a ₪0 line item IS a projection — the emptiness test is about ROWS, not about totals', () => {
    // The over-approximation that would make this guard wrong in the expensive direction: "we
    // projected ₪0 for groceries" is a real projection and one Stage 8 can be measurably wrong
    // about. Both totals here are 0 and the snapshot is still worth storing, which is exactly why
    // the condition is `categories.length` and not a conjunction over the totals.
    const snapshot = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain({ period: '2026-09', amountILS: 0 })],
      horizonMonths: 3,
      computedAt: 'x',
    });
    expect(snapshot.expenseILS).toBe(0);
    expect(snapshot.incomeILS).toBe(0);
    expect(snapshot.categories).toHaveLength(1);
    expect(snapshotHasProjection(snapshot)).toBe(true);
  });

  it('!! and the equivalence the single condition rests on: one entry per line item, always', () => {
    // `categories.length === 0` iff no line item fell in the anchor month. Asserted, because the
    // decision not to write a conjunction depends on it — if that equivalence ever stopped holding,
    // the emptiness test would start meaning something narrower with no symptom.
    const none = calibrationSnapshotOf({ anchorPeriod: '2026-09', lineItems: [], horizonMonths: 3, computedAt: 'x' });
    expect(snapshotHasProjection(none)).toBe(false);
    const some = calibrationSnapshotOf({
      anchorPeriod: '2026-09',
      lineItems: [certain({ period: '2026-09' }), certain({ period: '2026-10' })],
      horizonMonths: 3,
      computedAt: 'x',
    });
    expect(some.categories.length).toBeGreaterThan(0);
    expect(snapshotHasProjection(some)).toBe(true);
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// !! calibrationWriteDecision — the whole write path's judgement, with no Firestore in it
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! calibrationWriteDecision — the decision-level pass, T6 review', () => {
  const base = { horizonMonths: 3, computedAt: '2026-09-03T06:00:00.000Z' };

  it('writes a real projection for a month nothing is stored for', () => {
    const decision = calibrationWriteDecision({
      ...base,
      anchorPeriod: '2026-09',
      existingPeriods: [],
      lineItems: [certain({ period: '2026-09' })],
    });
    if (decision.status !== 'write') throw new Error(`expected write, got ${decision.status}`);
    expect(decision.snapshot.period).toBe('2026-09');
    expect(decision.snapshot.categories.length).toBeGreaterThan(0);
  });

  it('!! REFUSES an empty projection — the family`s first month is not 100% error', () => {
    // The measured day-one state: three rows in one month, so the anchor month has no line items at
    // all on the first computation. T6 stored `{expenseILS: 0, incomeILS: 0, categories: []}` there
    // and D28's create-only rule would have made it PERMANENT.
    const decision = calibrationWriteDecision({
      ...base,
      anchorPeriod: '2026-09',
      existingPeriods: [],
      lineItems: [certain({ period: '2026-10' })],
    });
    expect(decision).toEqual({ status: 'nothing-projected' });
  });

  it('!! and it SELF-HEALS — the next computation of the same month stores the real one', () => {
    // This is the property that makes refusing better than storing a discriminant: the month is not
    // burned. Nothing was written, so the create-only rule has nothing to protect, and the first
    // projection that actually projects something becomes the stored one.
    const later = calibrationWriteDecision({
      ...base,
      anchorPeriod: '2026-09',
      existingPeriods: [],
      lineItems: [certain({ period: '2026-09' })],
    });
    expect(later.status).toBe('write');
  });

  it('!! RETURNS a malformed anchor instead of throwing — it sits on the forecast render path', () => {
    // `shouldWriteCalibration` and `calibrationSnapshotOf` still throw, and are still tested by
    // `toThrow` above: they are the loud refusal for a direct caller. This boundary is what stops a
    // bad anchor from taking down the screen the family actually came for.
    for (const anchor of ['', 'unknown', '2026-9', '2026-13', '0-NaN']) {
      const decision = calibrationWriteDecision({
        ...base,
        anchorPeriod: anchor,
        existingPeriods: [],
        lineItems: [certain({ period: '2026-09' })],
      });
      expect(decision.status, anchor).toBe('refused-malformed-anchor');
      if (decision.status !== 'refused-malformed-anchor') throw new Error('unreachable');
      expect(decision.reason).toContain('YYYY-MM');
    }
  });

  it('the create-only rule still owns its own answer, ahead of the emptiness one', () => {
    // Branch order matters: an already-recorded month must report ITSELF, not "nothing projected",
    // or an operator reading the result learns the wrong thing about why no write happened.
    const decision = calibrationWriteDecision({
      ...base,
      anchorPeriod: '2026-09',
      existingPeriods: ['2026-09'],
      lineItems: [],
    });
    expect(decision).toEqual({ status: 'already-recorded' });
  });

  it('a back-filled anchor is still refused as already-recorded, not written empty', () => {
    const decision = calibrationWriteDecision({
      ...base,
      anchorPeriod: '2026-08',
      existingPeriods: ['2026-09'],
      lineItems: [certain({ period: '2026-08' })],
    });
    expect(decision).toEqual({ status: 'already-recorded' });
  });
});
