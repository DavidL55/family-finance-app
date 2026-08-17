import { beforeEach, describe, expect, it, vi } from 'vitest';

// onCall wrapped handlers aren't directly invokable without the emulator runtime — mocking
// 'firebase-functions/v2/https' so onCall(fn) just returns fn keeps this a pure unit test of the
// handler's own auth/role/argument-trust logic (D4's I7 fix), same spirit as this project's other
// module-boundary mocks (financeCollections.test.ts's firebase/firestore mock, costGate.test.ts's
// firebase-admin/firestore mock).
const { mockRequestOverageApproval, mockQuote, FakeHttpsError } = vi.hoisted(() => {
  class FakeHttpsError extends Error {
    code: string;
    details?: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return {
    mockRequestOverageApproval: vi.fn(),
    mockQuote: vi.fn(),
    FakeHttpsError,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (fn: unknown) => fn,
  HttpsError: FakeHttpsError,
}));

vi.mock('../costGate/costGate', () => ({
  requestOverageApproval: mockRequestOverageApproval,
  quote: mockQuote,
}));

import { requestAiOverageApproval } from './requestAiOverageApproval';

type FakeRequest = {
  auth: { token: Record<string, unknown> } | null;
  data: Record<string, unknown>;
};

const handler = requestAiOverageApproval as unknown as (req: FakeRequest) => Promise<{ token: string; expiresAt: number }>;

function makeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    auth: { token: { role: 'super-admin', memberId: 'david-levy' } },
    data: { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedInputTokens: 100, estimatedOutputTokens: 50 },
    ...overrides,
  };
}

describe('requestAiOverageApproval onCall handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuote.mockReturnValue({
      providerId: 'anthropic', modelId: 'claude-sonnet-5', metered: true,
      estimatedILS: 1.23, unknown: false, exchangeRateAsOf: '2026-08-01',
    });
    mockRequestOverageApproval.mockResolvedValue({ token: 'tok-abc', expiresAt: 999999 });
  });

  it('rejects an unauthenticated request', async () => {
    await expect(handler(makeRequest({ auth: null }))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockRequestOverageApproval).not.toHaveBeenCalled();
  });

  it('rejects a non-super-admin caller even if request.data claims otherwise', async () => {
    const req = makeRequest({
      auth: { token: { role: 'parent', memberId: 'lilit-levy' } },
      data: { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedInputTokens: 1, estimatedOutputTokens: 1, role: 'super-admin' },
    });
    await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockRequestOverageApproval).not.toHaveBeenCalled();
  });

  it('never trusts a client-supplied actor id — uses request.auth.token.memberId, not request.data', async () => {
    const req = makeRequest({
      auth: { token: { role: 'super-admin', memberId: 'real-super-admin' } },
      data: {
        providerId: 'anthropic', modelId: 'claude-sonnet-5',
        estimatedInputTokens: 10, estimatedOutputTokens: 10,
        actorMemberId: 'spoofed-someone-else', memberId: 'spoofed-someone-else',
      },
    });
    await handler(req);
    expect(mockRequestOverageApproval).toHaveBeenCalledWith(
      'real-super-admin', 'super-admin', 'anthropic', expect.anything()
    );
  });

  it('super-admin gets back a token + expiresAt', async () => {
    const res = await handler(makeRequest());
    expect(res).toEqual({ token: 'tok-abc', expiresAt: 999999 });
  });
});
