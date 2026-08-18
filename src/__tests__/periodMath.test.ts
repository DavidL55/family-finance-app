// Stage 7 T1 — src/utils/periodMath.ts.
//
// Two different things live in this file and they are held to different standards.
//
// MOVED, VERBATIM (D22): `nextPeriod`, `comparePeriod`, `periodsBetween`, `clampDayToMonth` were
// module-private in `recurringCatchup.ts` (only `clampDayToMonth` was exported). Moving them is a
// MOVE, not a rewrite — `recurringCatchup.test.ts` stays green across it, and the cases below are
// the first direct coverage the three previously-private ones have ever had.
//
// WRITTEN, NOT MOVED (D22 / plan finding 1.4.1): `periodOf`. The function it replaces is
// `periodOfDateString`, which was `dateStr.slice(0, 7)` and had NO FAILURE MODE AT ALL. On the
// legacy `DD/MM/YYYY` form the ledger actually holds, `"9/3/2026".slice(0,7)` is `"9/3/202"` — not
// a failure, a SILENTLY WRONG PERIOD. A `where('period','in',[…])` query drops that row, and
// neither the backfill's completion marker nor `unusableRowCount` can see it: the marker only says
// the backfill finished, and `unusableRowCount` counts `'unknown'`, which was never written.
//
// THE NEGATIVE CASES ARE THE TEST. The positive one alone passes for BOTH implementations, which
// is exactly how a slice would survive a review. Of the five cases D22 names, the slice returns a
// wrong string for three — `"9/3/202"`, `"9999-99"` and `"2026/03"` — and the middle one is a
// *plausible-looking* `YYYY-MM` that would sail through a spot check.
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_PERIOD,
  clampDayToMonth,
  comparePeriod,
  daysBetweenDates,
  nextPeriod,
  periodOf,
  periodOfMonthYear,
  periodOrUnknown,
  periodOrUnknownFromMonthYear,
  periodsBetween,
} from '../utils/periodMath';

describe('periodOf — the failure mode is the point (D22, finding 1.4.1)', () => {
  it('reads the legacy unpadded DD/MM/YYYY form correctly — the slice version returns "9/3/202"', () => {
    expect(periodOf('9/3/2026')).toBe('2026-03');
  });

  it('reads the ISO YYYY-MM-DD form correctly', () => {
    expect(periodOf('2026-03-15')).toBe('2026-03');
  });

  it('does not confuse a two-digit DAY for the month in the legacy form', () => {
    // parseTransactionDate's own documented hazard: "25/03/2026" must be March, not month 25.
    expect(periodOf('25/03/2026')).toBe('2026-03');
  });

  it('returns null for an out-of-range month — the slice version returns "9999-99"', () => {
    // T0 probe B: a matrix-governed 'member' — the least-privileged role in the app — can write
    // this today, because firestore.rules' `date.size() == 10` is a LENGTH check, not a format
    // check. This is a live path, not a defensive one.
    expect(periodOf('9999-99-99')).toBeNull();
  });

  it('returns null for a slash-separated ISO-looking date — the slice version returns "2026/03"', () => {
    // T0 probe A: a parent can create this today. Ten characters, and the plausible-looking
    // "2026/03" the slice yields is NOT a period any query will match.
    expect(periodOf('2026/03/15')).toBeNull();
  });

  it('returns null for the empty string, undefined and null', () => {
    expect(periodOf('')).toBeNull();
    expect(periodOf(undefined)).toBeNull();
    expect(periodOf(null)).toBeNull();
  });

  it('returns null for a month of 00 and for a 13th month', () => {
    expect(periodOf('2026-00-15')).toBeNull();
    expect(periodOf('2026-13-15')).toBeNull();
    expect(periodOf('15/13/2026')).toBeNull();
  });

  it('zero-pads a single-digit month from the legacy form so the result is a sortable period', () => {
    // The whole point of a 'YYYY-MM' period is that string comparison IS chronological order.
    // "2026-3" would sort after "2026-12".
    expect(periodOf('9/3/2026')).toBe('2026-03');
    expect(comparePeriod(periodOf('9/3/2026'), periodOf('1/12/2026'))).toBeLessThan(0);
  });
});

