// Stage 7 T3 — the scope-aware history read path (D21a/b/c) and the completion marker's
// REFUSAL (D21d).
//
// ── WHAT A MOCKED SUITE CAN AND CANNOT SHOW HERE ─────────────────────────────────────────────
//
// It can show the SHAPE of the query the client builds — which is the thing D21(b) rules on, and
// the thing a green emulator run may NOT show, because the `in`-expansion cap is enforced
// server-side against a query this family's data is currently four members short of triggering.
// It cannot show whether Firestore accepts that shape; `transaction-history.rules.test.ts` does
// that on the live emulator, and neither file is sufficient alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    const [first, ...rest] = args as [unknown, ...string[]];
    const segments =
      typeof first === 'object' && first !== null && '__col' in first
        ? [(first as { __col: string }).__col, ...rest]
        : rest;
    return `doc:${segments.join('/')}`;
  }),
  query: vi.fn((colRef: { __col: string }, ...clauses: unknown[]) => ({ __col: colRef.__col, __clauses: clauses })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
}));

import {
  DNF_DISJUNCTION_LIMIT,
  HISTORY_PERIOD_VALUE_COUNT,
  buildHistoryClauses,
  firstFailingMemberCountForTwoInClauses,
  listTransactionHistory,
  loadStatisticalHistory,
  readTransactionBackfillMarker,
} from '../services/TransactionHistoryService';
import {
  MIGRATION_STATE_DOC,
  TRANSACTION_PERIOD_BACKFILL_KEY,
  parseBackfillMarker,
  statisticalLayerGate,
} from '../utils/backfillMarker';
import { UNKNOWN_PERIOD } from '../utils/periodMath';

const SIX_PERIODS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const MARKER = {
  completedAt: '2026-08-18T09:00:00.000Z',
  rowsStamped: 3,
  rowsUnknown: 0,
  sourceCommit: 'a86c4e9',
};

