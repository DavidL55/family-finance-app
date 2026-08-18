// Stage 7 T3 — the backfill's decisions, tested where a script's cannot be.
//
// This is the task that writes to the family's only ledger, and a `tsx` entrypoint is the one
// place in this repo no suite executes. `planBackfill` is every decision that could silently
// corrupt a row, lifted out of `scripts/backfill-transaction-periods.ts` so it is ordinary tested
// code; the script keeps only the I/O — read, back up, verify, commit at 400, marker last.
//
// The real corpus cannot exercise most of this: T0 measured 3 rows, 3/3 dates parsed, 3/3 owners
// resolved, `incomes` absent as a collection. So the `'unknown'` branches, the orphan set, the
// incomes pass and the idempotency-with-a-WRONG-existing-value case are all synthetic by
// necessity — and T0 §7(a) is why they are not hypothetical: `date.size() == 10` is a LENGTH
// check, and a matrix-governed member can write `"9999-99-99"` today.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_UNKNOWN,
  backfillThresholdCheck,
  planBackfill,
  type RawDoc,
} from '../utils/backfillPlan';

const MEMBERS = [
  { id: 'david-levy', name: 'דויד' },
  { id: 'lilit-levy', name: 'לילית' },
  { id: 'omer-levy', name: 'עומר' },
];

/** The real corpus, verbatim from T0 §1. */
const REAL_ROWS: RawDoc[] = [
  { id: 'migrated-legacy-A', data: { date: '2026-03-15', amount: 250, category: 'מגורים ובית', owner: 'דויד' } },
  { id: 'migrated-legacy-B', data: { date: '2026-03-20', amount: 100, category: 'בריאות', owner: 'לילית' } },
  { id: 'migrated-legacy-C', data: { date: '2026-03-22', amount: 50, category: 'שונות', owner: 'עומר' } },
];

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('planBackfill — the real corpus, as T0 measured it', () => {
  it('stamps all three rows, with zero unknowns of either kind', () => {
    const plan = planBackfill(REAL_ROWS, [], [], MEMBERS);
    expect(plan.transactionRows).toBe(3);
    expect(plan.patches).toHaveLength(3);
    expect(plan.rowsUnknownPeriod).toBe(0);
    expect(plan.rowsUnknownOwner).toBe(0);
    expect(plan.patches.map((p) => p.patch)).toEqual([
      { period: '2026-03', ownerId: 'david-levy' },
      { period: '2026-03', ownerId: 'lilit-levy' },
      { period: '2026-03', ownerId: 'omer-levy' },
    ]);
  });

  it('!! IS IDEMPOTENT — a second run over its own output plans nothing', () => {
    const first = planBackfill(REAL_ROWS, [], [], MEMBERS);
    const stamped = REAL_ROWS.map((row, i) => ({ ...row, data: { ...row.data, ...first.patches[i].patch } }));
    const second = planBackfill(stamped, [], [], MEMBERS);
    expect(second.patches).toEqual([]);
    expect(second.transactionAlreadyCorrect).toBe(3);
  });

  it('!! IDEMPOTENCY IS A VALUE COMPARISON, NOT A PRESENCE CHECK', () => {
    // The distinction that decides whether a wrong stamp is repairable. `period` here is what the
    // OLD `date.slice(0, 7)` produced on a legacy date — present, plausible, and wrong. An
    // `if ('period' in data) continue` would entrench exactly the values this stage exists to stop
    // producing, on rows nothing downstream can see are broken.
    const wronglyStamped: RawDoc[] = [
      { id: 'legacy', data: { date: '9/3/2026', owner: 'דויד', period: '9/3/202', ownerId: 'david-levy' } },
    ];
    const plan = planBackfill(wronglyStamped, [], [], MEMBERS);
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].patch).toEqual({ period: '2026-03', ownerId: 'david-levy' });
  });

  it('a row stamped with a stale ownerId is corrected too', () => {
    const rows: RawDoc[] = [
      { id: 'r', data: { date: '2026-03-15', owner: 'דויד', period: '2026-03', ownerId: 'somebody-else' } },
    ];
    expect(planBackfill(rows, [], [], MEMBERS).patches[0].patch).toEqual({
      period: '2026-03',
      ownerId: 'david-levy',
    });
  });
});