describe('periodOrUnknown — the ONE place \'unknown\' is chosen (D21c)', () => {
  it('returns the period for both formats the ledger holds', () => {
    expect(periodOrUnknown('2026-03-15')).toBe('2026-03');
    expect(periodOrUnknown('9/3/2026')).toBe('2026-03');
  });

  it('returns UNKNOWN_PERIOD for an unparseable string', () => {
    expect(periodOrUnknown('2026/03/15')).toBe(UNKNOWN_PERIOD);
  });

  it('returns UNKNOWN_PERIOD for an out-of-range month', () => {
    expect(periodOrUnknown('9999-99-99')).toBe(UNKNOWN_PERIOD);
  });

  it('returns UNKNOWN_PERIOD for a missing date', () => {
    expect(periodOrUnknown(undefined)).toBe(UNKNOWN_PERIOD);
    expect(periodOrUnknown('')).toBe(UNKNOWN_PERIOD);
  });

  it("UNKNOWN_PERIOD is the literal 'unknown' — it is a queried `in` value, so it is a wire format", () => {
    // D21(b): the history query sends 6 periods + this value. Changing the string changes a
    // Firestore query's contents and silently orphans every row already stamped with the old one.
    expect(UNKNOWN_PERIOD).toBe('unknown');
  });

  it('never returns a value that looks like a period for input that could not be read', () => {
    for (const bad of ['2026/03/15', '9999-99-99', 'not a date', '', undefined, null]) {
      expect(periodOrUnknown(bad)).toBe(UNKNOWN_PERIOD);
    }
  });
});

describe('comparePeriod (moved from recurringCatchup — first direct coverage)', () => {
  it('orders chronologically', () => {
    expect(comparePeriod('2026-03', '2026-04')).toBe(-1);
    expect(comparePeriod('2026-04', '2026-03')).toBe(1);
    expect(comparePeriod('2026-03', '2026-03')).toBe(0);
  });

  it('orders across a year boundary', () => {
    expect(comparePeriod('2025-12', '2026-01')).toBe(-1);
  });
});

describe('nextPeriod (moved from recurringCatchup — first direct coverage)', () => {
  it('advances within a year, zero-padded', () => {
    expect(nextPeriod('2026-03')).toBe('2026-04');
    expect(nextPeriod('2026-09')).toBe('2026-10');
  });

  it('rolls December over into the next January', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
  });
});

