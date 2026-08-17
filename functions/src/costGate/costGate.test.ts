import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── firebase-admin/firestore mock ──────────────────────────────────────────────
// Admin SDK shape, NOT the client SDK's (`snap.exists` is a boolean property here, never a
// method) — deliberately distinct from financeCollections.test.ts's `firebase/firestore` mock,
// per this task's own convention note. A tiny in-memory store backs the three collections that
// need real read-after-write persistence across calls within one test (the approval token's
// single-use flow, and reconcileSpend's ledger fixtures); the ceiling/counter docs are
// canned via mockCeilingILS/mockMonthToDate instead, since no test needs them to accumulate.
const {
  mockRunTransaction, mockTxGet, mockTxGetAll, mockTxSet, mockTxUpdate, mockTxOpLog,
  mockBareDocGet, mockBareDocSet, mockIncrement, mockServerTimestamp, state,
} = vi.hoisted(() => {
  return {
    mockRunTransaction: vi.fn(),
    mockTxGet: vi.fn(),
    // Review of 9ca9eea, F-G — spend() now issues ONE tx.getAll() instead of Promise.all of five
    // tx.get()s. Modelled separately so the read-set assertions can name the primitive actually
    // used; reconcileSpend still reads via tx.get, so both must exist on the mock transaction.
    mockTxGetAll: vi.fn(),
    mockTxSet: vi.fn(),
    mockTxUpdate: vi.fn(),
    // Ordered log of every transaction operation, so a test can assert the atomicity property the
    // whole cost gate rests on — every READ happens before any WRITE — rather than only that the
    // right documents were touched (Review of 9ca9eea, F-G).
    mockTxOpLog: [] as { op: 'read' | 'write'; path: string }[],
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
      // `unknown` values, not `number` — the SAME reasoning as ceilingRaw above (Task 8 review
      // F1), applied to the counter by the Review of 9ca9eea F-A work. Firestore stores whatever
      // is written, and a corrupt stored totalILS is the one state that could re-run F1's exact
      // failure inside the counter: `Number('abc')` is NaN, every NaN comparison is false, and the
      // ceiling goes fully off. A number-typed fixture cannot express that state.
      counters: {} as Record<string, unknown>,
      approvals: {} as Record<string, Record<string, unknown>>,
      ledgerFixtures: {} as Record<string, Record<string, unknown>>,
    },
  };
});

function counterId(path: string) { return path.slice('ai_usage_counters/'.length); }

