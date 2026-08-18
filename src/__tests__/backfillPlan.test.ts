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
import { join } from 'node:path';
import { REPO_ROOT, readSourceCached, stripComments } from './helpers/extractionSurfaces';
import {
  BACKFILL_BATCH_SIZE,
  DEFAULT_MAX_UNKNOWN,
  FIRESTORE_BATCH_LIMIT,
  backfillThresholdCheck,
  chunkPatches,
  planBackfill,
  readableString,
  type PlannedPatch,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F1 — A NON-STRING `date` OR `owner` IS CLIENT-REACHABLE, AND IT USED TO CRASH
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `backfillPlan` reads UNTRUSTED Firestore data. Before this fix it cast `doc.data.date` and
// `doc.data.owner` to `string` and then called `.includes` / `.trim` on them, so a row whose
// `date` is a number threw `TypeError: dateStr.includes is not a function` — with NO DOCUMENT ID
// in the message, on the family's only ledger, and in direct contradiction of the script's own
// contract ("a row whose `date` cannot be read gets `'unknown'`").
//
// THE STATE IS CLIENT-REACHABLE, AND THAT WAS PROVEN LIVE, NOT ARGUED:
//   · a PARENT can `updateDoc` a row to `date: 12345` — the `isSuperAdmin() || isParent()`
//     alternation on `allow update` bypasses the `date is string` re-validation;
//   · a SUPER-ADMIN can `create` a row with `owner: 12345` — `owner` had NO type check on create.
// `firestore.rules`' own D21(d) comment already recorded T0 probing exactly this.
//
// It failed CLOSED (before the backup, before any write) so nothing could corrupt. The defect is
// that the operator could not tell WHICH row, and the contract said it would be handled.
describe('planBackfill — a non-string `date`/`owner` is DATA, not a crash (T3 review F1)', () => {
  const MALFORMED: RawDoc[] = [
    { id: 'num-date', data: { date: 12345, amount: 1, owner: 'דויד' } },
    { id: 'ts-date', data: { date: ts('2026-03-01T00:00:00.000Z'), amount: 1, owner: 'דויד' } },
    { id: 'bool-date', data: { date: true, amount: 1, owner: 'דויד' } },
    { id: 'obj-date', data: { date: { seconds: 1 }, amount: 1, owner: 'דויד' } },
    { id: 'arr-date', data: { date: ['2026-03-01'], amount: 1, owner: 'דויד' } },
    { id: 'num-owner', data: { date: '2026-03-01', amount: 1, owner: 12345 } },
    { id: 'arr-owner', data: { date: '2026-03-01', amount: 1, owner: ['דויד'] } },
    { id: 'obj-owner', data: { date: '2026-03-01', amount: 1, owner: { name: 'דויד' } } },
    { id: 'bool-owner', data: { date: '2026-03-01', amount: 1, owner: true } },
  ];

  it('does not throw on any non-string date or owner', () => {
    expect(() => planBackfill(MALFORMED, [], [], MEMBERS)).not.toThrow();
  });

  it("a non-string date becomes 'unknown', exactly as the contract says", () => {
    const plan = planBackfill(MALFORMED, [], [], MEMBERS);
    const byId = new Map(plan.patches.map((p) => [p.id, p.patch]));
    for (const id of ['num-date', 'ts-date', 'bool-date', 'obj-date', 'arr-date']) {
      expect(byId.get(id)!.period, id).toBe('unknown');
    }
    expect(plan.rowsUnknownPeriod).toBe(5);
  });

  it("a non-string owner becomes 'unknown', and never a stringified guess", () => {
    const plan = planBackfill(MALFORMED, [], [], MEMBERS);
    const byId = new Map(plan.patches.map((p) => [p.id, p.patch]));
    for (const id of ['num-owner', 'arr-owner', 'obj-owner', 'bool-owner']) {
      expect(byId.get(id)!.ownerId, id).toBe('unknown');
    }
    expect(plan.rowsUnknownOwner).toBe(4);
  });

  it('!! IT NAMES THE OFFENDING DOCUMENT ID AND THE TYPE IT FOUND', () => {
    // The whole point of the finding: the operator saw a TypeError with no document id, on the
    // family's only ledger. A count is not enough — the row has to be findable.
    const plan = planBackfill(MALFORMED, [], [], MEMBERS);
    const seen = plan.malformedFields.map((m) => `${m.id}.${m.field}:${m.typeName}`).sort();
    expect(seen).toEqual(
      [
        'arr-date.date:array',
        'arr-owner.owner:array',
        'bool-date.date:boolean',
        'bool-owner.owner:boolean',
        'num-date.date:number',
        'num-owner.owner:number',
        'obj-date.date:object',
        'obj-owner.owner:object',
        'ts-date.date:object',
      ].sort()
    );
  });

  it('an absent date/owner is NOT reported as malformed — absent and wrong-typed are different problems', () => {
    const plan = planBackfill([{ id: 'bare', data: { amount: 1 } }], [], [], MEMBERS);
    expect(plan.malformedFields).toEqual([]);
    expect(plan.rowsUnknownPeriod).toBe(1);
    expect(plan.rowsUnknownOwner).toBe(1);
  });

  it('a malformed row still counts toward the threshold, so the run REFUSES rather than guessing', () => {
    const plan = planBackfill(MALFORMED, [], [], MEMBERS);
    expect(backfillThresholdCheck(plan, DEFAULT_MAX_UNKNOWN).status).toBe('refused');
  });

  it('the incomes pass survives a non-string month/year too', () => {
    const plan = planBackfill(
      [],
      [{ id: 'i-bad', data: { month: { m: 3 }, year: [2026] } }],
      [],
      MEMBERS
    );
    expect(plan.patches[0].patch.period).toBe('unknown');
    expect(plan.incomesUnknownPeriod).toBe(1);
  });

  it('readableString is the one place the decision is made', () => {
    expect(readableString('2026-03-01')).toBe('2026-03-01');
    expect(readableString('')).toBe('');
    expect(readableString(12345)).toBeUndefined();
    expect(readableString(true)).toBeUndefined();
    expect(readableString(null)).toBeUndefined();
    expect(readableString(undefined)).toBeUndefined();
    expect(readableString(['a'])).toBeUndefined();
    expect(readableString({ toString: () => 'x' })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F8 — `BATCH_SIZE = 400` WAS HELD BY NOTHING
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// It lived as a `const` inside the `tsx` entrypoint, which is the one file no suite in this repo
// executes. Set to 600 the run SUCCEEDS locally and in CI, because the emulator does not enforce
// Firestore's 500-operation batch limit — and then aborts partway through the first real-Firestore
// run, on the family's only ledger, after the backup but before the marker.
//
// The fix is the same one the script's own header already argues for every other decision: the
// number and the chunking move into this module, where they are ordinary tested code, and
// `chunkPatches` REFUSES a size above the hard limit instead of building a batch that cannot
// commit. Green-locally-red-in-production becomes red-here.
describe('chunkPatches — the batch size is a decision, not a literal in an unexecuted script (F8)', () => {
  const patch = (i: number): PlannedPatch => ({
    collection: 'transaction_lines',
    id: `row-${i}`,
    patch: { period: '2026-03', ownerId: 'david-levy' },
    why: `row-${i}`,
  });
  const many = (n: number): PlannedPatch[] => Array.from({ length: n }, (_, i) => patch(i));

  it('the configured size is strictly under Firestore hard limit', () => {
    expect(BACKFILL_BATCH_SIZE).toBeLessThan(FIRESTORE_BATCH_LIMIT);
    expect(BACKFILL_BATCH_SIZE).toBe(400);
    expect(FIRESTORE_BATCH_LIMIT).toBe(500);
  });

  it('no chunk can ever exceed the hard limit, whatever the configured size', () => {
    for (const chunk of chunkPatches(many(1000), BACKFILL_BATCH_SIZE)) {
      expect(chunk.length).toBeLessThanOrEqual(FIRESTORE_BATCH_LIMIT);
    }
  });

  it('loses nothing and duplicates nothing', () => {
    const input = many(1001);
    const flat = chunkPatches(input, BACKFILL_BATCH_SIZE).flat();
    expect(flat.map((p) => p.id)).toEqual(input.map((p) => p.id));
  });

  it('chunks at exactly the configured size', () => {
    expect(chunkPatches(many(1001), 400).map((c) => c.length)).toEqual([400, 400, 201]);
    expect(chunkPatches(many(800), 400).map((c) => c.length)).toEqual([400, 400]);
    expect(chunkPatches([], 400)).toEqual([]);
  });

  it('!! REFUSES a size above the hard limit — this is the 600 case, red HERE instead of live', () => {
    expect(() => chunkPatches(many(10), 600)).toThrow(/500/);
    expect(() => chunkPatches(many(10), 501)).toThrow(/500/);
  });

  it('refuses a nonsensical size rather than looping forever', () => {
    expect(() => chunkPatches(many(10), 0)).toThrow();
    expect(() => chunkPatches(many(10), -1)).toThrow();
    expect(() => chunkPatches(many(10), 2.5)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SCRIPT DEFERS BOTH DECISIONS TO THIS MODULE — STRUCTURALLY, NOT BY CONVENTION (F7, F8)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `scripts/backfill-transaction-periods.ts` is the one file in this repo no suite executes: the
// root suite mocks Firestore, the rules suite runs Rules, neither runs a `tsx` entrypoint. Its own
// header already argues that every decision belongs here for exactly that reason — and the batch
// size and the marker's contents had both stayed behind anyway. A convention nothing holds is a
// convention that drifts back, so these two are read off the script's source.
describe('the backfill script restates neither the batch size nor the marker (F7, F8)', () => {
  const script = stripComments(
    readSourceCached(join(REPO_ROOT, 'scripts/backfill-transaction-periods.ts')),
    'scripts/backfill-transaction-periods.ts'
  );

  it('takes the batch size and the chunking from here', () => {
    expect(script).toContain('BACKFILL_BATCH_SIZE');
    expect(script).toContain('chunkPatches(');
    // The exact shape the finding names: a private `const BATCH_SIZE = 400` that no suite reaches,
    // which stayed green at 600 because the emulator does not enforce the 500-op limit.
    expect(script).not.toMatch(/const\s+BATCH_SIZE\s*=/);
  });

  it('builds the completion marker through nextBackfillMarker, over the parsed existing one', () => {
    expect(script).toContain('nextBackfillMarker(');
    expect(script).toContain('parseBackfillMarker(');
    // The unconditional rewrite F7 names: `completedAt`/`sourceCommit` assigned at the write site.
    expect(script).not.toMatch(/completedAt:\s*new Date\(\)/);
    expect(script).not.toMatch(/sourceCommit:\s*sourceCommit\(\)/);
  });

  it('reports the malformed rows F1 made visible, by document id', () => {
    expect(script).toContain('plan.malformedFields');
  });
});
