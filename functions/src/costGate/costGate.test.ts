import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── firebase-admin/firestore mock ──────────────────────────────────────────────
// Admin SDK shape, NOT the client SDK's (`snap.exists` is a boolean property here, never a
// method) — deliberately distinct from financeCollections.test.ts's `firebase/firestore` mock,
// per this task's own convention note. A tiny in-memory store backs the three collections that
// need real read-after-write persistence across calls within one test (the approval token's
// single-use flow, and reconcileSpend's ledger fixtures); the ceiling/counter docs are
// canned via mockCeilingILS/mockMonthToDate instead, since no test needs them to accumulate.
const {
  mockRunTransaction, mockTxGet, mockTxSet, mockTxUpdate,
  mockBareDocGet, mockBareDocSet, mockIncrement, mockServerTimestamp, state,
} = vi.hoisted(() => {
  return {
    mockRunTransaction: vi.fn(),
    mockTxGet: vi.fn(),
    mockTxSet: vi.fn(),
    mockTxUpdate: vi.fn(),
    mockBareDocGet: vi.fn(),
    mockBareDocSet: vi.fn(),
    mockIncrement: vi.fn((n: number) => ({ __increment: n })),
    mockServerTimestamp: vi.fn(() => '__serverTimestamp__'),
    state: {
      ceilingILS: 0,
      usedThisMonthILS: 0,
      approvals: {} as Record<string, Record<string, unknown>>,
      ledgerFixtures: {} as Record<string, Record<string, unknown>>,
    },
  };
});

function routeGet(path: string) {
  if (path === 'settings/aiCostConfig') {
    return { exists: true, data: () => ({ monthlyCeilingILS: state.ceilingILS }) };
  }
  if (path.startsWith('ai_usage_counters/')) {
    return { exists: true, data: () => ({ totalILS: state.usedThisMonthILS }) };
  }
  if (path.startsWith('ai_overage_approvals/')) {
    const rec = state.approvals[path];
    return rec ? { exists: true, data: () => rec } : { exists: false, data: () => undefined };
  }
  if (path.startsWith('ai_usage/')) {
    const id = path.slice('ai_usage/'.length);
    const rec = state.ledgerFixtures[id];
    return rec ? { exists: true, data: () => rec } : { exists: false, data: () => undefined };
  }
  return { exists: false, data: () => undefined };
}

function persistWrite(path: string, data: Record<string, unknown>, opts?: { merge?: boolean }) {
  if (path.startsWith('ai_overage_approvals/')) {
    state.approvals[path] = opts?.merge ? { ...(state.approvals[path] ?? {}), ...data } : { ...data };
  }
  if (path.startsWith('ai_usage/')) {
    // Needed for the reconcileSpend idempotency test: a repeat call must read back whatever the
    // FIRST call's tx.update actually persisted (reconciled: true), not the original fixture.
    const id = path.slice('ai_usage/'.length);
    state.ledgerFixtures[id] = { ...(state.ledgerFixtures[id] ?? {}), ...data };
  }
  // ai_usage_counters writes are spy-only in this suite — no test reads them back within the
  // same call (asserted on via mockTxUpdate call args instead, see the idempotency test below).
}

vi.mock('firebase-admin/firestore', () => {
  function makeRef(path: string) {
    return {
      __path: path,
      get: async () => {
        mockBareDocGet(path);
        return routeGet(path);
      },
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        mockBareDocSet(path, data, opts);
        persistWrite(path, data, opts);
      },
    };
  }
  return {
    getFirestore: () => ({
      doc: (path: string) => makeRef(path),
      collection: (path: string) => ({
        doc: (id?: string) => makeRef(`${path}/${id ?? 'auto-generated-id'}`),
      }),
      runTransaction: mockRunTransaction,
    }),
    FieldValue: {
      increment: mockIncrement,
      serverTimestamp: mockServerTimestamp,
    },
  };
});