/** The stored counter total as a number, for the mock's own arithmetic and for test assertions. */
function counterTotal(id: string): number {
  const v = state.counters[id];
  return typeof v === 'number' ? v : 0;
}

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
    //
    // Review of 9ca9eea, F-A — the two write shapes are now modelled DISTINCTLY, because
    // reconcileSpend switched from FieldValue.increment to a computed absolute total (the
    // non-negative floor needs a read-modify-write; an increment cannot be clamped). Before this
    // fix both shapes were added to the stored value, which would have made an absolute write
    // silently accumulate and hidden the very clamp these tests exist to pin.
    const id = counterId(path);
    const raw = data.totalILS as { __increment?: number } | number | undefined;
    if (typeof raw === 'object' && raw !== null) {
      state.counters[id] = counterTotal(id) + (raw.__increment ?? 0); // FieldValue.increment
    } else if (raw !== undefined) {
      state.counters[id] = Number(raw); // a plain number REPLACES, exactly as Firestore does
    } else if (!(id in state.counters)) {
      state.counters[id] = 0; // set/merge with no totalILS still creates the doc
    }
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
    // Added for the F-B tests (Review of 9ca9eea): proving the counter provider is taken off the
    // LEDGER ENTRY needs a caller passing a genuinely DIFFERENT, genuinely priceable provider —
    // with only anthropic models in this map, any openai argument resolved to an unknown (₪0)
    // quote and the test could not tell "wrote the right counter" apart from "priced nothing".
    'gpt-5.1': { providerId: 'openai', adapterId: 'openai', usdIn: 0.002, usdOut: 0.008 },
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
import { MAX_MONTHLY_CEILING_ILS, type CostQuote, type ApprovalRefusalReason } from './types';

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
  // Review of 9ca9eea, F-A — these now carry `providerId` and `month`, i.e. the shape spend()
  // has ACTUALLY written since the collection's first commit (2fefeb5). They previously modelled
  // the legacy unstamped shape, which reconcileSpend now treats as a no-op — leaving three
  // reconcile tests asserting against a function that had quietly stopped doing anything. An
  // entry deliberately missing `month` lives in the F-A block below, where it is the subject.
  // `modelId` added in batch 5, for the SAME reason batch 4 added `providerId` + `month`: these
  // fixtures must model what spend() actually writes, which stamps providerId, modelId AND month
  // on every ai_usage entry. reconcileSpend now prices off the entry's stamped pair, so a fixture
  // missing modelId would quietly take the caller-argument FALLBACK and these four tests would
  // stop exercising the real path while still passing — the exact vacuity batch 4 caught with the
  // missing `month`. Values match what each test's caller passes, so no expectation moves.
  state.ledgerFixtures = {
    'ledger-1': { providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(), estimatedILS: 0.01, amountILS: 0.01, reconciled: false },
    'ledger-2': { providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(), estimatedILS: 5, amountILS: 5, reconciled: false },
    'ledger-3': { providerId: 'mock', modelId: 'mock-standard', month: monthKey(), estimatedILS: 0, amountILS: 0, reconciled: false },
  };

  mockTxOpLog.length = 0;

  mockRunTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    const tx = { get: mockTxGet, getAll: mockTxGetAll, set: mockTxSet, update: mockTxUpdate };
    return cb(tx);
  });
  mockTxGet.mockImplementation(async (ref: { __path: string }) => {
    mockTxOpLog.push({ op: 'read', path: ref.__path });
    return routeGet(ref.__path);
  });
  // Firestore's real getAll resolves ONE BatchGetDocuments RPC and guarantees the snapshots come
  // back in argument order — the property spend() relies on to destructure the ceiling off the
  // front of the array (Review of 9ca9eea, F-G).
  mockTxGetAll.mockImplementation(async (...refs: { __path: string }[]) => {
    for (const ref of refs) mockTxOpLog.push({ op: 'read', path: ref.__path });
    return refs.map((ref) => routeGet(ref.__path));
  });
  mockTxSet.mockImplementation((ref: { __path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
    mockTxOpLog.push({ op: 'write', path: ref.__path });
    persistWrite(ref.__path, data, opts);
  });
  mockTxUpdate.mockImplementation((ref: { __path: string }, data: Record<string, unknown>) => {
    mockTxOpLog.push({ op: 'write', path: ref.__path });
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
  it('the ceiling and counter are read transactionally INSIDE runTransaction, never via a bare .get() before it opens (TOCTOU fix, Sasha I6)', async () => {
    mockCeilingILS(1000); mockMonthToDate(0);
    await spend('david-levy', 'chat', quote('mock', 'mock-standard', 10, 10));
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxGetAll).toHaveBeenCalled(); // reads happened transactionally (F-G: one getAll, not N gets)
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

  // Review of 9ca9eea, F-F — this test used to be titled "a boolean/array/null ceiling is invalid,
  // never coerced" and assert only `instanceof ApprovalRequiredError`. `null` does NOT resolve to
  // 'invalid'; resolveCeiling maps it to 'unset', deliberately (a missing value is an absent
  // ceiling, not a corrupt one). Both fail closed, so the behaviour was right and only the title
  // lied — but an assertion that passes for either outcome is exactly the shape that lets a title
  // go on lying. Split by the semantic each value actually has, and asserting the REASON, so the
  // test now distinguishes the two instead of merely surviving both.
  it('a boolean or array ceiling is INVALID, never coerced to a number', async () => {
    for (const bad of [true, false, [], ['5'], {}] as unknown[]) {
      mockCeilingILS(bad);
      const err = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
      expect(err).toBeInstanceOf(ApprovalRequiredError);
      expect(err.reason).toBe('ceiling-invalid');
    }
  });

  it('a NULL ceiling is UNSET, not invalid — an absent value is "nobody has set one", a different operator problem from a corrupt one', async () => {
    mockCeilingILS(null);
    const err = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect(err.reason).toBe('ceiling-unconfigured');

    // And the two are genuinely different to the operator, not just different enum values.
    mockCeilingILS('not a number');
    const invalid = await spend('david-levy', 'chat', twelveFifty).catch((e) => e);
    expect(invalid.reason).toBe('ceiling-invalid');
    expect(invalid.message).not.toBe(err.message);
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

    const total = Object.keys(state.counters).reduce((a, id) => a + counterTotal(id), 0);
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
    const readPaths = mockTxOpLog.filter((o) => o.op === 'read').map((o) => o.path);
    for (const providerId of ['mock', 'anthropic', 'openai', 'google']) {
      expect(readPaths).toContain(`ai_usage_counters/${providerId}_${monthKey()}`);
    }
    expect(readPaths).toContain('settings/aiCostConfig');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Review of 9ca9eea, F-G — spend() issued Promise.all of five tx.get()s where tx.getAll is one
// RPC. That is a cost/latency change, and the ONE property it must not weaken is the atomicity
// the whole gate rests on: every document the admission decision depends on is READ, inside the
// transaction, BEFORE anything is written, so Firestore's conflict detection covers all of them.
// Asserted structurally on the ordered op log rather than by racing concurrent spends — the
// property is a property of THIS code's ordering, so a deterministic assertion proves it
// completely, where a concurrency race could pass by luck and still leave it broken.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('costGate.spend — one batched read, and every read still precedes every write (Review of 9ca9eea, F-G)', () => {
  it('reads all five decision documents in a SINGLE tx.getAll, not one round-trip per provider', async () => {
    mockCeilingILS(100);
    await spend('david-levy', 'chat', quote('anthropic', 'claude-sonnet-5', 10, 10));

    expect(mockTxGetAll).toHaveBeenCalledTimes(1);
    expect(mockTxGet).not.toHaveBeenCalled(); // no per-document reads left behind
    const refs = mockTxGetAll.mock.calls[0] as { __path: string }[];
    expect(refs.map((r) => r.__path)).toEqual([
      'settings/aiCostConfig',
      ...['mock', 'anthropic', 'openai', 'google'].map((p) => `ai_usage_counters/${p}_${monthKey()}`),
    ]);
  });

  it('the ceiling snapshot is the FIRST element returned, so batching cannot silently misalign the ceiling with a counter', async () => {
    // If getAll's order guarantee were ignored, spend() would read a counter's totalILS as the
    // ceiling. Pinned behaviourally: ₪1 ceiling, ₪1000 sitting in the mock counter — if the
    // snapshots were misaligned this spend would be admitted against a 1000-ish "ceiling".
    mockCeilingILS(1);
    mockProviderMonthToDate('mock', 1000);
    const err = await spend('david-levy', 'chat', quote('anthropic', 'claude-sonnet-5', 10000, 10000)).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect(err.ceilingILS).toBe(1);
  });

  it('EVERY read precedes EVERY write inside the transaction (the atomicity property the batching must not weaken)', async () => {
    mockCeilingILS(100);
    await spend('david-levy', 'chat', quote('anthropic', 'claude-sonnet-5', 10, 10));

    const ops = mockTxOpLog;
    const firstWrite = ops.findIndex((o) => o.op === 'write');
    const lastRead = ops.map((o) => o.op).lastIndexOf('read');
    expect(firstWrite).toBeGreaterThan(-1); // the spend really did write
    expect(lastRead).toBeLessThan(firstWrite);
  });

  it('reconcileSpend holds the same discipline — its ledger and counter reads both precede its writes', async () => {
    state.ledgerFixtures['ordering'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 10;

    await reconcileSpend('ordering', 1000, 400, { providerId: 'anthropic', modelId: 'claude-sonnet-5' });

    const ops = mockTxOpLog;
    const firstWrite = ops.findIndex((o) => o.op === 'write');
    const lastRead = ops.map((o) => o.op).lastIndexOf('read');
    expect(firstWrite).toBeGreaterThan(-1);
    expect(lastRead).toBeLessThan(firstWrite);
    // Both documents the correction depends on are in the transaction's read set.
    const readPaths = ops.filter((o) => o.op === 'read').map((o) => o.path);
    expect(readPaths).toContain('ai_usage/ordering');
    expect(readPaths).toContain(`ai_usage_counters/anthropic_${monthKey()}`);
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

  it('a ledger entry with no `month` field is a NO-OP — no counter is written, in any month', async () => {
    // Was: "falls back to the current month rather than throwing". That fallback is F-A below —
    // deleted, because guessing a month is what minted the phantom budget.
    state.ledgerFixtures['unstamped'] = { providerId: 'anthropic', estimatedILS: 0.01, amountILS: 0.01, reconciled: false };
    await expect(reconcileSpend('unstamped', 5000, 2000, model)).resolves.toBeTruthy();
    expect(counterWritePaths()).toEqual([]);
  });

  it('the month fix does not break idempotency — a second reconcile into the stamped month is still a no-op', async () => {
    state.ledgerFixtures['crossed-boundary'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: '2026-07',
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    const first = await reconcileSpend('crossed-boundary', 1000, 400, model);
    const afterFirst = counterTotal('anthropic_2026-07');

    const second = await reconcileSpend('crossed-boundary', 1000, 400, model);
    expect(counterTotal('anthropic_2026-07')).toBe(afterFirst); // moved exactly once
    expect(second.correctedAmountILS).toBe(first.correctedAmountILS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Review of 9ca9eea, F-A — the interaction between F7 (reconcile into the STAMPED month) and F2
// (the ceiling is enforced against the SUM of every provider counter). F7's `|| monthKey()`
// fallback plus its tx.set(merge) could CREATE a counter holding a negative total, and F2's sum
// then handed that negative straight back as budget above the configured ceiling.
//
// The first test here is the reviewer's reproduction, run against the pre-fix code before the fix
// was written: it produced ai_usage_counters/anthropic_<now> = -5.6216 and then admitted ₪6
// against a ₪1 ceiling. Both halves are pinned permanently below, because "proven once, guarded
// never" is a named failure class on this project.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('reconcileSpend — a counter total can never go NEGATIVE, i.e. can never mint budget (Review of 9ca9eea, F-A)', () => {
  const model = { providerId: 'anthropic', modelId: 'claude-sonnet-5' };
  const legacyUnstamped = {
    providerId: 'anthropic', modelId: 'claude-sonnet-5', // NO `month` field — the legacy shape
    amountILS: 5.625, estimatedILS: 5.625, reconciled: false,
  };

  it("the reviewer's reproduction: an unstamped entry created anthropic_<now> at totalILS -5.6216 — no counter is created at all now", async () => {
    state.ledgerFixtures['legacy-unstamped'] = { ...legacyUnstamped };
    expect(`anthropic_${monthKey()}` in state.counters).toBe(false);

    await reconcileSpend('legacy-unstamped', 100, 40, model);

    expect(`anthropic_${monthKey()}` in state.counters).toBe(false); // was: -5.6216
  });

  it('the phantom budget is gone: a ₪6 charge is REFUSED against a ₪1 ceiling after that reconcile (it used to be admitted)', async () => {
    state.ledgerFixtures['legacy-unstamped'] = { ...legacyUnstamped };
    await reconcileSpend('legacy-unstamped', 100, 40, model);

    mockCeilingILS(1);
    const err = await spend('david-levy', 'chat', {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', metered: true,
      estimatedILS: 6, unknown: false, exchangeRateAsOf: '2026-08-01',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect(err.reason).toBe('over-ceiling');
    expect(err.usedThisMonthILS).toBe(0); // not -5.6216 worth of headroom
  });

  it('an unstamped entry keeps its ESTIMATE and stays unreconciled — the documented safe failure direction, not a silent correction into a guessed month', async () => {
    state.ledgerFixtures['legacy-unstamped'] = { ...legacyUnstamped };
    const res = await reconcileSpend('legacy-unstamped', 100, 40, model);

    expect(state.ledgerFixtures['legacy-unstamped'].reconciled).toBe(false);
    expect(state.ledgerFixtures['legacy-unstamped'].amountILS).toBe(5.625);
    // Returned to the caller as costILS: the ledger's own figure, never a 0 that would tell the
    // client a paid call was free.
    expect(res.correctedAmountILS).toBe(5.625);
  });

  it('the floor also holds for a properly-stamped entry whose counter is missing — created at 0, never negative', async () => {
    // Defence in depth: with the fallback deleted this needs an out-of-band counter deletion to
    // reach, but the invariant "a cumulative spend total is never negative" should not depend on
    // which entrances happen to be closed this month.
    state.ledgerFixtures['stamped-no-counter'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: '2026-07',
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    expect('anthropic_2026-07' in state.counters).toBe(false);

    await reconcileSpend('stamped-no-counter', 100, 40, model);

    expect(state.counters['anthropic_2026-07']).toBe(0);
    expect(state.ledgerFixtures['stamped-no-counter'].reconciled).toBe(true); // still reconciled, just floored
  });

  it('a negative correction larger than the whole counter floors at 0 rather than going below it', async () => {
    state.ledgerFixtures['over-correct'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 100, estimatedILS: 100, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 1; // inconsistent state: counter never held the 100

    await reconcileSpend('over-correct', 100, 40, model);

    expect(state.counters[`anthropic_${monthKey()}`]).toBe(0);
  });

  it('an ordinary negative correction against a consistent counter is applied in FULL — the floor bites only on inconsistent state', async () => {
    state.ledgerFixtures['normal-under'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 25; // 10 of it is this entry's own estimate

    const { correctedAmountILS } = await reconcileSpend('normal-under', 1000, 400, model);

    expect(correctedAmountILS).toBeCloseTo(0.0338, 3);
    expect(state.counters[`anthropic_${monthKey()}`]).toBeCloseTo(15.0338, 3); // 25 - 10 + 0.0338
  });

  it('a corrupt (non-numeric) stored total reads as 0 rather than NaN — the Task 8 F1 coercion lesson, applied to the counter', async () => {
    state.ledgerFixtures['corrupt-counter'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 'not a number';

    await reconcileSpend('corrupt-counter', 1000, 400, model);

    expect(Number.isNaN(state.counters[`anthropic_${monthKey()}`])).toBe(false);
    expect(state.counters[`anthropic_${monthKey()}`]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Review of 9ca9eea, F-B — F7's own argument, applied to the PROVIDER half of the counter path.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('reconcileSpend — the counter provider comes off the LEDGER ENTRY, not the caller (Review of 9ca9eea, F-B)', () => {
  it("a caller reconciling under a DIFFERENT provider still corrects the entry's own provider counter", async () => {
    // The future shape this guards: a model-fallback or retry that spends under anthropic and
    // reconciles under openai would have subtracted anthropic's estimate from openai's counter,
    // driving openai negative (F-A's phantom) while anthropic kept the full estimate forever.
    state.ledgerFixtures['provider-drift'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 10;
    state.counters[`openai_${monthKey()}`] = 40;

    await reconcileSpend('provider-drift', 1000, 400, { providerId: 'openai', modelId: 'gpt-5.1' });

    expect(state.counters[`openai_${monthKey()}`]).toBe(40);            // untouched

    // Batch 5 — this expectation was 0.0195, the price of the CALLER's openai/gpt-5.1 pair, and
    // was correct only while reconcileSpend still priced off the argument. The correction is now
    // priced from the ENTRY's own pair, so it is anthropic/claude-sonnet-5 money landing on
    // anthropic's counter — identity and price finally agreeing. Derived from quote() rather than
    // re-hardcoded: a literal here is what made the old value outlive the behaviour it described.
    const actual = quote('anthropic', 'claude-sonnet-5', 1000, 400).estimatedILS;
    expect(state.counters[`anthropic_${monthKey()}`]).toBeCloseTo(10 - 10 + actual, 4);
  });

  it("falls back to the caller's providerId only when the entry itself carries none", async () => {
    state.ledgerFixtures['no-provider'] = {
      modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 10;

    await reconcileSpend('no-provider', 1000, 400, { providerId: 'anthropic', modelId: 'claude-sonnet-5' });

    // Same reasoning as above: derived, not hardcoded. The entry carries a modelId but no
    // providerId, so BOTH the counter and the price fall back to the caller's provider.
    const actual = quote('anthropic', 'claude-sonnet-5', 1000, 400).estimatedILS;
    expect(state.counters[`anthropic_${monthKey()}`]).toBeCloseTo(10 - 10 + actual, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 5 — F-B's OWN ARGUMENT, APPLIED TO THE PRICING AXIS.
//
// F-B moved the counter's IDENTITY (provider + month) off the ledger entry rather than the
// caller's argument. The PRICE was left behind: `quote(model.providerId, model.modelId, ...)` ran
// before the transaction even opened, off the caller's argument, and its result became the
// entry's corrected amountILS and the counter's delta.
//
// That is the same class of bug and it fails harder. quote() returns `unknown: true,
// estimatedILS: 0` for any provider/model pair the registry does not hold together, so a
// mismatched reconcile does not merely misprice — it corrects the entry to ZERO and subtracts the
// entry's whole estimate from the counter. A real paid call is recorded as free, and the ceiling
// gets that money back as headroom.
//
// Unreachable today (both call sites pass the pair they spent under), which is exactly what F-A
// was before 9ca9eea added an entrance to it.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('reconcileSpend — the PRICE comes off the ledger entry too, not the caller (batch 5)', () => {
  it('a provider/model pair the registry does not hold together can no longer ZERO the entry', async () => {
    // The failure shape: quote('openai', 'claude-sonnet-5') is unknown → estimatedILS 0.
    state.ledgerFixtures['mismatched'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 10;

    const { correctedAmountILS } = await reconcileSpend('mismatched', 5000, 2000, {
      providerId: 'openai', modelId: 'claude-sonnet-5',
    });

    // Priced from the ENTRY's own anthropic/claude-sonnet-5 pair — a real, nonzero cost.
    expect(correctedAmountILS).toBeGreaterThan(0);
    // And the ledger is not told a paid call was free.
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountILS: correctedAmountILS, actualILS: correctedAmountILS })
    );
    // The counter keeps real money rather than having the whole estimate handed back as headroom.
    expect(counterTotal(`anthropic_${monthKey()}`)).toBeGreaterThan(0);
  });

  it('prices identically whichever pair the caller passes, so long as the entry is stamped', async () => {
    // The property that makes the argument a fallback rather than an input: the caller cannot
    // change what an already-stamped entry costs.
    state.ledgerFixtures['a'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.ledgerFixtures['b'] = {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    const viaRightPair = await reconcileSpend('a', 5000, 2000, { providerId: 'anthropic', modelId: 'claude-sonnet-5' });
    const viaWrongPair = await reconcileSpend('b', 5000, 2000, { providerId: 'openai', modelId: 'gpt-5.1' });
    expect(viaWrongPair.correctedAmountILS).toBe(viaRightPair.correctedAmountILS);
  });

  it("falls back to the caller's pair only when the entry carries no modelId", async () => {
    state.ledgerFixtures['no-model'] = {
      providerId: 'anthropic', month: monthKey(),
      amountILS: 10, estimatedILS: 10, reconciled: false,
    };
    state.counters[`anthropic_${monthKey()}`] = 10;
    const { correctedAmountILS } = await reconcileSpend('no-model', 5000, 2000, {
      providerId: 'anthropic', modelId: 'claude-sonnet-5',
    });
    expect(correctedAmountILS).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 5 — 'unknown-model' HAD NO MESSAGE OF ITS OWN.
//
// ApprovalRequiredError's constructor is a three-branch ternary over four reasons, so
// 'unknown-model' fell through to over-ceiling's string: an operator whose registry and request
// disagree was told to approve a budget overage, which is not the action that fixes it. This is
// F1's exact lie ("a message that names the wrong operator action") in the one place the earlier
// fixes did not reach — and the existing distinctness test compared only two of the four, so
// nothing failed.
//
// The distinctness check below is now over ALL FOUR reasons and PAIRWISE, so no future reason can
// be added by extending the ternary and quietly inheriting a neighbour's copy.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('ApprovalRequiredError — every refusal reason states its OWN operator action (batch 5)', () => {
  const REASONS: ApprovalRefusalReason[] = [
    'over-ceiling', 'ceiling-unconfigured', 'ceiling-invalid', 'unknown-model',
  ];

  function messageFor(reason: ApprovalRefusalReason): string {
    return new ApprovalRequiredError(quote('anthropic', 'claude-sonnet-5', 10, 10), 0, 1, reason).message;
  }

  it('the four reasons carry four PAIRWISE-DISTINCT messages', () => {
    const messages = REASONS.map(messageFor);
    expect(new Set(messages).size).toBe(REASONS.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });

  it('unknown-model no longer borrows over-ceiling\'s copy, and does not tell an operator to approve an overage', () => {
    const unknownModel = messageFor('unknown-model');
    expect(unknownModel).not.toBe(messageFor('over-ceiling'));
    // The wrong action, specifically: nothing about approving a spend. This is a registry/config
    // problem, and an overage approval would not resolve it.
    expect(unknownModel).not.toMatch(/חריגה/);
    // It must name the thing that is actually wrong.
    expect(unknownModel).toMatch(/מודל/);
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
