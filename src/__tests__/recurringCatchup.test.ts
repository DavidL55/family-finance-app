// src/__tests__/recurringCatchup.test.ts
import { describe, expect, it } from 'vitest';
import { clampDayToMonth, computeDuePeriods } from '../utils/recurringCatchup';

const base = { status: 'active' as const, chargeDay: 10, startDate: '2026-06-01' };

describe('computeDuePeriods', () => {
  it('returns [] for a paused item', () => {
    expect(computeDuePeriods({ ...base, status: 'paused' }, new Date(2026, 7, 15))).toEqual([]);
  });

  it('returns [] for an ended item', () => {
    expect(computeDuePeriods({ ...base, status: 'ended' }, new Date(2026, 7, 15))).toEqual([]);
  });

  it('a brand-new item whose chargeDay has NOT yet been reached this month is not due', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-08-01', chargeDay: 20 }, new Date(2026, 7, 15))).toEqual([]);
  });

  it('a brand-new item whose chargeDay HAS been reached this month is due for the current period only', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-08-01', chargeDay: 10 }, new Date(2026, 7, 15))).toEqual(['2026-08']);
  });

  it('catches up multiple fully-elapsed months plus the current one, when chargeDay has passed', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 10 }, new Date(2026, 7, 15));
    expect(result).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('catches up past months but WITHHOLDS the current month when chargeDay has not passed yet', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 20 }, new Date(2026, 7, 15));
    expect(result).toEqual(['2026-06', '2026-07']);
  });

  it('returns [] when the current period was already posted', () => {
    expect(computeDuePeriods({ ...base, lastPostedPeriod: '2026-08', chargeDay: 1 }, new Date(2026, 7, 15))).toEqual([]);
  });

  it('respects endDate — nothing due after the item has ended', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', endDate: '2026-06-30', chargeDay: 1 }, new Date(2026, 7, 15));
    expect(result).toEqual(['2026-06']);
  });

  it('handles a December -> January year rollover correctly', () => {
    const result = computeDuePeriods({ ...base, startDate: '2025-11-01', lastPostedPeriod: '2025-11', chargeDay: 5 }, new Date(2026, 0, 10));
    expect(result).toEqual(['2025-12', '2026-01']);
  });

  it('returns [] for a malformed range (endDate before startDate)', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-08-01', endDate: '2026-01-01', chargeDay: 1 }, new Date(2026, 7, 15));
    expect(result).toEqual([]);
  });

  // --- Additional edge cases beyond the brief ---

  it('CHANGED (was: "stays not-due"): chargeDay 31 clamps to April\'s last real day (30) — bank standing-order semantics, due on April 30', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-04-01', chargeDay: 31 }, new Date(2026, 3, 30));
    expect(result).toEqual(['2026-04']);
  });

  it('a chargeDay-31 item not yet due mid-April (before the clamped/actual month-end) becomes due once May begins, via the past-period rule', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-04-01', chargeDay: 31 }, new Date(2026, 4, 1));
    expect(result).toEqual(['2026-04']);
  });

  it('CHANGED (was: "never fires within February itself"): chargeDay 31 clamps to February\'s last day (28, non-leap) — due on Feb 28', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 31 }, new Date(2026, 1, 28));
    expect(result).toEqual(['2026-02']);
  });

  it('clamping: chargeDay 31 in February is NOT yet due on Feb 27 (one day short of the clamped-to day 28)', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 31 }, new Date(2026, 1, 27));
    expect(result).toEqual([]);
  });

  it('CHANGED (was: "never fires within February itself... deferred to March"): chargeDay 29 clamps to 28 in a non-leap February — due on Feb 28 itself, not deferred', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 29 }, new Date(2026, 1, 28))).toEqual(['2026-02']);
    // Already posted for Feb via the clamp; nothing further due mid-March before March's own chargeDay (29) is met.
    expect(computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 29 }, new Date(2026, 2, 5))).toEqual(['2026-02']);
  });

  it('chargeDay 29 in February of a leap year posts exactly on the 29th, not before (leap Feb has 29 days so nothing is clamped)', () => {
    expect(computeDuePeriods({ ...base, startDate: '2024-02-01', chargeDay: 29 }, new Date(2024, 1, 28))).toEqual([]);
    expect(computeDuePeriods({ ...base, startDate: '2024-02-01', chargeDay: 29 }, new Date(2024, 1, 29))).toEqual(['2024-02']);
  });

  it('chargeDay 30 on April 30 (exact match, no clamping needed since April has 30 days) is due', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-04-01', chargeDay: 30 }, new Date(2026, 3, 30));
    expect(result).toEqual(['2026-04']);
  });

  describe('clampDayToMonth', () => {
    it('leaves the day unchanged when it fits within the month', () => {
      expect(clampDayToMonth(2026, 8, 15)).toBe(15);
    });

    it('clamps day 31 down to 30 for a 30-day month (April)', () => {
      expect(clampDayToMonth(2026, 4, 31)).toBe(30);
    });

    it('clamps day 31 down to 28 for February in a non-leap year', () => {
      expect(clampDayToMonth(2026, 2, 31)).toBe(28);
    });

    it('clamps day 31 down to 29 for February in a leap year', () => {
      expect(clampDayToMonth(2024, 2, 31)).toBe(29);
    });

    it('leaves day 29 unchanged for February in a leap year', () => {
      expect(clampDayToMonth(2024, 2, 29)).toBe(29);
    });

    it('clamps day 29 down to 28 for February in a non-leap year', () => {
      expect(clampDayToMonth(2026, 2, 29)).toBe(28);
    });

    it('treats a year divisible by 100 but not 400 as non-leap (1900)', () => {
      expect(clampDayToMonth(1900, 2, 29)).toBe(28);
    });

    it('treats a year divisible by 400 as leap (2000)', () => {
      expect(clampDayToMonth(2000, 2, 29)).toBe(29);
    });
  });

  it('an item starting mid-month AFTER its chargeDay already passed this month is still due this period (start gates the floor, not chargeDay)', () => {
    // Item starts on the 15th with chargeDay 10 (already "passed" on start date) — first period is still due once reached.
    const result = computeDuePeriods({ ...base, startDate: '2026-08-15', chargeDay: 10 }, new Date(2026, 7, 20));
    expect(result).toEqual(['2026-08']);
  });

  it('an item whose startDate is in the future relative to today produces no due periods', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-09-01', chargeDay: 1 }, new Date(2026, 7, 15));
    expect(result).toEqual([]);
  });

  it('lastPostedPeriod in the future relative to today (clock skew / bad data) yields no negative range, just []', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-12', chargeDay: 1 }, new Date(2026, 7, 15));
    expect(result).toEqual([]);
  });

  it('lastPostedPeriod equal to the current period with chargeDay still unmet yields []', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-08', chargeDay: 25 }, new Date(2026, 7, 15));
    expect(result).toEqual([]);
  });

  it('lastPostedPeriod before startDate (bad data) does not resurrect periods before the item started', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-06-01', lastPostedPeriod: '2025-01', chargeDay: 1 }, new Date(2026, 7, 15));
    expect(result).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('endDate falling exactly in the current period still allows the current period once chargeDay is met', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-08-01', endDate: '2026-08-31', chargeDay: 10 }, new Date(2026, 7, 15));
    expect(result).toEqual(['2026-08']);
  });

  it('endDate in the past relative to today, with nothing ever posted, catches up only through the end period', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-01-01', endDate: '2026-03-15', chargeDay: 1 }, new Date(2026, 7, 15));
    expect(result).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('is idempotent: calling again with lastPostedPeriod advanced to the prior result\'s last period returns []', () => {
    const first = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 10 }, new Date(2026, 7, 15));
    expect(first).toEqual(['2026-06', '2026-07', '2026-08']);
    const second = computeDuePeriods({ ...base, lastPostedPeriod: first[first.length - 1], chargeDay: 10 }, new Date(2026, 7, 15));
    expect(second).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // STAGE 7 T1 (D22) — ADDED WITH THE periodMath MOVE.
  //
  // Until this task, `startDate`/`endDate` were read with `dateStr.slice(0, 7)`, which cannot
  // fail. It does not reject a malformed date — it INVENTS a period from it, and this engine then
  // WRITES A TRANSACTION at that period: `RecurringService` splits the period on '-' to build the
  // posted row's date string, so an invented period like `'1/6/202'` yields a garbage date in the
  // family's ledger.
  //
  // These four cases are the ones that were reachable and silent. `periodOf` (built on
  // `parseTransactionDate`) returns `null` instead, and a `null` period is folded into the
  // malformed-range refusal this function already had.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('malformed dates — the slice version invented periods and posted money at them', () => {
    it('an empty startDate yields [] — the slice version HUNG THE PROCESS here', () => {
      // Measured, not reasoned: this case did not return a wrong answer, it never returned.
      //   ''.slice(0,7)            -> ''
      //   nextPeriod('')           -> '0-NaN'   (Number('') is 0, Number(undefined) is NaN)
      //   nextPeriod('0-NaN')      -> '0-NaN'   — a FIXED POINT
      //   comparePeriod('0-NaN','2026-08') -> -1 — forever inside the range
      // so `periodsBetween` looped without advancing, pushing until the heap died. Running this
      // case against the pre-move implementation killed the vitest worker with a V8 OOM.
      expect(computeDuePeriods({ ...base, startDate: '', chargeDay: 1 }, new Date(2026, 7, 15))).toEqual([]);
    });

    it('a startDate that is not a date at all yields []', () => {
      expect(computeDuePeriods({ ...base, startDate: 'לא תאריך', chargeDay: 1 }, new Date(2026, 7, 15))).toEqual([]);
    });

    it('an unreadable endDate REFUSES rather than silently treating the item as open-ended', () => {
      // Before: `'nonsense'.slice(0,7)` is `'nonsens'`, which sorts AFTER every real period, so the
      // range end quietly fell back to the current period and the item posted as if it never ended.
      // Refusing is the conservative direction for an engine that writes money: an item whose end
      // cannot be read is an item whose charges cannot be bounded.
      const result = computeDuePeriods(
        { ...base, startDate: '2026-06-01', endDate: 'nonsense', chargeDay: 10 },
        new Date(2026, 7, 15)
      );
      expect(result).toEqual([]);
    });

    it('a legacy DD/MM/YYYY startDate now resolves to the right months instead of an invented period', () => {
      // Before: `'1/6/2026'.slice(0,7)` is `'1/6/202'`, which sorts BEFORE every real period — so
      // the walk emitted exactly `['1/6/202']` and the June/July/August charges this item actually
      // owed were never posted at all.
      const result = computeDuePeriods(
        { ...base, startDate: '1/6/2026', chargeDay: 10 },
        new Date(2026, 7, 15)
      );
      expect(result).toEqual(['2026-06', '2026-07', '2026-08']);
    });
  });
});