describe("planBackfill — the two 'unknown' branches, counted SEPARATELY", () => {
  it("counts an unreadable date as period 'unknown' and names the row", () => {
    // Ten characters, month 99 — accepted by `date.size() == 10` and rejected by
    // `parseTransactionDate`. T0 created exactly this row from the LEAST-privileged role.
    const rows: RawDoc[] = [{ id: 'bad-date', data: { date: '9999-99-99', owner: 'דויד' } }];
    const plan = planBackfill(rows, [], [], MEMBERS);
    expect(plan.rowsUnknownPeriod).toBe(1);
    expect(plan.rowsUnknownOwner).toBe(0);
    expect(plan.unknownPeriodRows).toEqual([{ id: 'bad-date', date: '9999-99-99' }]);
    expect(plan.patches[0].patch).toEqual({ period: 'unknown', ownerId: 'david-levy' });
  });

  it("counts an unresolvable owner as ownerId 'unknown' — A6's orphan set — and names it", () => {
    const rows: RawDoc[] = [
      { id: 'orphan-1', data: { date: '2026-03-15', owner: 'מישהו שכבר לא כאן' } },
      { id: 'orphan-2', data: { date: '2026-03-16', owner: 'מישהו שכבר לא כאן' } },
      { id: 'orphan-3', data: { date: '2026-03-17' } },
    ];
    const plan = planBackfill(rows, [], [], MEMBERS);
    expect(plan.rowsUnknownOwner).toBe(3);
    expect(plan.rowsUnknownPeriod).toBe(0);
    expect(plan.unknownOwnerNames).toEqual([
      { owner: 'מישהו שכבר לא כאן', count: 2 },
      { owner: '(absent)', count: 1 },
    ]);
  });

  it('!! THE TWO COUNTS ARE NOT INTERCHANGEABLE — one row can be both, and totals them once each', () => {
    // An unreadable date and a renamed member are different problems with different fixes; a
    // single "bad rows" number would hide which one happened. A row that is both counts in both.
    const rows: RawDoc[] = [{ id: 'both', data: { date: 'לא תאריך', owner: 'רפאים' } }];
    const plan = planBackfill(rows, [], [], MEMBERS);
    expect(plan.rowsUnknownPeriod).toBe(1);
    expect(plan.rowsUnknownOwner).toBe(1);
    expect(plan.totalUnknown).toBe(2);
  });

  it('never drops a row — an unstampable row is still stamped, with `unknown`', () => {
    const rows: RawDoc[] = [{ id: 'x', data: { date: undefined, owner: undefined, amount: 12 } }];
    const plan = planBackfill(rows, [], [], MEMBERS);
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].patch).toEqual({ period: 'unknown', ownerId: 'unknown' });
  });
});

describe('planBackfill — the incomes pass (D23b)', () => {
  it('!! stamps from month/year and NOT from date — the case that would move a row between months', () => {
    // A row edited in the August view but dated in July. `CentralExpenseReport` queries on
    // month/year, so `period` must agree with that pair and not with `date`.
    const incomes: RawDoc[] = [{ id: 'i1', data: { name: 'שכר', amount: 12000, date: '2026-07-31', month: '08', year: '2026' } }];
    expect(planBackfill([], incomes, [], MEMBERS).patches[0].patch).toEqual({ period: '2026-08' });
  });

  it("stamps 'unknown' for a malformed month/year and counts it", () => {
    const incomes: RawDoc[] = [
      { id: 'i1', data: { month: '13', year: '2026' } },
      { id: 'i2', data: { month: '03', year: '26' } },
      { id: 'i3', data: {} },
    ];
    const plan = planBackfill([], incomes, [], MEMBERS);
    expect(plan.incomesUnknownPeriod).toBe(3);
    expect(plan.patches.every((p) => p.patch.period === 'unknown')).toBe(true);
  });

  it('is idempotent on incomes too, and never stamps an ownerId there', () => {
    const incomes: RawDoc[] = [{ id: 'i1', data: { month: '08', year: '2026', period: '2026-08' } }];
    const plan = planBackfill([], incomes, [], MEMBERS);
    expect(plan.patches).toEqual([]);
    expect(plan.incomeAlreadyCorrect).toBe(1);
  });

  it('is a NO-OP on the real corpus, because `incomes` does not exist — recorded as measured', () => {
    // T0 §5: 0 documents, collection absent, divergence count 0 OF 0. That is not evidence the
    // deferral is a footnote; it is evidence the corpus cannot answer the question.
    const plan = planBackfill(REAL_ROWS, [], [], MEMBERS);
    expect(plan.incomeRows).toBe(0);
    expect(plan.patches.every((p) => p.collection !== 'incomes')).toBe(true);
  });
});

