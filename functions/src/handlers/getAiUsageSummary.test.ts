import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same module-boundary-mock convention as aiChat.test.ts/requestAiOverageApproval.test.ts:
// firebase-admin/firestore is mocked (no real Firestore behind it); costGate's monthToDateILS/
// monthKey are mocked too (monthKey pinned to a fixed value so the ai_usage query's `month` arg
// is assertable), but PROVIDER_REGISTRY/EXCHANGE_RATE are REAL — this test wants the actual four
// provider ids and the actual dated exchange rate, not a stand-in.
const { mockDocGet, mockUsageCollectionGet, mockMonthToDateILS, FakeHttpsError } = vi.hoisted(() => {
  class FakeHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    mockDocGet: vi.fn(),
    mockUsageCollectionGet: vi.fn(),
    mockMonthToDateILS: vi.fn(),
    FakeHttpsError,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (fn: unknown) => fn,
  HttpsError: FakeHttpsError,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({ get: async () => mockDocGet(path) }),
    collection: (name: string) => ({
      where: (field: string, op: string, value: unknown) => ({
        get: async () => mockUsageCollectionGet({ name, field, op, value }),
      }),
    }),
  }),
}));

vi.mock('../costGate/costGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../costGate/costGate')>();
  return { ...actual, monthToDateILS: mockMonthToDateILS, monthKey: () => '2026-08' };
});

import { getAiUsageSummary } from './getAiUsageSummary';
import { PROVIDER_REGISTRY } from '../providers/registry'; // REAL, not mocked — see the header note

type FakeRequest = { auth: { token: Record<string, unknown> } | null };
type Response = {
  ceilingILS: number | null;
  ceilingStatus: 'configured' | 'unset' | 'invalid';
  totalUsedThisMonthILS: number;
  byProvider: { providerId: string; usedThisMonthILS: number; callCount: number }[];
  byModel: { modelId: string; providerId: string; usedThisMonthILS: number; callCount: number }[];
  exchangeRate: { usdToILSRate: number; rateAsOf: string };
};
const handler = getAiUsageSummary as unknown as (req: FakeRequest) => Promise<Response>;

const superAdminReq: FakeRequest = { auth: { token: { role: 'super-admin', memberId: 'david-levy' } } };

function usageDoc(data: Record<string, unknown>) {
  return { data: () => data };
}

