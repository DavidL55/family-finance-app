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
  earlierPeriod,
  isPeriod,
  laterPeriod,
  nextPeriod,
  periodOf,
  periodOfMonthYear,
  periodOrUnknown,
  periodOrUnknownFromMonthYear,
  periodsBetween,
  previousPeriod,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T4 REVIEW F-2 — TOTALITY AT THE SOURCE. THE SIXTH INSTANCE IS A DEFECT IN `nextPeriod`.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Six instances of one shape were found and fixed one at a time across T1–T4, each fix failing to
// generalise. Five of the six are the same two lines of arithmetic below reading a string that is
// not a period:
//
//   nextPeriod('')            -> '0-NaN'   — a FIXED POINT. `computeDuePeriods` looped until the
//                                           heap died (T1).
//   previousPeriod('unknown') -> 'NaN-NaN' — the demo generator's `asOfDate` refusal (T4).
//   horizonPeriods('', 3)     -> OOM, exit 134 (T4 review F-2, fifth instance).
//   projectInsuranceForward(active, '', to) -> OOM, exit 134 (sixth instance).
//
// AND THE REASON IT KEPT BEING FOUND ONE AT A TIME: `'NaN-NaN'` TERMINATES BY LEXICOGRAPHIC
// ACCIDENT. `'N' > '2'`, so `comparePeriod('NaN-NaN', '2026-08')` is 1 and the walk stops — half
// the instances hid behind luck rather than behind a guard. The cases below assert the REFUSAL,
// not the accident, so the two halves stop being distinguishable by chance.

/**
 * Every malformed period this stage has actually observed, plus the shapes that produce a
 * plausible-looking wrong answer. Each entry names WHERE it came from — a corpus of invented
 * strings would have missed `'0-NaN'`, which is `nextPeriod`'s own output.
 */
const MALFORMED_PERIODS: Array<{ value: string; from: string }> = [
  { value: '', from: "T1 — an empty `startDate`; `nextPeriod('')` is the fixed point '0-NaN'" },
  { value: 'unknown', from: 'UNKNOWN_PERIOD — a REAL stamped value on real rows (D21c)' },
  { value: '0-NaN', from: "nextPeriod('')'s own output — the fixed point itself" },
  { value: 'NaN-NaN', from: "previousPeriod('unknown')'s output — terminates by accident only" },
  { value: '1/6/202', from: 'the deleted slice `periodOfDateString` on a legacy date' },
  { value: 'nonsens', from: 'the deleted slice on an unreadable `endDate`' },
  { value: '9999-99', from: 'the deleted slice on "9999-99-99" — a PLAUSIBLE-LOOKING YYYY-MM' },
  { value: '2026-00', from: 'month 0 — arithmetic would step it to 2026-01 and look right' },
  { value: '2026-13', from: 'month 13 — steps to 2026-14, which sorts after every real period' },
  { value: '2026-1', from: 'unpadded month — breaks the ONE property a period string has' },
  { value: '2026', from: 'a bare year; `split("-")[1]` is undefined and `Number(undefined)` is NaN' },
  { value: '2026-', from: 'a trailing separator' },
  { value: '-08', from: 'a missing year' },
  { value: '2026-08-01', from: 'a DATE, not a period — the old arithmetic silently dropped the day' },
  { value: ' 2026-08', from: 'leading whitespace — string comparison is not whitespace-tolerant' },
  { value: '2026-08 ', from: 'trailing whitespace' },
  { value: '02026-08', from: 'a five-digit year' },
];

describe('isPeriod — the one definition of "well-formed" the arithmetic is allowed to use', () => {
  it('accepts a zero-padded YYYY-MM in every month of the year', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(isPeriod(`2026-${String(month).padStart(2, '0')}`), `month ${String(month)}`).toBe(true);
    }
    expect(isPeriod('1999-07')).toBe(true);
    expect(isPeriod('2100-12')).toBe(true);
  });

  it('refuses every malformed period this stage has actually observed', () => {
    for (const { value, from } of MALFORMED_PERIODS) {
      expect(isPeriod(value), `${JSON.stringify(value)} — ${from}`).toBe(false);
    }
  });

  it('is TOTAL on a non-string — the values come off schemaless documents through a non-strict tsconfig', () => {
    expect(isPeriod(undefined)).toBe(false);
    expect(isPeriod(null)).toBe(false);
    expect(isPeriod(202608)).toBe(false);
    expect(isPeriod(['2026-08'])).toBe(false);
    expect(isPeriod({ period: '2026-08' })).toBe(false);
  });
});