describe('periodsBetween (moved from recurringCatchup — first direct coverage)', () => {
  it('is inclusive of both bounds', () => {
    expect(periodsBetween('2026-03', '2026-06')).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
  });

  it('returns a single period when the bounds are equal', () => {
    expect(periodsBetween('2026-03', '2026-03')).toEqual(['2026-03']);
  });

  it('returns [] when `from` is after `to`', () => {
    expect(periodsBetween('2026-06', '2026-03')).toEqual([]);
  });

  it('crosses a year boundary', () => {
    expect(periodsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('clampDayToMonth (moved from recurringCatchup — bank standing-order semantics)', () => {
  // Its behaviour is already pinned in recurringCatchup.test.ts; these assert the MOVE preserved
  // it, i.e. that the same function is reachable from its new home with the same answers.
  it('clamps to the month\'s real last day, leap years included', () => {
    expect(clampDayToMonth(2026, 8, 15)).toBe(15);
    expect(clampDayToMonth(2026, 4, 31)).toBe(30);
    expect(clampDayToMonth(2026, 2, 31)).toBe(28);
    expect(clampDayToMonth(2024, 2, 31)).toBe(29);
    expect(clampDayToMonth(1900, 2, 29)).toBe(28);
    expect(clampDayToMonth(2000, 2, 29)).toBe(29);
  });
});

describe('daysBetweenDates — integer civil-day arithmetic, no Date object (D16 staleness)', () => {
  // D37 bans `new Date()` from forecast.ts's closure, and recurringCatchup.ts's own header bans
  // `new Date(dateString)` for the TZ reason. D16's staleness bands are stated in DAYS, so the
  // gap has to be computed somehow — this is it: pure integer arithmetic over the civil calendar,
  // which can never observe a timezone or a DST skip.
  it('counts zero for the same day', () => {
    expect(daysBetweenDates('2026-08-18', '2026-08-18')).toBe(0);
  });

  it('counts forward across a month boundary', () => {
    expect(daysBetweenDates('2026-03-15', '2026-04-15')).toBe(31);
  });

  it('counts across a leap day', () => {
    expect(daysBetweenDates('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('counts across a NON-leap February', () => {
    expect(daysBetweenDates('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('counts across a year boundary', () => {
    expect(daysBetweenDates('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('is negative when `to` precedes `from`', () => {
    expect(daysBetweenDates('2026-08-18', '2026-08-10')).toBe(-8);
  });

  it('ignores a time component on either side rather than failing', () => {
    // Account.balanceUpdatedAt is written with toISOString(), so it carries 'T…Z'.
    expect(daysBetweenDates('2026-03-15T22:31:04.000Z', '2026-04-15')).toBe(31);
  });

  it('returns null — never 0 — when either side cannot be read', () => {
    // A failed read is an error state, never an empty one. Returning 0 here would render a
    // three-month-stale balance as `'current'`.
    expect(daysBetweenDates('9/3/2026', '2026-04-15')).toBeNull();
    expect(daysBetweenDates('2026-03-15', 'nonsense')).toBeNull();
    expect(daysBetweenDates('', '2026-04-15')).toBeNull();
    expect(daysBetweenDates(undefined, '2026-04-15')).toBeNull();
    expect(daysBetweenDates('2026-02-30', '2026-04-15')).toBeNull();
    expect(daysBetweenDates('2026-13-01', '2026-04-15')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F9 / F1 — THESE READERS TAKE UNTRUSTED FIRESTORE DATA, SO THEY MUST BE TOTAL
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Both entry points are handed raw document fields. `transaction_lines.date` and
// `incomes.month`/`year` have no schema that guarantees a type: Rules validate `date` only on the
// matrix-governed branch (a parent's update bypasses it entirely, proven live in T0), and
// `incomes` has no validator beyond `amount is number`.
//
// F9 exactly: `periodOfMonthYear` accepted an ARRAY `month: [3]` as `'2026-03'`, because
// `String([3])` is `'3'` and the regex then passed — while the header's own rationale for using a
// regex rather than a numeric coercion is that it REFUSES the shapes a coercion quietly accepts.
// `Array.prototype.toString` is one of those shapes, and it was the one that got through.
describe('periodOf/periodOfMonthYear refuse a value that is not a string (F1, F9)', () => {
  it('periodOf returns null rather than throwing on a non-string date', () => {
    for (const bad of [12345, true, false, { seconds: 1 }, ['2026-03-01'], { toDate: () => new Date() }]) {
      expect(() => periodOf(bad as never), String(bad)).not.toThrow();
      expect(periodOf(bad as never), String(bad)).toBeNull();
    }
    expect(periodOrUnknown(12345 as never)).toBe(UNKNOWN_PERIOD);
  });

  it('!! periodOfMonthYear refuses an ARRAY month — String([3]) is "3" and the regex passed it', () => {
    expect(periodOfMonthYear([3], '2026')).toBeNull();
    expect(periodOfMonthYear('3', [2026])).toBeNull();
    expect(periodOfMonthYear([3], [2026])).toBeNull();
    expect(periodOrUnknownFromMonthYear([3], '2026')).toBe(UNKNOWN_PERIOD);
  });

  it('refuses every other non-(string|number) shape, and never throws', () => {
    for (const bad of [true, false, {}, { valueOf: () => 3 }, () => 3]) {
      expect(() => periodOfMonthYear(bad, '2026'), String(bad)).not.toThrow();
      expect(periodOfMonthYear(bad, '2026'), String(bad)).toBeNull();
      expect(periodOfMonthYear('3', bad), String(bad)).toBeNull();
    }
  });

  it('still accepts the two shapes the collection really holds — numbers and strings', () => {
    expect(periodOfMonthYear(3, 2026)).toBe('2026-03');
    expect(periodOfMonthYear('3', '2026')).toBe('2026-03');
    expect(periodOfMonthYear(' 11 ', ' 2026 ')).toBe('2026-11');
  });
});
