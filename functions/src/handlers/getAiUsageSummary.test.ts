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

type FakeRequest = { auth: { token: Record<string, unknown> } | null };
type Response = {
  ceilingILS: number;
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

  it('returns ceilingILS: 0 when settings/aiCostConfig is unset — a valid, maximally-restrictive state, not a throw (D4)', async () => {
    const res = await handler(superAdminReq);
    expect(res.ceilingILS).toBe(0);
  });

  it('returns ceilingILS from settings/aiCostConfig when configured', async () => {
    mockDocGet.mockImplementation(async (path: string) =>
      path === 'settings/aiCostConfig' ? { exists: true, data: () => ({ monthlyCeilingILS: 50 }) } : { exists: false, data: () => undefined }
    );
    const res = await handler(superAdminReq);
    expect(res.ceilingILS).toBe(50);
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