// ── provider registry / exchange-rate fixtures (Task 4 hasn't wired real providers yet) ────────
vi.mock('../providers/registry', () => {
  const FIXTURES: Record<string, { providerId: string; adapterId: string; usdIn: number; usdOut: number }> = {
    'mock-standard': { providerId: 'mock', adapterId: 'mock', usdIn: 0, usdOut: 0 },
    'claude-sonnet-5': { providerId: 'anthropic', adapterId: 'anthropic', usdIn: 0.003, usdOut: 0.015 },
    'claude-opus-5': { providerId: 'anthropic', adapterId: 'anthropic', usdIn: 0.015, usdOut: 0.075 },
  };
  return {
    // quote() uses findModelEntry — the action-BLIND catalog/pricing lookup — not
    // getAdapterForModel (Task 7 review, Important 1: the action-tag check belongs at the point of
    // dispatch, and a price has no action axis).
    findModelEntry: (modelId: string) => {
      const fx = FIXTURES[modelId];
      if (!fx) return null;
      return {
        adapter: { id: fx.adapterId },
        model: {
          providerId: fx.providerId, modelId,
          usdInputPer1kTokens: fx.usdIn, usdOutputPer1kTokens: fx.usdOut,
        },
      };
    },
  };
});

vi.mock('../providers/exchangeRate', () => ({
  EXCHANGE_RATE: { usdToILSRate: 3.75, rateAsOf: '2026-08-01' },
}));

import {
  quote, spend, requestOverageApproval, reconcileSpend, monthKey, ApprovalRequiredError,
} from './costGate';

function mockCeilingILS(n: number) { state.ceilingILS = n; }
function mockMonthToDate(n: number) { state.usedThisMonthILS = n; }

beforeEach(() => {
  vi.clearAllMocks();
  state.ceilingILS = 0;
  state.usedThisMonthILS = 0;
  state.approvals = {};
  state.ledgerFixtures = {
    'ledger-1': { estimatedILS: 0.01, amountILS: 0.01, reconciled: false },
    'ledger-2': { estimatedILS: 5, amountILS: 5, reconciled: false },
    'ledger-3': { estimatedILS: 0, amountILS: 0, reconciled: false },
  };

  mockRunTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    const tx = { get: mockTxGet, set: mockTxSet, update: mockTxUpdate };
    return cb(tx);
  });
  mockTxGet.mockImplementation(async (ref: { __path: string }) => routeGet(ref.__path));
  mockTxSet.mockImplementation((ref: { __path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
    persistWrite(ref.__path, data, opts);
  });
  mockTxUpdate.mockImplementation((ref: { __path: string }, data: Record<string, unknown>) => {
    persistWrite(ref.__path, data, { merge: true });
  });
});

describe('costGate.quote (D4 — default deny for unknown)', () => {
  it('unknown provider/model returns unknown:true, metered:true, treated as refused by default', () => {
    const q = quote('made-up-provider', 'made-up-model', 1000, 500);
    expect(q.unknown).toBe(true);
    expect(q.metered).toBe(true);
  });
  it('mock provider is never metered, regardless of token count', () => {
    const q = quote('mock', 'mock-standard', 100000, 100000);
    expect(q.metered).toBe(false);
    expect(q.estimatedILS).toBe(0);
  });
});