describe('nextPeriod / previousPeriod / periodsBetween REFUSE rather than return a non-advancing value', () => {
  it('nextPeriod throws on every malformed period, naming the function and the value', () => {
    for (const { value, from } of MALFORMED_PERIODS) {
      expect(() => nextPeriod(value), `${JSON.stringify(value)} — ${from}`).toThrow(/nextPeriod/);
    }
  });

  it('previousPeriod throws on every malformed period', () => {
    for (const { value, from } of MALFORMED_PERIODS) {
      expect(() => previousPeriod(value), `${JSON.stringify(value)} — ${from}`).toThrow(/previousPeriod/);
    }
  });

  it('periodsBetween validates BOTH ends, even the one it would never step', () => {
    // `from` after `to` returns [] without a single step, so a `to`-only walk would never read it.
    // An unvalidated `to` is how a caller gets an empty forecast instead of a refusal.
    expect(() => periodsBetween('', '2026-08')).toThrow(/periodsBetween/);
    expect(() => periodsBetween('2026-08', '')).toThrow(/periodsBetween/);
    expect(() => periodsBetween('2026-09', 'unknown')).toThrow(/periodsBetween/);
  });

  it('the error names the value, so a caller reading a log knows which document to go and look at', () => {
    expect(() => nextPeriod('unknown')).toThrow(/unknown/);
    expect(() => periodsBetween('2026-08', '9999-99')).toThrow(/9999-99/);
  });

  it('previousPeriod is nextPeriod\'s inverse on every well-formed period, year boundary included', () => {
    expect(previousPeriod('2026-03')).toBe('2026-02');
    expect(previousPeriod('2026-01')).toBe('2025-12');
    expect(nextPeriod(previousPeriod('2026-01'))).toBe('2026-01');
    expect(previousPeriod(nextPeriod('2026-12'))).toBe('2026-12');
  });
});

describe('!! WHY IT THROWS — `null` and a discriminated result BOTH REPRODUCE THE HEAP DEATH', () => {
  // This is the design argument, held by a test rather than asserted in a comment. The root
  // tsconfig is NOT strict, so a `string | null` return collapses to `string` for every caller in
  // `src/` and the compiler will never make one handle it. What reaches `comparePeriod` is then a
  // NON-STRING — and `comparePeriod` maps every non-string to 0, which is exactly the "no
  // progress, still inside the range" condition that killed the heap. A refusal a caller is free
  // to ignore is not a refusal; a throw cannot be ignored.
  it('comparePeriod maps a null cursor to 0 — the fixed point, arrived at by a different road', () => {
    const nullCursor = null as unknown as string;
    expect(comparePeriod(nullCursor, '2026-08')).toBe(0);
    expect(comparePeriod(undefined as unknown as string, '2026-08')).toBe(0);
  });

  it('a null-returning step does not advance, so the loop that consumes it never terminates', () => {
    // Run the SAME loop `periodsBetween` runs, over a hypothetical null-returning step, bounded so
    // the test can observe the non-progress instead of dying of it.
    const nullReturningNext = (period: string): string => (isPeriod(period) ? nextPeriod(period) : (null as unknown as string));
    let cursor = '' as string;
    let steps = 0;
    while (comparePeriod(cursor, '2026-08') <= 0 && steps < 50) {
      cursor = nullReturningNext(cursor);
      steps += 1;
    }
    expect(steps).toBe(50); // the bound, not the range: it never left the loop
    expect(cursor).toBeNull();
  });
});

