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

  it('super-admin gets back a token, an expiry AND the amount the token was minted for', async () => {
    // Batch 8 (closing review B4) — approvedAmountILS is the SERVER's own re-derivation of what
    // the echoed token counts cost, so the approving screen can state the figure that was actually
    // authorised. The client never sends a ₪ amount; it echoes the estimate INPUTS the refusal
    // handed it, and quote() turns those into money here.
    const res = await handler(makeRequest());
    expect(res).toEqual({ token: 'tok-abc', expiresAt: 999999, approvedAmountILS: 1.23 });
  });

  // Batch 8 (closing review B4) — bd97326 refused to let an overage token override a
  // 'counter-corrupt' refusal, on the grounds that you cannot authorise an amount against a
  // balance nobody can read. This is the same rule one step earlier: you cannot MINT an approval
  // for a call nobody can price. quote() returns unknown/₪0 for a pair the registry does not hold
  // together, so minting would produce a token authorising only a ₪0 call — granted-looking,
  // unredeemable, and consumed on first use regardless.
  it('refuses to mint an approval for a pair the registry cannot price, instead of minting a ₪0 one', async () => {
    mockQuote.mockReturnValue({
      providerId: 'anthropic', modelId: 'retired-model', metered: true,
      estimatedILS: 0, unknown: true, exchangeRateAsOf: '2026-08-01',
    });
    await expect(handler(makeRequest())).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringMatching(/אינם מוכרים למערכת/),
    });
    expect(mockRequestOverageApproval).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE THIRD DESTRUCTURE OF request.data, and the one where the missing shape guard does
  // something worse than crash.
  //
  // The `q.unknown` refusal directly above exists because YOU CANNOT MINT AN APPROVAL FOR AN
  // AMOUNT NOBODY CAN STATE. A non-numeric token count walks straight past it: quote() prices a
  // KNOWN pair, so `unknown` is false, and the arithmetic yields estimatedILS: NaN. That mints a
  // real, single-use token bound to NaN — consumeApproval's `amount <= NaN` is false, so it is
  // granted-looking, unredeemable, and burned on first use. Exactly the state bd97326 and the
  // test above were written to make unreachable, reached by a different door.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('request shape guard — the third destructure of request.data', () => {
    const expectBadShape = async (data: unknown) => {
      const err = await handler({
        auth: { token: { role: 'super-admin', memberId: 'david-levy' } }, data,
      } as FakeRequest).catch((e) => e);
      expect(err).toBeInstanceOf(FakeHttpsError);
      expect(err.code).toBe('invalid-argument');
      expect(err.message).toMatch(/[֐-׿]/);
      // NO TOKEN WAS MINTED. This is the assertion that matters: a refusal that happens after
      // requestOverageApproval has already written a doc is not a refusal.
      expect(mockRequestOverageApproval).not.toHaveBeenCalled();
      // And nothing was PRICED either — quote() is where the NaN was manufactured.
      expect(mockQuote).not.toHaveBeenCalled();
      return err;
    };

    it('refuses non-numeric token counts instead of minting a token bound to NaN', async () => {
      // quote() is mocked to a PRICEABLE pair on purpose, so `unknown` cannot be what refuses —
      // the cheap-for-expensive trap this stage has already been caught by.
      await expectBadShape({ providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedOutputTokens: 50 });
      vi.clearAllMocks();
      mockQuote.mockReturnValue({
        providerId: 'anthropic', modelId: 'claude-sonnet-5', metered: true,
        estimatedILS: 1.23, unknown: false, exchangeRateAsOf: '2026-08-01',
      });
      await expectBadShape({
        providerId: 'anthropic', modelId: 'claude-sonnet-5',
        estimatedInputTokens: 'רבים', estimatedOutputTokens: 50,
      });
    });

    it('refuses non-finite and negative token counts — NaN/Infinity price to NaN/Infinity, a negative count to a negative ceiling', async () => {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        vi.clearAllMocks();
        mockQuote.mockReturnValue({
          providerId: 'anthropic', modelId: 'claude-sonnet-5', metered: true,
          estimatedILS: 1.23, unknown: false, exchangeRateAsOf: '2026-08-01',
        });
        await expectBadShape({
          providerId: 'anthropic', modelId: 'claude-sonnet-5',
          estimatedInputTokens: bad, estimatedOutputTokens: 50,
        });
      }
    });

    it('refuses a missing or non-string providerId/modelId before quote() is even asked', async () => {
      await expectBadShape({ modelId: 'claude-sonnet-5', estimatedInputTokens: 1, estimatedOutputTokens: 1 });
      vi.clearAllMocks();
      await expectBadShape({ providerId: 7, modelId: 'claude-sonnet-5', estimatedInputTokens: 1, estimatedOutputTokens: 1 });
    });

    it('refuses a request with no data payload at all', async () => {
      await expectBadShape(undefined);
      vi.clearAllMocks();
      await expectBadShape(null);
    });

    // CONTROLS.
    it('still mints for a well-formed request', async () => {
      const res = await handler(makeRequest());
      expect(res).toEqual({ token: 'tok-abc', expiresAt: 999999, approvedAmountILS: 1.23 });
    });

    it('zero token counts are a legitimate estimate, not a malformed one', async () => {
      await expect(handler(makeRequest({
        data: { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedInputTokens: 0, estimatedOutputTokens: 0 },
      }))).resolves.toBeDefined();
    });
  });
});