const snapOf = (rows: Array<Record<string, unknown>>) => ({
  docs: rows.map((r, i) => ({ id: `d${i}`, data: () => r })),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDocs.mockResolvedValue(snapOf([]));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. EXACTLY ONE `in` CLAUSE (D21b), AND THE ARITHMETIC IS PINNED
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('D21(b) — the history query carries exactly one disjunctive clause', () => {
  it("'family' scope sends ONE clause: period in [6 periods + 'unknown']", () => {
    const clauses = buildHistoryClauses('family', 'omer-levy', SIX_PERIODS);
    expect(clauses).toEqual([
      { field: 'period', op: 'in', value: [...SIX_PERIODS, UNKNOWN_PERIOD] },
    ]);
  });

  it("'own' scope adds where('ownerId','==',me) — an EQUALITY, so the disjunction count is unchanged", () => {
    const clauses = buildHistoryClauses('own', 'omer-levy', SIX_PERIODS);
    expect(clauses).toEqual([
      { field: 'ownerId', op: '==', value: 'omer-levy' },
      { field: 'period', op: 'in', value: [...SIX_PERIODS, UNKNOWN_PERIOD] },
    ]);
  });

  it('!! there is NEVER more than one `in`, at either scope — this is the assertion A4 asked for', () => {
    for (const scope of ['own', 'family'] as const) {
      const disjunctive = buildHistoryClauses(scope, 'omer-levy', SIX_PERIODS).filter(
        (c) => c.op === 'in' || c.op === 'not-in' || c.op === 'array-contains-any'
      );
      expect(disjunctive).toHaveLength(1);
    }
  });

  it("מי is NOT a query clause — the member filter is applied client-side over returned rows", () => {
    // A4's actual ruling. `owner in [N] × period in [7]` is what breaks; keeping מי off the wire
    // is what makes the shape safe at 20 members. T0 also measured that it buys nothing on the
    // payload: narrowing to one member does not shrink a family-scope read.
    const fields = buildHistoryClauses('family', 'omer-levy', SIX_PERIODS).map((c) => c.field);
    expect(fields).not.toContain('owner');
    expect(fields.filter((f) => f === 'ownerId')).toHaveLength(0);
  });

  it("appends 'unknown' exactly once even if the caller already passed it", () => {
    const clauses = buildHistoryClauses('family', 'x', [...SIX_PERIODS, UNKNOWN_PERIOD]);
    const values = clauses[0].value as string[];
    expect(values.filter((v) => v === UNKNOWN_PERIOD)).toHaveLength(1);
  });

  it('refuses more than six periods rather than silently truncating the window', () => {
    // Truncation here is D33's forbidden `limit()` wearing a different hat: it would shorten the
    // lookback without saying so, and a moving average over a shorter window renders identically.
    expect(() => buildHistoryClauses('family', 'x', [...SIX_PERIODS, '2026-07'])).toThrow(/period/i);
  });

  it('refuses an empty period list — an `in` with no values matches nothing and reads as "no history"', () => {
    expect(() => buildHistoryClauses('family', 'x', [])).toThrow(/period/i);
  });

  it("refuses an 'own' read with no viewer id rather than issuing an unscoped query", () => {
    expect(() => buildHistoryClauses('own', '', SIX_PERIODS)).toThrow(/viewer/i);
  });
});

describe("D21(b) arithmetic — the two-`in` shape breaks at N ≥ 5, not N ≥ 6 (T0's correction)", () => {
  it('the constants are the ones the limit is actually computed from', () => {
    expect(DNF_DISJUNCTION_LIMIT).toBe(30);
    // SIX periods plus `'unknown'`. v2's D21(b) computed 6N and pinned the wrong number; the
    // seventh value is A5's, and it is what moves the threshold by a whole member.
    expect(HISTORY_PERIOD_VALUE_COUNT).toBe(7);
  });

  it('!! 7 × N ≤ 30 makes the FIRST FAILING N exactly 5', () => {
    expect(firstFailingMemberCountForTwoInClauses()).toBe(5);
    // Spelled out, because "off by one member" is how this got mis-stated the first time:
    expect(4 * HISTORY_PERIOD_VALUE_COUNT).toBeLessThanOrEqual(DNF_DISJUNCTION_LIMIT); // 28 — fits
    expect(5 * HISTORY_PERIOD_VALUE_COUNT).toBeGreaterThan(DNF_DISJUNCTION_LIMIT); // 35 — fails
  });

  it('this family is already over it, which is why the one-`in` shape is not a precaution', () => {
    // Three members today, and the stage's own acceptance dataset is twenty.
    expect(20).toBeGreaterThanOrEqual(firstFailingMemberCountForTwoInClauses());
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE READ ITSELF
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('listTransactionHistory', () => {
  it('issues the built clauses against transaction_lines and returns rows with their doc id', async () => {
    mockGetDocs.mockResolvedValueOnce(snapOf([{ owner: 'עומר', amount: 50, period: '2026-03' }]));
    const rows = await listTransactionHistory('own', 'omer-levy', SIX_PERIODS);
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__col).toBe('transaction_lines');
    expect(queryArg.__clauses).toEqual(buildHistoryClauses('own', 'omer-levy', SIX_PERIODS));
    // `createOwnedCollectionRepo.list` drops `d.id` (finding 1.2.8) and D20's tiebreak paid for
    // it. This read carries the id, because a history row's identity is the only thing that makes
    // the drill-down in D36 followable.
    expect(rows[0].id).toBe('d0');
  });

  it('does NOT swallow a failed read into an empty list', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('boom'));
    await expect(listTransactionHistory('family', 'x', SIX_PERIODS)).rejects.toThrow('boom');
  });

  it("counts the 'unknown' rows it returned — D6's unusableRowCount, from the SAME fetch", async () => {
    mockGetDocs.mockResolvedValueOnce(
      snapOf([
        { period: '2026-03', amount: 1 },
        { period: UNKNOWN_PERIOD, amount: 2 },
        { period: UNKNOWN_PERIOD, amount: 3 },
      ])
    );
    const rows = await listTransactionHistory('family', 'x', SIX_PERIODS);
    expect(rows.filter((r) => r.period === UNKNOWN_PERIOD)).toHaveLength(2);
    // A5's ruling in one line: the hole is queryable because it is a VALUE, so no second read and
    // no denied scan is needed to see it.
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE COMPLETION MARKER REFUSES (D21d)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('parseBackfillMarker — a marker is a record of a finished run, or it is nothing', () => {
  it('names the document and the key it lives under', () => {
    expect(MIGRATION_STATE_DOC).toBe('migrationState');
    expect(TRANSACTION_PERIOD_BACKFILL_KEY).toBe('transactionPeriodBackfill');
  });

  it('parses a complete marker', () => {
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: MARKER })).toEqual(MARKER);
  });

  it('returns null for an absent document, an absent key, and a non-object', () => {
    expect(parseBackfillMarker(undefined)).toBeNull();
    expect(parseBackfillMarker(null)).toBeNull();
    expect(parseBackfillMarker({})).toBeNull();
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: 'done' })).toBeNull();
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: true })).toBeNull();
  });

  it('!! refuses a PARTIAL marker — every field is load-bearing and a missing one means an aborted run', () => {
    for (const missing of ['completedAt', 'rowsStamped', 'rowsUnknown', 'sourceCommit']) {
      const partial: Record<string, unknown> = { ...MARKER };
      delete partial[missing];
      expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: partial })).toBeNull();
    }
  });

  it('refuses a marker whose counts are not numbers or whose completedAt is empty', () => {
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: { ...MARKER, rowsStamped: '3' } })).toBeNull();
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: { ...MARKER, rowsUnknown: null } })).toBeNull();
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: { ...MARKER, completedAt: '' } })).toBeNull();
  });

  it('accepts a marker recording a run that stamped nothing — zero rows is a real outcome', () => {
    // An empty collection is a legitimately finished backfill. Treating `rowsStamped: 0` as
    // "never ran" would make the refusal permanent on a fresh install.
    expect(parseBackfillMarker({ [TRANSACTION_PERIOD_BACKFILL_KEY]: { ...MARKER, rowsStamped: 0 } })).not.toBeNull();
  });
});