describe('!! THE INVARIANT THAT MAKES THE REFUSAL SAFE — every producer agrees with `isPeriod`', () => {
  // The risk a source-level refusal creates: if any function in this module can emit a string
  // `isPeriod` rejects, then the projectors that step it start THROWING on real data — a refusal
  // that fires on the corpus is worse than the bug it replaced. `parseTransactionDate` validates
  // the year as `\d{4}` and `normalize` pads the month and rejects `00`/`>12`, so the property
  // holds; it is pinned here rather than inferred from reading two files.
  const READABLE_DATES = [
    '2026-03-15', '9/3/2026', '25/03/2026', '1/12/2026', '2026-1-5', '2026-12-31', '1999-01-01',
  ];

  it('every non-null `periodOf` result is a period the arithmetic accepts', () => {
    for (const dateStr of READABLE_DATES) {
      const period = periodOf(dateStr);
      expect(period, `${dateStr} should be readable`).not.toBeNull();
      expect(isPeriod(period), `periodOf(${dateStr}) = ${String(period)}`).toBe(true);
      expect(() => nextPeriod(period as string)).not.toThrow();
    }
  });

  it('every non-null `periodOfMonthYear` result is one too — both formats, strings and numbers', () => {
    for (const [month, year] of [[3, 2026], ['3', '2026'], ['03', '2026'], [12, '2026'], ['1', 1999]] as const) {
      const period = periodOfMonthYear(month, year);
      expect(isPeriod(period), `periodOfMonthYear(${String(month)}, ${String(year)})`).toBe(true);
    }
  });

  it('!! BUT `UNKNOWN_PERIOD` IS DELIBERATELY NOT ONE — it is a stamped value, never a cursor', () => {
    // `periodOrUnknown` is a WRITE decision (D21c) and its output goes into a document and into
    // an `in` clause. It must never be stepped, and `isPeriod` refusing it is what enforces that.
    expect(isPeriod(UNKNOWN_PERIOD)).toBe(false);
    expect(isPeriod(periodOrUnknown('not a date'))).toBe(false);
    expect(isPeriod(periodOrUnknownFromMonthYear('13', '2026'))).toBe(false);
    expect(() => nextPeriod(UNKNOWN_PERIOD)).toThrow();
  });
});

describe('laterPeriod / earlierPeriod — THE CLAMP, and the second class the source fix closed', () => {
  // These were added by the F-2 fix and the mutation sweep caught them UNTESTED DIRECTLY: removing
  // `earlierPeriod`'s guards left the whole suite green, because every call site that reached it
  // happened to throw one frame later for a different reason. A guard whose only evidence is an
  // indirect path is a guard one refactor away from being silent — this stage's own seventeen-times
  // finding, arriving inside the fix for it.
  it('picks the later and the earlier of two well-formed periods, and is reflexive', () => {
    expect(laterPeriod('2026-03', '2026-09')).toBe('2026-09');
    expect(laterPeriod('2026-09', '2026-03')).toBe('2026-09');
    expect(laterPeriod('2026-03', '2026-03')).toBe('2026-03');
    expect(earlierPeriod('2026-03', '2026-09')).toBe('2026-03');
    expect(earlierPeriod('2026-09', '2026-03')).toBe('2026-03');
    expect(earlierPeriod('2026-03', '2026-03')).toBe('2026-03');
    expect(laterPeriod('2025-12', '2026-01')).toBe('2026-01');
    expect(earlierPeriod('2025-12', '2026-01')).toBe('2025-12');
  });

  it('!! REFUSES ON EITHER OPERAND, and names WHICH — the hand-written ternary silently picked one', () => {
    // `comparePeriod` is total, so `comparePeriod(a, b) >= 0 ? a : b` never fails on garbage: it
    // returns whichever side the accidental ordering favours. `'unknown'` sorts after every real
    // period, `''` before every one, so the same malformed input is discarded in one direction and
    // adopted in the other — with nothing anywhere saying so.
    for (const bad of MALFORMED_PERIODS.map((m) => m.value)) {
      expect(() => laterPeriod(bad, '2026-08'), `laterPeriod(${JSON.stringify(bad)}, ok)`).toThrow(/laterPeriod: a /);
      expect(() => laterPeriod('2026-08', bad), `laterPeriod(ok, ${JSON.stringify(bad)})`).toThrow(/laterPeriod: b /);
      expect(() => earlierPeriod(bad, '2026-08'), `earlierPeriod(${JSON.stringify(bad)}, ok)`).toThrow(/earlierPeriod: a /);
      expect(() => earlierPeriod('2026-08', bad), `earlierPeriod(ok, ${JSON.stringify(bad)})`).toThrow(/earlierPeriod: b /);
    }
  });

  it('the two accidental orderings, spelled out — this is what the ternary was deciding on', () => {
    // Not a claim about the fix; a claim about WHY six instances were found one at a time.
    expect(comparePeriod('unknown', '2026-08')).toBe(1); // 'u' > '2' — adopted as the later
    expect(comparePeriod('', '2026-08')).toBe(-1); // '' < everything — adopted as the earlier
  });
});