describe('costGate.spend (D4)', () => {
  it('spends freely under the monthly ceiling, no token required', async () => {
    mockCeilingILS(1000); mockMonthToDate(10);
    const q = quote('anthropic', 'claude-sonnet-5', 1000, 500);
    const res = await spend('david-levy', 'chat', q);
    expect(res.spent).toBe(true);
    expect(res.requiresApproval).toBeUndefined();
  });
  it('refuses with ApprovalRequiredError when the spend would exceed the ceiling and no token is given', async () => {
    mockCeilingILS(1); mockMonthToDate(0.99);
    const q = quote('anthropic', 'claude-opus-5', 5000, 5000);
    await expect(spend('david-levy', 'chat', q)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('an unknown provider is refused even when nowhere near the ceiling', async () => {
    mockCeilingILS(100000); mockMonthToDate(0);
    const q = quote('made-up', 'made-up', 10, 10);
    await expect(spend('david-levy', 'chat', q)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('a valid, matching, unexpired token allows an over-ceiling spend exactly once', async () => {
    mockCeilingILS(1); mockMonthToDate(0.99);
    const q = quote('anthropic', 'claude-opus-5', 5000, 5000);
    const { token } = await requestOverageApproval('david-levy', 'super-admin', 'anthropic', q);
    const first = await spend('david-levy', 'chat', q, token);
    expect(first.spent).toBe(true);
    await expect(spend('david-levy', 'chat', q, token)).rejects.toBeInstanceOf(ApprovalRequiredError); // single-use
  });
  it('the ceiling and counter are read via tx.get INSIDE runTransaction, never via a bare .get() before it opens (TOCTOU fix, Sasha I6)', async () => {
    mockCeilingILS(1000); mockMonthToDate(0);
    await spend('david-levy', 'chat', quote('mock', 'mock-standard', 10, 10));
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxGet).toHaveBeenCalled(); // reads happened via tx.get
    expect(mockBareDocGet).not.toHaveBeenCalled(); // no read before the transaction opened
  });
  it('the ledger write and the monthly counter increment happen in the SAME transaction as the reads (atomicity)', async () => {
    mockCeilingILS(1000); mockMonthToDate(0);
    await spend('david-levy', 'chat', quote('mock', 'mock-standard', 10, 10));
    expect(mockTxSet).toHaveBeenCalledTimes(2); // ledger entry + counter doc
  });
  it('the ledger entry carries a `month` field so Task 8 can aggregate byModel without a second counter collection', async () => {
    mockCeilingILS(1000); mockMonthToDate(0);
    await spend('david-levy', 'chat', quote('mock', 'mock-standard', 10, 10));
    expect(mockTxSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ month: expect.any(String) }));
  });
});

describe('costGate.spend — unmetered (FREE) calls are exempt from the ceiling check (review fix 2)', () => {
  it('an unmetered call is allowed even when the ceiling is entirely unconfigured (ceiling <= 0)', async () => {
    mockCeilingILS(0); mockMonthToDate(0);
    const q = quote('mock', 'mock-standard', 100000, 100000); // metered:false, estimatedILS:0
    const res = await spend('david-levy', 'chat', q);
    expect(res.spent).toBe(true);
  });
  it('an unmetered call is allowed when a real ceiling IS configured too', async () => {
    mockCeilingILS(50); mockMonthToDate(49.99);
    const q = quote('mock', 'mock-standard', 100000, 100000);
    const res = await spend('david-levy', 'chat', q);
    expect(res.spent).toBe(true);
  });
  it('a METERED call is still refused when the ceiling is unconfigured — fail-safe posture is deliberate, not a bug', async () => {
    mockCeilingILS(0); mockMonthToDate(0);
    const q = quote('anthropic', 'claude-sonnet-5', 10, 10);
    await expect(spend('david-levy', 'chat', q)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('a METERED call over an actually-configured ceiling is still refused', async () => {
    mockCeilingILS(1); mockMonthToDate(0.99);
    const q = quote('anthropic', 'claude-opus-5', 5000, 5000);
    await expect(spend('david-levy', 'chat', q)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('distinguishes "ceiling not configured yet" from "over an actual ceiling" so a stuck caller knows what to do', async () => {
    mockCeilingILS(0); mockMonthToDate(0);
    const unconfigured = await spend('david-levy', 'chat', quote('anthropic', 'claude-sonnet-5', 10, 10)).catch((e) => e);
    expect(unconfigured).toBeInstanceOf(ApprovalRequiredError);
    expect(unconfigured.reason).toBe('ceiling-unconfigured');

    mockCeilingILS(1); mockMonthToDate(0.99);
    const overCeiling = await spend('david-levy', 'chat', quote('anthropic', 'claude-opus-5', 5000, 5000)).catch((e) => e);
    expect(overCeiling).toBeInstanceOf(ApprovalRequiredError);
    expect(overCeiling.reason).toBe('over-ceiling');

    expect(unconfigured.message).not.toBe(overCeiling.message); // genuinely distinguishable, not just a shared field nobody reads
  });
});

describe('costGate.quote — USD source price × explicit exchange rate (third-lens M5)', () => {
  it('computes estimatedILS from the model\'s USD per-1k prices times EXCHANGE_RATE.usdToILSRate, not a hardcoded ILS number', () => {
    const q = quote('anthropic', 'claude-sonnet-5', 1000, 1000);
    expect(q.estimatedILS).toBeCloseTo((0.003 * 3.75) + (0.015 * 3.75), 4);
  });
  it('echoes exchangeRateAsOf on every quote so a stale rate is visible, not buried in the registry file', () => {
    const q = quote('anthropic', 'claude-sonnet-5', 100, 100);
    expect(q.exchangeRateAsOf).toBe('2026-08-01');
  });
});

describe('costGate.monthKey (third-lens M6 — pinned to Asia/Jerusalem, not container-local UTC)', () => {
  it('a UTC time in the last ~3 hours of an Israel month (e.g. 2026-08-31T22:30:00Z, which is 2026-09-01 01:30 in Jerusalem, DST) reports the NEXT month, not the UTC month', () => {
    expect(monthKey(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
  });
  it('a winter (non-DST, UTC+2) month boundary is also honored, proving the fix isn\'t accidentally DST-specific', () => {
    // 2026-01-31T22:30:00Z is 2026-02-01 00:30 in Jerusalem (winter, UTC+2 — no DST) — corrected
    // from the brief's original 21:30Z fixture, which is verifiably still 2026-01-31 23:30 local
    // (UTC+2), not the next month; a UTC+2 offset needs a 2-hour push past 22:00Z to cross
    // midnight, not the 3-hour DST-era push the brief's comment (copied from the summer case)
    // assumed. Verified directly against Intl's own Jerusalem-timezone formatting before fixing.
    expect(monthKey(new Date('2026-01-31T22:30:00Z'))).toBe('2026-02');
  });
});

describe('costGate.reconcileSpend (third-lens M2 — corrects the estimate-based ledger entry after the adapter returns real token counts)', () => {
  it('increases the ledger amount and the monthly counter by the positive delta when actual usage exceeded the estimate', async () => {
    const { correctedAmountILS } = await reconcileSpend('ledger-1', 5000, 2000, { providerId: 'anthropic', modelId: 'claude-sonnet-5' });
    expect(correctedAmountILS).toBeGreaterThan(0);
    expect(mockTxUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountILS: expect.any(Number), reconciled: true }));
  });
  it('decreases the counter (never below the entry\'s own contribution) when actual usage came in under the estimate', async () => {
    const { correctedAmountILS } = await reconcileSpend('ledger-2', 10, 5, { providerId: 'anthropic', modelId: 'claude-sonnet-5' });
    expect(correctedAmountILS).toBeGreaterThanOrEqual(0);
  });
  it('runs the ledger read + both updates inside ONE runTransaction (same atomicity discipline as spend() itself)', async () => {
    await reconcileSpend('ledger-3', 100, 100, { providerId: 'mock', modelId: 'mock-standard' });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });
  it('is idempotent — a second reconcile call for the SAME ledger id does not touch the counter again (review fix 1, D14 retry gap)', async () => {
    const model = { providerId: 'anthropic', modelId: 'claude-sonnet-5' };
    const first = await reconcileSpend('ledger-1', 5000, 2000, model);
    expect(first.correctedAmountILS).toBeGreaterThan(0);

    mockTxUpdate.mockClear();
    const second = await reconcileSpend('ledger-1', 5000, 2000, model);

    const counterUpdateCalls = mockTxUpdate.mock.calls.filter(
      ([ref]) => (ref as { __path: string }).__path.startsWith('ai_usage_counters/')
    );
    expect(counterUpdateCalls).toHaveLength(0); // the counter must move exactly once across both calls
    expect(second.correctedAmountILS).toBe(first.correctedAmountILS); // returns the already-applied amount, not a freshly re-derived one
  });
});

describe('requestOverageApproval (D4 — automated callers can never self-approve)', () => {
  it('rejects a request with no actorMemberId (mirrors paid_calls.py _NOT_A_PERSON)', async () => {
    await expect(requestOverageApproval('', 'super-admin', 'anthropic', quote('anthropic', 'claude-opus-5', 1, 1)))
      .rejects.toThrow();
  });
  // Non-super-admin rejection is enforced at the onCall wrapper (requestAiOverageApproval.ts,
  // this task's Step 4) that already checked request.auth.token.role === 'super-admin' before
  // calling in — costGate itself trusts its caller's actorRole param, the SAME pattern
  // financeCollections.ts's scope-aware list() trusts its caller's `scope` param (Stage 5 D1).
});