function emptyUsageSnap() {
  return { forEach: (_cb: (doc: unknown) => void) => {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDocGet.mockResolvedValue({ exists: false, data: () => undefined });
  mockUsageCollectionGet.mockResolvedValue(emptyUsageSnap());
  mockMonthToDateILS.mockResolvedValue(0);
});

describe('getAiUsageSummary onCall handler', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(handler({ auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a non-super-admin caller', async () => {
    await expect(handler({ auth: { token: { role: 'parent', memberId: 'lilit-levy' } } }))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  // Task 8 review F1/F3 — the screen must be able to tell "nobody ever set one" from "someone set
  // ₪0 deliberately" from "the stored value is garbage". Collapsing all three to the number 0 is
  // what let the screen print "no monthly ceiling has been set" while the gate was fully off.
  function ceilingDoc(value: unknown) {
    return async (path: string) =>
      path === 'settings/aiCostConfig'
        ? { exists: true, data: () => ({ monthlyCeilingILS: value }) }
        : { exists: false, data: () => undefined };
  }

  it('reports ceilingStatus "unset" with a null ceiling when settings/aiCostConfig has no ceiling — never a throw (D4)', async () => {
    const res = await handler(superAdminReq);
    expect(res.ceilingStatus).toBe('unset');
    expect(res.ceilingILS).toBeNull();
  });

  it('returns ceilingILS from settings/aiCostConfig when configured', async () => {
    mockDocGet.mockImplementation(ceilingDoc(50));
    const res = await handler(superAdminReq);
    expect(res.ceilingILS).toBe(50);
    expect(res.ceilingStatus).toBe('configured');
  });

  it('a ceiling of 0 is reported as CONFIGURED, not as unset — the F3 contradiction, closed', async () => {
    mockDocGet.mockImplementation(ceilingDoc(0));
    const res = await handler(superAdminReq);
    expect(res.ceilingStatus).toBe('configured');
    expect(res.ceilingILS).toBe(0);
  });

  it('a corrupt stored ceiling is reported as INVALID, so the screen cannot claim no ceiling was set while the gate refuses everything (F1)', async () => {
    for (const bad of ['not a number', -1, Number.MAX_VALUE] as unknown[]) {
      mockDocGet.mockImplementation(ceilingDoc(bad));
      const res = await handler(superAdminReq);
      expect(res.ceilingStatus).toBe('invalid');
      expect(res.ceilingILS).toBeNull();
    }
  });

  it('returns the FAMILY-WIDE month-to-date total the global ceiling is enforced against (F2)', async () => {
    mockMonthToDateILS.mockImplementation(async (providerId: string) =>
      providerId === 'anthropic' ? 12.5 : providerId === 'openai' ? 7.5 : 0);
    const res = await handler(superAdminReq);
    expect(res.totalUsedThisMonthILS).toBe(20);
  });

  // Review of 9ca9eea, F-E — costGate exported a monthToDateAllProvidersILS() whose doc comment
  // said it existed "purely so the settings screen can display the same total the gate enforces",
  // and which had ZERO callers: the equality it claimed to protect was never protected by it. It
  // is deleted, and the property it named is pinned HERE instead — on the handler that actually
  // ships the numbers, where a drift would be visible to a user. The inline reduce is what makes
  // this hold by construction: the headline total is summed from the very array the breakdown
  // rows are rendered from, so the two can never come from two independent reads.
  it('the headline total is exactly the sum of the byProvider rows shown beside it — one computation, not two reads that could drift (F-E)', async () => {
    const perProvider: Record<string, number> = { anthropic: 12.3456, openai: 7.5, google: 0.0004, mock: 0 };
    mockMonthToDateILS.mockImplementation(async (providerId: string) => perProvider[providerId] ?? 0);

    const res = await handler(superAdminReq);

    const sumOfRows = res.byProvider.reduce((n, p) => n + p.usedThisMonthILS, 0);
    expect(res.totalUsedThisMonthILS).toBe(Math.round(sumOfRows * 10000) / 10000);
    expect(res.totalUsedThisMonthILS).toBe(19.846);
    // ...and over exactly the registry's providers, the same set costGate sums the ceiling over.
    expect(res.byProvider.map((p) => p.providerId).sort()).toEqual(Object.keys(PROVIDER_REGISTRY).sort());
  });

  it('aggregates byProvider across all four registry provider ids, including providers with zero calls (never omitted)', async () => {
    mockMonthToDateILS.mockImplementation(async (providerId: string) => (providerId === 'anthropic' ? 12.5 : 0));
    const res = await handler(superAdminReq);
    expect(res.byProvider).toHaveLength(4);
    expect(res.byProvider.map((p) => p.providerId).sort()).toEqual(['anthropic', 'google', 'mock', 'openai']);
    const anthropic = res.byProvider.find((p) => p.providerId === 'anthropic');
    expect(anthropic?.usedThisMonthILS).toBe(12.5);
    const openai = res.byProvider.find((p) => p.providerId === 'openai');
    expect(openai?.usedThisMonthILS).toBe(0);
  });

  it('aggregates ai_usage (filtered by the current month via the SAME imported monthKey) into byModel, summing across multiple entries for the same model', async () => {
    mockUsageCollectionGet.mockResolvedValue({
      forEach: (cb: (doc: unknown) => void) => {
        cb(usageDoc({ modelId: 'claude-sonnet-5', providerId: 'anthropic', amountILS: 1.5 }));
        cb(usageDoc({ modelId: 'claude-sonnet-5', providerId: 'anthropic', amountILS: 2.5 }));
        cb(usageDoc({ modelId: 'claude-opus-5', providerId: 'anthropic', amountILS: 3 }));
      },
    });
    const res = await handler(superAdminReq);
    expect(res.byModel).toEqual(expect.arrayContaining([
      { modelId: 'claude-sonnet-5', providerId: 'anthropic', usedThisMonthILS: 4, callCount: 2 },
      { modelId: 'claude-opus-5', providerId: 'anthropic', usedThisMonthILS: 3, callCount: 1 },
    ]));
    expect(mockUsageCollectionGet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ai_usage', field: 'month', op: '==', value: '2026-08' })
    );
  });

  it('a byProvider entry\'s callCount reflects the SAME byModel aggregation, not a hardcoded 0', async () => {
    mockUsageCollectionGet.mockResolvedValue({
      forEach: (cb: (doc: unknown) => void) => {
        cb(usageDoc({ modelId: 'claude-sonnet-5', providerId: 'anthropic', amountILS: 1 }));
        cb(usageDoc({ modelId: 'claude-sonnet-5', providerId: 'anthropic', amountILS: 1 }));
      },
    });
    const res = await handler(superAdminReq);
    const anthropic = res.byProvider.find((p) => p.providerId === 'anthropic');
    expect(anthropic?.callCount).toBe(2);
  });

  it('returns exchangeRate straight from EXCHANGE_RATE, exact-value match (a future rate edit shows up in this test\'s own diff)', async () => {
    const res = await handler(superAdminReq);
    expect(res.exchangeRate).toEqual({ usdToILSRate: 3.75, rateAsOf: '2026-08-17' });
  });
});