describe('!! statisticalLayerGate — a REFUSAL, not a caveat (D21d)', () => {
  it('refuses when the marker is absent', () => {
    const gate = statisticalLayerGate(null);
    expect(gate.status).toBe('refused-backfill-incomplete');
    expect(gate.reasonHe.length).toBeGreaterThan(0);
  });

  it('allows when the marker is present', () => {
    expect(statisticalLayerGate(MARKER).status).toBe('allowed');
  });

  it('!! WHY IT MUST REFUSE: an untouched row has NO period, so nothing downstream can see it', () => {
    // The one that explains the whole design. `'unknown'` cannot report a half-done backfill,
    // because a row the backfill never reached has no `period` FIELD AT ALL and a
    // `where('period','in',[…])` query simply does not return it. So the instrument that reports
    // unusable rows is structurally blind to unstamped ones, and an average over "every row the
    // query returned" is an average over an arbitrary fraction of the corpus rendered at full
    // confidence. There is no caveat that fixes that; only not computing does.
    const unstamped = { owner: 'עומר', amount: 50, date: '2026-03-22' };
    expect(unstamped).not.toHaveProperty('period');
    expect(statisticalLayerGate(null).status).toBe('refused-backfill-incomplete');
  });

  it("uses a string discriminant, because the root tsconfig is NOT strict", () => {
    // A boolean `allowed` would narrow to `boolean` in `src/` and the refusal branch would be
    // reachable with no compiler help. Stated as a test rather than a comment.
    expect(typeof statisticalLayerGate(null).status).toBe('string');
    expect(typeof statisticalLayerGate(MARKER).status).toBe('string');
  });
});

describe('!! loadStatisticalHistory — the refusal is STRUCTURAL: no marker, NO QUERY', () => {
  it('refuses without issuing a single read when the marker is absent', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const result = await loadStatisticalHistory('family', 'x', SIX_PERIODS);
    expect(result.status).toBe('refused-backfill-incomplete');
    expect(result.rows).toEqual([]);
    // THE ASSERTION THAT MAKES IT A REFUSAL RATHER THAN A LABEL: the history query is never sent,
    // so there is no partial corpus for a caller to average by accident.
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('refuses on a marker that exists but is malformed — same branch, same silence', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ [TRANSACTION_PERIOD_BACKFILL_KEY]: { completedAt: 'x' } }),
    });
    const result = await loadStatisticalHistory('family', 'x', SIX_PERIODS);
    expect(result.status).toBe('refused-backfill-incomplete');
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('reads history once the marker is set, and carries the marker back for provenance', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ [TRANSACTION_PERIOD_BACKFILL_KEY]: MARKER }),
    });
    mockGetDocs.mockResolvedValueOnce(snapOf([{ period: '2026-03', amount: 250 }]));
    const result = await loadStatisticalHistory('own', 'omer-levy', SIX_PERIODS);
    expect(result.status).toBe('ready');
    expect(result.rows).toHaveLength(1);
    expect(result.marker).toEqual(MARKER);
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('a failed marker read is an ERROR, never a refusal and never an empty history', async () => {
    // A denied or broken `settings/migrationState` read must not be indistinguishable from "the
    // backfill has not run". Both suppress the layer; only one of them is a data problem.
    mockGetDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(loadStatisticalHistory('family', 'x', SIX_PERIODS)).rejects.toThrow();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});

describe('readTransactionBackfillMarker', () => {
  it('reads settings/migrationState and extracts the one key', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ [TRANSACTION_PERIOD_BACKFILL_KEY]: MARKER }),
    });
    expect(await readTransactionBackfillMarker()).toEqual(MARKER);
    expect(mockGetDoc.mock.calls[0][0]).toBe(`doc:settings/${MIGRATION_STATE_DOC}`);
  });

  it('returns null when the document does not exist — T0 confirmed it does not', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    expect(await readTransactionBackfillMarker()).toBeNull();
  });
});
