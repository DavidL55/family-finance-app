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
      // `unknown`, not `number` (Task 8 review F1): Rules place no schema constraint on this doc
      // before this fix, so a super-admin client-SDK setDoc can put a STRING here. A number-typed
      // fixture could not express the state that actually broke the gate.
      ceilingRaw: 0 as unknown,
      ceilingFieldPresent: true,
      // Keyed by the FULL counter doc id (`${providerId}_${month}`), and a key's PRESENCE means
      // the doc exists — both are load-bearing: F2 needs per-provider totals to be independent,
      // and F7's second-order case needs "this month's counter does not exist yet" to be a state
      // the mock can actually represent (see mockTxUpdate's NOT_FOUND below).
      counters: {} as Record<string, number>,
      approvals: {} as Record<string, Record<string, unknown>>,
      ledgerFixtures: {} as Record<string, Record<string, unknown>>,
    },
  };
});

function counterId(path: string) { return path.slice('ai_usage_counters/'.length); }

function routeGet(path: string) {
  if (path === 'settings/aiCostConfig') {
    return {
      exists: true,
      data: () => (state.ceilingFieldPresent ? { monthlyCeilingILS: state.ceilingRaw } : {}),
    };
  }
  if (path.startsWith('ai_usage_counters/')) {
    const id = counterId(path);
    return id in state.counters
      ? { exists: true, data: () => ({ totalILS: state.counters[id] }) }
      : { exists: false, data: () => undefined };
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
  if (path.startsWith('ai_usage_counters/')) {
    // Counters ACCUMULATE for real (Task 8 review F2): the global-ceiling tests spend on one
    // provider and then on another, and the second spend must read back what the first actually
    // wrote — a spy-only counter could not reproduce "₪25 admitted against a ₪20 ceiling".
    const id = counterId(path);
    const raw = data.totalILS as { __increment?: number } | number | undefined;
    const inc = typeof raw === 'object' && raw !== null ? (raw.__increment ?? 0) : Number(raw ?? 0);
    state.counters[id] = (state.counters[id] ?? 0) + inc;
  }
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
    // Task 8 review F2 — spend() now sums EVERY provider's counter inside its transaction to
    // enforce one family-wide ceiling, so it needs the provider list from the registry.
    listProviderIds: () => ['mock', 'anthropic', 'openai', 'google'],
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
import { MAX_MONTHLY_CEILING_ILS, type CostQuote } from './types';

// `unknown`, not `number` — see state.ceilingRaw. A test must be able to store the exact garbage
// a client-SDK setDoc could put there before Rules validated the shape (Task 8 review F1).
function mockCeilingILS(n: unknown) { state.ceilingFieldPresent = true; state.ceilingRaw = n; }
/** No `monthlyCeilingILS` field at all — the genuinely UNSET state (Task 8 review F3). */
function mockCeilingUnset() { state.ceilingFieldPresent = false; state.ceilingRaw = undefined; }
function mockProviderMonthToDate(providerId: string, n: number) {
  state.counters[`${providerId}_${monthKey()}`] = n;
}
/** Back-compat helper for the pre-existing tests, all of which spend on anthropic or mock. */
function mockMonthToDate(n: number) { mockProviderMonthToDate('anthropic', n); }

beforeEach(() => {
  vi.clearAllMocks();
  state.ceilingFieldPresent = true;
  state.ceilingRaw = 0;
  state.counters = {};
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
    // Firestore's REAL tx.update behaviour: it fails on a document that does not exist. Modelled
    // here because that is exactly the second-order half of Task 8 review F7 — reconciling into a
    // month whose counter doc was never created aborts the whole reconcile.
    if (!routeGet(ref.__path).exists) {
      throw new Error(`NOT_FOUND: no document to update: ${ref.__path}`);
    }
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
  it('an unmetered call is allowed even when the ceiling is entirely unconfigured (no field at all)', async () => {
    mockCeilingUnset(); mockMonthToDate(0);
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
    mockCeilingUnset(); mockMonthToDate(0);
    const q = quote('anthropic', 'claude-sonnet-5', 10, 10);
    await expect(spend('david-levy', 'chat', q)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('a METERED call over an actually-configured ceiling is still refused', async () => {
    mockCeilingILS(1); mockMonthToDate(0.99);
    const q = quote('anthropic', 'claude-opus-5', 5000, 5000);
    await expect(spend('david-levy', 'chat', q)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('distinguishes "ceiling not configured yet" from "over an actual ceiling" so a stuck caller knows what to do', async () => {
    mockCeilingUnset(); mockMonthToDate(0);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F1 — a non-numeric ceiling used to FAIL OPEN and disable the gate entirely.
// Reproduces the reviewer's probe result specifically before asserting the fix.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('costGate.spend — a CORRUPT stored ceiling fails CLOSED (Task 8 review F1)', () => {
  // The exact quote from the reviewer's probe: ₪12.50, metered, a real registry model.
  const twelveFifty: CostQuote = {
    providerId: 'anthropic', modelId: 'claude-sonnet-5', metered: true,
    estimatedILS: 12.5, unknown: false, exchangeRateAsOf: '2026-08-01',
  };

  it("the reviewer's probe: a STRING ceiling admitted a ₪12.50 charge with ₪999,999 already spent — now REFUSED", async () => {
    mockCeilingILS('not a number');
    mockProviderMonthToDate('anthropic', 999999);
    const err = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    // The precise failure it replaces: `NaN <= 0` is false and `used + est > NaN` is false, so
    // wouldExceed came out false and the charge went through with the gate fully off.
    expect(state.counters[`anthropic_${monthKey()}`]).toBe(999999); // nothing was added
  });

  it('refuses with the DISTINCT `ceiling-invalid` reason — a corrupt value is not the same operator problem as an unset one', async () => {
    mockCeilingILS('not a number');
    const invalid = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(invalid.reason).toBe('ceiling-invalid');

    mockCeilingUnset();
    const unset = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(unset.reason).toBe('ceiling-unconfigured');

    // Not distinguishable only by a field nobody reads — the copy differs too, because the fix
    // for each is different ("re-save the ceiling" vs "set one for the first time").
    expect(invalid.message).not.toBe(unset.message);
  });

  it('a NEGATIVE stored ceiling is invalid too, not silently treated as "unset"', async () => {
    mockCeilingILS(-1);
    const err = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect(err.reason).toBe('ceiling-invalid');
  });

  it('a stored ceiling above the maximum is invalid (the same bound the callable and Rules enforce)', async () => {
    mockCeilingILS(MAX_MONTHLY_CEILING_ILS + 1);
    const err = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(err.reason).toBe('ceiling-invalid');
  });

  it('a boolean/array/null ceiling is invalid, never coerced', async () => {
    for (const bad of [true, [], null] as unknown[]) {
      mockCeilingILS(bad);
      const err = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
      expect(err).toBeInstanceOf(ApprovalRequiredError);
    }
  });

  it('the FREE-call exemption survives a corrupt ceiling — a zero-cost mock call is still never blocked', async () => {
    mockCeilingILS('not a number');
    const res = await spend('david-levy', 'chat', quote('mock', 'mock-standard', 100000, 100000));
    expect(res.spent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F3 — ONE semantic for 0: a valid, configured, maximally-restrictive ceiling.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('costGate.spend — a ceiling of 0 is CONFIGURED and blocks paid calls (Task 8 review F3)', () => {
  it('refuses a metered call with `over-ceiling`, NOT "the ceiling has not been configured yet"', async () => {
    mockCeilingILS(0);
    const err = await spend('david-levy', 'chat', quote('anthropic', 'claude-sonnet-5', 10, 10)).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect(err.reason).toBe('over-ceiling'); // the person who just set it is not told it is unset
    expect(err.ceilingILS).toBe(0);
  });

  it('a super-admin overage token can still authorise a spend against a deliberate ₪0 ceiling', async () => {
    mockCeilingILS(0);
    const q = quote('anthropic', 'claude-sonnet-5', 10, 10);
    const { token } = await requestOverageApproval('david-levy', 'super-admin', 'anthropic', q);
    const res = await spend('david-levy', 'chat', q, token);
    expect(res.spent).toBe(true);
  });

  it('free mock calls are unaffected by a ₪0 ceiling (the exemption, again)', async () => {
    mockCeilingILS(0);
    const res = await spend('david-levy', 'chat', quote('mock', 'mock-standard', 100000, 100000));
    expect(res.spent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F2 — ONE family-wide ceiling, not one ceiling per provider.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('costGate.spend — the ceiling is enforced GLOBALLY across all providers (Task 8 review F2)', () => {
  const twelveFifty = (providerId: string, modelId: string): CostQuote => ({
    providerId, modelId, metered: true, estimatedILS: 12.5, unknown: false, exchangeRateAsOf: '2026-08-01',
  });

  it("the reviewer's probe: ₪12.50 on anthropic THEN ₪12.50 on openai used to total ₪25 against a ₪20 ceiling — the second is now REFUSED", async () => {
    mockCeilingILS(20);
    const first = await spend('david-levy', 'chat', twelveFifty('anthropic', 'claude-sonnet-5'));
    expect(first.spent).toBe(true);

    const second = await spend('david-levy', 'chat', twelveFifty('openai', 'gpt-5.1')).catch((e) => e);
    expect(second).toBeInstanceOf(ApprovalRequiredError);
    expect(second.reason).toBe('over-ceiling');

    const total = Object.values(state.counters).reduce((a, b) => a + b, 0);
    expect(total).toBe(12.5); // NOT 25 — the family-wide total never crossed the ₪20 ceiling
  });

  it('the refusal reports the FAMILY-WIDE total spent, not the refused provider\'s own (which is still ₪0)', async () => {
    mockCeilingILS(20);
    mockProviderMonthToDate('anthropic', 12.5);
    const err = await spend('david-levy', 'chat', twelveFifty('openai', 'gpt-5.1')).catch((e) => e);
    expect(err.usedThisMonthILS).toBe(12.5);
  });

  it('a successful spend also reports the family-wide running total, so the caller sees the number the gate enforces', async () => {
    mockCeilingILS(100);
    mockProviderMonthToDate('anthropic', 30);
    mockProviderMonthToDate('google', 20);
    const res = await spend('david-levy', 'chat', twelveFifty('openai', 'gpt-5.1'));
    expect(res.usedThisMonthILS).toBe(62.5); // 30 + 20 + 12.5
  });

  it('per-provider counters are STILL written separately, so the byProvider breakdown display keeps working', async () => {
    mockCeilingILS(100);
    await spend('david-levy', 'chat', twelveFifty('anthropic', 'claude-sonnet-5'));
    await spend('david-levy', 'chat', twelveFifty('openai', 'gpt-5.1'));
    expect(state.counters[`anthropic_${monthKey()}`]).toBe(12.5);
    expect(state.counters[`openai_${monthKey()}`]).toBe(12.5);
  });

  it('EVERY provider counter is read inside the SAME transaction as the decision — no bare .get() reopens the TOCTOU race the global sum widened', async () => {
    mockCeilingILS(100);
    await spend('david-levy', 'chat', twelveFifty('anthropic', 'claude-sonnet-5'));
    expect(mockBareDocGet).not.toHaveBeenCalled();
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    const readPaths = mockTxGet.mock.calls.map(([ref]) => (ref as { __path: string }).__path);
    for (const providerId of ['mock', 'anthropic', 'openai', 'google']) {
      expect(readPaths).toContain(`ai_usage_counters/${providerId}_${monthKey()}`);
    }
    expect(readPaths).toContain('settings/aiCostConfig');
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
    mockTxSet.mockClear();
    const second = await reconcileSpend('ledger-1', 5000, 2000, model);

    // Counts writes of EITHER kind (Task 8 review F7 changed the counter write from tx.update to
    // tx.set/merge) — a mechanism-specific assertion here would have gone quietly vacuous.
    const counterWrites = [...mockTxUpdate.mock.calls, ...mockTxSet.mock.calls].filter(
      ([ref]) => (ref as { __path: string }).__path.startsWith('ai_usage_counters/')
    );
    expect(counterWrites).toHaveLength(0); // the counter must move exactly once across both calls
    expect(second.correctedAmountILS).toBe(first.correctedAmountILS); // returns the already-applied amount, not a freshly re-derived one
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F7 — reconcile must correct the month the spend was STAMPED with, not the month
// the response happened to land in. Root defect is Task 3's; Task 8's screen made it visible.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('reconcileSpend — corrects the month the spend was STAMPED with (Task 8 review F7)', () => {
  const model = { providerId: 'anthropic', modelId: 'claude-sonnet-5' };

  function counterWritePaths(): string[] {
    return [...mockTxUpdate.mock.calls, ...mockTxSet.mock.calls]
      .map(([ref]) => (ref as { __path: string }).__path)
      .filter((p) => p.startsWith('ai_usage_counters/'));
  }

  it("the reviewer's probe: a ledger entry stamped month=2026-07 corrected `anthropic_<now>` — it now corrects `anthropic_2026-07`", async () => {
    state.ledgerFixtures['crossed-boundary'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: '2026-07',
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters['anthropic_2026-07'] = 10;

    await reconcileSpend('crossed-boundary', 1000, 400, model);

    expect(counterWritePaths()).toEqual(['ai_usage_counters/anthropic_2026-07']);
    // The whole point: byProvider (counter) and byModel (ledger) now agree about which month this
    // call belongs to, instead of disagreeing permanently in BOTH months.
    expect(counterWritePaths()[0]).not.toContain(monthKey());
  });

  it('a counter doc that does not exist for the stamped month is CREATED, not an aborted reconcile', async () => {
    // Firestore's tx.update throws NOT_FOUND on a missing doc (the mock models this) — with the
    // month fix alone, a reconcile into a month with no counter yet would abort entirely, leaving
    // the ledger permanently unreconciled. tx.set/merge is what makes the fix safe.
    state.ledgerFixtures['no-counter-yet'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: '2026-07',
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    expect('anthropic_2026-07' in state.counters).toBe(false);

    await expect(reconcileSpend('no-counter-yet', 1000, 400, model)).resolves.toBeTruthy();
    expect(state.ledgerFixtures['no-counter-yet'].reconciled).toBe(true);
    expect('anthropic_2026-07' in state.counters).toBe(true);
  });

  it('a legacy ledger entry with no `month` field falls back to the current month rather than throwing', async () => {
    // state.ledgerFixtures['ledger-1'] carries no month field.
    await expect(reconcileSpend('ledger-1', 5000, 2000, model)).resolves.toBeTruthy();
    expect(counterWritePaths()).toEqual([`ai_usage_counters/anthropic_${monthKey()}`]);
  });

  it('the month fix does not break idempotency — a second reconcile into the stamped month is still a no-op', async () => {
    state.ledgerFixtures['crossed-boundary'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: '2026-07',
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    const first = await reconcileSpend('crossed-boundary', 1000, 400, model);
    const afterFirst = state.counters['anthropic_2026-07'];

    const second = await reconcileSpend('crossed-boundary', 1000, 400, model);
    expect(state.counters['anthropic_2026-07']).toBe(afterFirst); // moved exactly once
    expect(second.correctedAmountILS).toBe(first.correctedAmountILS);
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