describe('planBackfill — audit_log.at, the two-row type fix', () => {
  it('converts a Timestamp `at` to an ISO string and leaves a string one alone', () => {
    const audit: RawDoc[] = [
      { id: 'server-1', data: { at: ts('2026-08-17T22:27:27.274Z'), action: 'ai.costCeiling.set' } },
      { id: 'client-1', data: { at: '2026-08-17T22:27:09.774Z', action: 'recurring.autopost' } },
    ];
    const plan = planBackfill([], [], audit, MEMBERS);
    expect(plan.auditConverted).toBe(1);
    expect(plan.auditAlreadyIso).toBe(1);
    expect(plan.patches).toEqual([
      {
        collection: 'audit_log',
        id: 'server-1',
        patch: { at: '2026-08-17T22:27:27.274Z' },
        why: 'audit_log/server-1: at Timestamp -> ISO string',
      },
    ]);
  });

  it('!! the converted value is READABLE — which is the entire point of the fix', () => {
    // `new Date(entry.at)` is `Invalid Date` for a Timestamp, on the collection whose whole job is
    // being readable afterwards. The assertion is on the round trip, not on the type.
    const audit: RawDoc[] = [{ id: 'a', data: { at: ts('2026-08-17T22:27:27.274Z') } }];
    const converted = planBackfill([], [], audit, MEMBERS).patches[0].patch.at as string;
    expect(Number.isNaN(new Date(converted).getTime())).toBe(false);
  });

  it('reports an `at` that is neither string nor Timestamp instead of guessing a date', () => {
    const audit: RawDoc[] = [{ id: 'weird', data: { at: 12345 } }];
    const plan = planBackfill([], [], audit, MEMBERS);
    expect(plan.auditUnreadable).toEqual(['weird']);
    expect(plan.patches).toEqual([]);
  });

  it('is idempotent — a second run finds every row already ISO', () => {
    const audit: RawDoc[] = [{ id: 'a', data: { at: ts('2026-08-17T22:27:27.274Z') } }];
    const first = planBackfill([], [], audit, MEMBERS);
    const after: RawDoc[] = [{ id: 'a', data: { at: first.patches[0].patch.at } }];
    expect(planBackfill([], [], after, MEMBERS).patches).toEqual([]);
  });
});

describe('backfillThresholdCheck — the named threshold, exit-non-zero', () => {
  it('defaults to zero, because T0 measured this corpus at 3/3 and 3/3', () => {
    expect(DEFAULT_MAX_UNKNOWN).toBe(0);
  });

  it('passes on the real corpus and refuses on a single unknown', () => {
    expect(backfillThresholdCheck(planBackfill(REAL_ROWS, [], [], MEMBERS), DEFAULT_MAX_UNKNOWN).status).toBe('ok');

    const withOneBad = [...REAL_ROWS, { id: 'bad', data: { date: '9999-99-99', owner: 'דויד' } }];
    const refusal = backfillThresholdCheck(planBackfill(withOneBad, [], [], MEMBERS), DEFAULT_MAX_UNKNOWN);
    expect(refusal.status).toBe('refused');
    expect(refusal.message).toContain('--max-unknown=1');
  });

  it('accepts them when the threshold is raised deliberately', () => {
    const withOneBad = [...REAL_ROWS, { id: 'bad', data: { date: '9999-99-99', owner: 'דויד' } }];
    expect(backfillThresholdCheck(planBackfill(withOneBad, [], [], MEMBERS), 1).status).toBe('ok');
  });

  it('counts unknowns from ALL THREE passes toward the same threshold', () => {
    const plan = planBackfill(
      [{ id: 'a', data: { date: 'לא', owner: 'רפאים' } }],
      [{ id: 'i', data: { month: '13', year: '2026' } }],
      [],
      MEMBERS
    );
    // 1 unparseable date + 1 unresolvable owner + 1 malformed income month/year.
    expect(plan.totalUnknown).toBe(3);
    expect(backfillThresholdCheck(plan, 2).status).toBe('refused');
    expect(backfillThresholdCheck(plan, 3).status).toBe('ok');
  });
});
