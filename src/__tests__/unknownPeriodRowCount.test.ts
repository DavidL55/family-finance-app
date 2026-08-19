// src/__tests__/unknownPeriodRowCount.test.ts — Stage 7 T7b. §13's `unusableRowCount`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WRITTEN BECAUSE THE FIGURE SHIPPED WITH NOTHING HOLDING IT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The mutation sweep for this task produced two survivors here, and they are the same defect from
// two sides: `return history.rows.length` (count EVERY row, not the unreadable ones) and the door
// check deleted. Both passed the whole suite, because the figure had a renderer and no test.
//
// It is the exact shape §12 exists to catch — a guard whose "able to fail" column is empty — and it
// is worth stating what each survivor would have done on a screen:
//
//   · `rows.length` turns "3 rows in the whole ledger could not be read" into "1,847 rows could not
//     be read", under a sentence that says the ledger is damaged. On a corpus where nothing is
//     wrong.
//   · the door check deleted lets a forged corpus report ZERO unreadable rows over a ledger full of
//     them — the same forgery class the T5 review closed three times over, pointed at the one
//     figure whose whole job is to disclose damage.
import { describe, expect, it } from 'vitest';
import { unknownPeriodRowCount } from '../utils/statisticalLayer';
import { sealStatisticalHistory, type StatisticalHistoryRow } from '../utils/statisticalHistory';
import { UNKNOWN_PERIOD } from '../utils/periodMath';
import type { TransactionPeriodBackfillMarker } from '../utils/backfillMarker';

// A COMPLETE marker, because the gate refuses an incomplete one and this suite is about the count
// rather than about the gate. Typed rather than cast — the marker gained fields in T3 review F7 and
// a cast here would have hidden that from this file forever.
const MARKER: TransactionPeriodBackfillMarker = {
  completedAt: '2026-08-01T00:00:00.000Z',
  sourceCommit: 'abc1234',
  rowsStamped: 4,
  rowsUnknown: 2,
  lastRunAt: '2026-08-01T00:00:00.000Z',
  lastRunCommit: 'abc1234',
  transactionRows: 4,
};

function seal(rows: StatisticalHistoryRow[]) {
  return sealStatisticalHistory(MARKER, rows);
}

describe('!! `unknownPeriodRowCount` — the ledger-wide unreadable-row figure', () => {
  it('counts ONLY the rows whose period could not be read', () => {
    const handle = seal([
      { id: 'a', period: '2026-07', amount: 100 },
      { id: 'b', period: UNKNOWN_PERIOD, amount: 100 },
      { id: 'c', period: '2026-08', amount: 100 },
      { id: 'd', period: UNKNOWN_PERIOD, amount: 100 },
    ]);
    expect(unknownPeriodRowCount(handle)).toBe(2);
    // …and the total is deliberately DIFFERENT from the count, so "return rows.length" cannot pass.
    expect(handle.rows).toHaveLength(4);
  });

  it('`0` is a real and expected value — a clean ledger reports zero, not nothing', () => {
    expect(unknownPeriodRowCount(seal([{ id: 'a', period: '2026-07', amount: 1 }]))).toBe(0);
    expect(unknownPeriodRowCount(seal([]))).toBe(0);
  });

  it('a REFUSAL counts nothing — there is no corpus in memory to count', () => {
    // Distinct from "the ledger is clean": the history input's own grade already says the backfill
    // did not complete, and inventing a zero here would put a reassuring figure under a refusal.
    expect(
      unknownPeriodRowCount({ status: 'refused-backfill-incomplete', reasonHe: 'x' })
    ).toBe(0);
  });

  it('!! THE DOOR — a handle that did not come through `loadStatisticalHistory` THROWS', () => {
    // Everything readable off the sealed object is COPYABLE — object spread and `Object.assign` copy
    // own enumerable symbol properties, and `Object.create` inherits through the prototype chain.
    // That is why the check is by IDENTITY and why deleting it is not a style change: a forged
    // corpus would report zero unreadable rows over a ledger full of them.
    const real = seal([{ id: 'a', period: UNKNOWN_PERIOD, amount: 1 }]);
    const forged = { ...real, rows: [{ id: 'z', period: '2026-07', amount: 1 }] };
    expect(() => unknownPeriodRowCount(forged)).toThrow(/loadStatisticalHistory/);
    // …and the real one still works, so the check is not simply refusing everything.
    expect(unknownPeriodRowCount(real)).toBe(1);
  });
});
