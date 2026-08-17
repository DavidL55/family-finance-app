import { beforeEach, describe, expect, it, vi } from 'vitest';

// Module-boundary mocks, same convention as requestAiOverageApproval.test.ts /
// costGate.test.ts. buildFinancialContext and the provider registry are fully mocked (no real
// Firestore/adapter behind them); costGate's quote/spend/reconcileSpend are mocked but
// ApprovalRequiredError is the REAL class (via importOriginal) so `instanceof` inside aiChat.ts
// keeps working. promptSafety runs for REAL — it's pure and cheap, and the wrapping assertions
// below need its real output to mean anything.
const {
  mockBuildFinancialContext, mockGetAdapterForModel, mockQuote, mockSpend, mockReconcileSpend,
  mockGenerateText, mockDoc, mockSet, FakeHttpsError,
} = vi.hoisted(() => {
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
    mockBuildFinancialContext: vi.fn(),
    mockGetAdapterForModel: vi.fn(),
    mockQuote: vi.fn(),
    mockSpend: vi.fn(),
    mockReconcileSpend: vi.fn(),
    mockGenerateText: vi.fn(),
    mockDoc: vi.fn(),
    mockSet: vi.fn(),
    FakeHttpsError,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (fn: unknown) => fn,
  HttpsError: FakeHttpsError,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      mockDoc(path);
      return { set: mockSet };
    },
  }),
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp__',
    arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
  },
}));

vi.mock('../context/buildFinancialContext', () => ({
  buildFinancialContext: mockBuildFinancialContext,
}));

vi.mock('../providers/registry', () => ({
  getAdapterForModel: mockGetAdapterForModel,
}));

vi.mock('../costGate/costGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../costGate/costGate')>();
  return { ...actual, quote: mockQuote, spend: mockSpend, reconcileSpend: mockReconcileSpend };
});

import { aiChat, MAX_CHAT_HISTORY_TURNS, MAX_CHAT_HISTORY_BYTES } from './aiChat';
import { ApprovalRequiredError } from '../costGate/costGate';

type FakeRequest = {
  auth: { token: Record<string, unknown> } | null;
  data: Record<string, unknown>;
};

const handler = aiChat as unknown as (req: FakeRequest) => Promise<{ text: string; providerId: string; modelId: string; costILS: number }>;
const invokeAiChat = (req: FakeRequest) => handler(req);

const NO_FILTER = { memberIds: null, period: { month: '08', year: '2026' } };
const baseData = { sessionId: 's1', message: 'שלום', modelId: 'mock-standard', history: [], filterScope: NO_FILTER };

const superAdminAuth = { token: { role: 'super-admin', memberId: 'david-levy' } };
const memberAuth = (role: string) => ({ token: { role, memberId: 'omer-levy' } });

const NO_FACTS_CTX = { scope: 'family', filterScope: NO_FILTER, totalMonthlyExpense: null, totalMonthlyIncome: null, netWorth: null };

function makeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return { auth: superAdminAuth, data: baseData, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildFinancialContext.mockResolvedValue(NO_FACTS_CTX);
  mockGetAdapterForModel.mockReturnValue({
    ok: true,
    adapter: { id: 'mock', isConfigured: () => true, generateText: mockGenerateText, generateJson: vi.fn() },
    model: { providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה', defaultForActions: ['chat'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 },
  });
  mockQuote.mockReturnValue({ providerId: 'mock', modelId: 'mock-standard', metered: false, estimatedILS: 0, unknown: false, exchangeRateAsOf: '2026-08-17' });
  mockSpend.mockResolvedValue({ spent: true, amountILS: 0, ceilingILS: 100, usedThisMonthILS: 0, ledgerId: 'ledger-1' });
  mockReconcileSpend.mockResolvedValue({ correctedAmountILS: 0 });
  mockGenerateText.mockResolvedValue({ text: 'תשובה לדוגמה', inputTokens: 10, outputTokens: 5 });
});

describe('aiChat onCall handler', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(invokeAiChat(makeRequest({ auth: null }))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockBuildFinancialContext).not.toHaveBeenCalled();
  });

  it('rejects a signed-in caller with no known role claim (Sasha W10 — an unprovisioned account cannot burn shared budget)', async () => {
    await expect(invokeAiChat(makeRequest({ auth: { token: { memberId: 'x' } } }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized model id before touching the cost gate', async () => {
    mockGetAdapterForModel.mockReturnValue({ ok: false, reason: 'unknown-model', messageHe: 'מודל לא מוכר' });
    await expect(invokeAiChat(makeRequest())).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it('asks the registry for a CHAT-tagged model — the action is not left to the caller', async () => {
    await invokeAiChat(makeRequest());
    expect(mockGetAdapterForModel).toHaveBeenCalledWith('mock-standard', 'chat');
  });

  it('passes the VERIFIED request.auth.token.role AND the resolved filterScope straight through to buildFinancialContext — never re-derives either', async () => {
    const filterScope = { memberIds: ['omer-levy'], period: { month: '08', year: '2026' } };
    await invokeAiChat({ auth: memberAuth('member'), data: { ...baseData, filterScope } });
    expect(mockBuildFinancialContext).toHaveBeenCalledWith('omer-levy', 'member', filterScope);
  });

  it('states the filtered scope (member selection + period) in the system prompt, in Hebrew, including the period-not-applied disclosure (D16, third-lens M3)', async () => {
    mockBuildFinancialContext.mockResolvedValue({
      ...NO_FACTS_CTX,
      filterScope: { memberIds: ['omer-levy'], period: { month: '03', year: '2026' } },
    });
    await invokeAiChat(makeRequest({ data: { ...baseData, filterScope: { memberIds: ['omer-levy'], period: { month: '03', year: '2026' } } } }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringMatching(/03\/2026/),
    }));
  });

  it('wraps ONLY the server-assembled context as <external_data> — the user\'s own message is sent UNWRAPPED (D6 scoping fix, Sasha I5)', async () => {
    mockBuildFinancialContext.mockResolvedValue({
      ...NO_FACTS_CTX,
      totalMonthlyExpense: { value: 1200, source: 'recurring', asOf: '2026-08-17' },
    });
    await invokeAiChat(makeRequest({ data: { ...baseData, message: 'מה ההוצאות שלנו?' } }));
    const call = mockGenerateText.mock.calls[0][0];
    expect(call.systemPrompt).toContain('<external_data>');
    expect(call.systemPrompt).toContain('1200');
    const lastMessage = call.messages[call.messages.length - 1];
    expect(lastMessage.text).toBe('מה ההוצאות שלנו?');
    expect(lastMessage.text).not.toContain('<external_data>');
  });

  it('passes prior turns from `history` into the adapter\'s messages array — actually used now, not discarded (D3/Sun A2 fix)', async () => {
    const history = [{ role: 'user' as const, text: 'מה ההוצאות שלנו?' }, { role: 'model' as const, text: '₪1200 לחודש' }];
    await invokeAiChat(makeRequest({ data: { ...baseData, message: 'ומה ההכנסות?', history } }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ text: 'מה ההוצאות שלנו?' }),
        expect.objectContaining({ text: '₪1200 לחודש' }),
        expect.objectContaining({ text: 'ומה ההכנסות?' }),
      ]),
    }));
    // oldest-first, ending with the current turn
    const messages = mockGenerateText.mock.calls[0][0].messages;
    expect(messages[messages.length - 1].text).toBe('ומה ההכנסות?');
  });

  it('returns the provider/model actually used, for the "נענה על-ידי X" badge (D5)', async () => {
    const res = await invokeAiChat(makeRequest());
    expect(res.providerId).toBe('mock');
    expect(res.modelId).toBe('mock-standard');
  });

  it('persists the turn to chat_sessions/{memberId}/sessions/{sessionId}, keyed by the VERIFIED caller memberId (Sun W9 fix)', async () => {
    await invokeAiChat(makeRequest());
    expect(mockDoc).toHaveBeenCalledWith('chat_sessions/david-levy/sessions/s1');
    expect(mockSet).toHaveBeenCalled();
  });

  it('a permission-scoped context of scope "none" still answers, politely refusing financial specifics (spec §4 scenario 6)', async () => {
    mockBuildFinancialContext.mockResolvedValue({ scope: 'none', filterScope: NO_FILTER, totalMonthlyExpense: null, totalMonthlyIncome: null, netWorth: null });
    await invokeAiChat(makeRequest());
    const call = mockGenerateText.mock.calls[0][0];
    expect(call.systemPrompt).toMatch(/אין הרשאה|סרב/);
    // The shared injection-defense rule always EXPLAINS what <external_data> tags mean (it's a
    // fixed suffix on every system prompt) — what must NOT happen for a scope:'none' context is
    // that any actual context JSON gets wrapped and embedded, since there is none to disclose.
    expect(call.systemPrompt).not.toContain('"scope":"none"');
  });

  it('rethrows a cost-gate ApprovalRequiredError as HttpsError("resource-exhausted", ...) — never lets onCall redact it to "internal" (D4 fix, Sasha I4)', async () => {
    const q = { providerId: 'anthropic', modelId: 'claude-opus-5', metered: true, estimatedILS: 5, unknown: false, exchangeRateAsOf: '2026-08-17' };
    mockSpend.mockRejectedValueOnce(new ApprovalRequiredError(q, 10, 5));
    await expect(invokeAiChat(makeRequest({ data: { ...baseData, modelId: 'claude-opus-5' } })))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('propagates ApprovalRequiredError\'s distinguishable `reason` into distinguishable Hebrew messages — "no ceiling configured" must not read the same as "over budget"', async () => {
    const q = { providerId: 'anthropic', modelId: 'claude-opus-5', metered: true, estimatedILS: 5, unknown: false, exchangeRateAsOf: '2026-08-17' };
    mockSpend.mockRejectedValueOnce(new ApprovalRequiredError(q, 0, 0, 'ceiling-unconfigured'));
    const unconfigured = await invokeAiChat(makeRequest()).catch((e) => e);
    mockSpend.mockRejectedValueOnce(new ApprovalRequiredError(q, 10, 5, 'over-ceiling'));
    const overCeiling = await invokeAiChat(makeRequest()).catch((e) => e);
    expect(unconfigured.message).not.toBe(overCeiling.message);
    expect(unconfigured.message).toMatch(/טרם הוגדרה/);
    expect(overCeiling.message).toMatch(/חריגה/);
    expect(overCeiling.message).not.toMatch(/טרם הוגדרה/);
  });

  it('wraps the adapter call and rethrows a provider failure via toAiHttpsError, never as a plain Error onCall would redact to "internal" (third-lens M2/D14)', async () => {
    mockGenerateText.mockRejectedValueOnce({ status: 429 });
    await expect(invokeAiChat(makeRequest()))
      .rejects.toMatchObject({ code: 'resource-exhausted', message: expect.stringMatching(/עומס|נסה שוב/) });
  });

  it('calls reconcileSpend with the ADAPTER\'S REAL token counts (not the pre-call estimate) after a successful call, using the ledgerId spend() returned (third-lens M2/D14)', async () => {
    mockSpend.mockResolvedValueOnce({ spent: true, amountILS: 0.5, ceilingILS: 100, usedThisMonthILS: 0.5, ledgerId: 'ledger-xyz' });
    mockGenerateText.mockResolvedValueOnce({ text: 'תשובה', inputTokens: 812, outputTokens: 143 });
    await invokeAiChat(makeRequest());
    expect(mockReconcileSpend).toHaveBeenCalledWith('ledger-xyz', 812, 143, expect.objectContaining({ providerId: 'mock', modelId: 'mock-standard' }));
  });

  it('a failed adapter call never calls reconcileSpend — the estimate stands, deliberately (D14)', async () => {
    mockGenerateText.mockRejectedValueOnce({ status: 429 });
    await expect(invokeAiChat(makeRequest())).rejects.toBeDefined();
    expect(mockReconcileSpend).not.toHaveBeenCalled();
  });

  // Fix 1 (review follow-up, Important) — history was previously unconstrained: no protection on
  // the always-free mock path, no guard against blowing the model's context window before the
  // pre-call cost estimate would catch it, and no protection for the unbounded arrayUnion write
  // into chat_sessions against Firestore's 1MB document ceiling. Two independent caps (D17 shape,
  // same as aiExtractDocument's MAX_DOCUMENT_BASE64_BYTES): a turn-count cap (guards against many
  // TINY turns inflating chat_sessions via per-message JSON-key overhead even when total text is
  // small) and a total-byte cap measured in UTF-8 bytes, not JS string length (guards against a
  // few HUGE turns blowing the context window / Firestore ceiling even when turn count is small;
  // byte-measured because this app is Hebrew-first and Hebrew chars are 2 bytes in UTF-8, so
  // char-length would undercount the real payload).
  describe('history size limits (Fix 1)', () => {
    it('allows history at exactly MAX_CHAT_HISTORY_TURNS turns', async () => {
      const history = Array.from({ length: MAX_CHAT_HISTORY_TURNS }, (_, i) => ({
        role: (i % 2 === 0 ? ('user' as const) : ('model' as const)), text: `הודעה ${i}`,
      }));
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, history } }))).resolves.toBeDefined();
    });

    it('rejects history over MAX_CHAT_HISTORY_TURNS turns with an actionable Hebrew invalid-argument HttpsError, before buildFinancialContext/spend', async () => {
      const history = Array.from({ length: MAX_CHAT_HISTORY_TURNS + 1 }, (_, i) => ({
        role: (i % 2 === 0 ? ('user' as const) : ('model' as const)), text: `הודעה ${i}`,
      }));
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, history } })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/ארוכה מדי|שיחה חדשה/) });
      expect(mockBuildFinancialContext).not.toHaveBeenCalled();
      expect(mockSpend).not.toHaveBeenCalled();
    });

    it('allows history at exactly MAX_CHAT_HISTORY_BYTES total UTF-8 bytes (well under the turn cap)', async () => {
      // one giant turn, at exactly the byte cap (Hebrew char 'א' is 2 bytes in UTF-8)
      const text = 'א'.repeat(MAX_CHAT_HISTORY_BYTES / 2);
      const history = [{ role: 'user' as const, text }];
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, history } }))).resolves.toBeDefined();
    });

    it('rejects history over MAX_CHAT_HISTORY_BYTES total UTF-8 bytes even with only a couple of turns, before buildFinancialContext/spend', async () => {
      const text = 'א'.repeat(Math.ceil(MAX_CHAT_HISTORY_BYTES / 2) + 1);
      const history = [{ role: 'user' as const, text }];
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, history } })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/ארוכה מדי|שיחה חדשה/) });
      expect(mockBuildFinancialContext).not.toHaveBeenCalled();
      expect(mockSpend).not.toHaveBeenCalled();
    });

    it('rejects an oversized history even on the always-free mock model — the cap is unconditional, not gated behind the cost estimate', async () => {
      const history = Array.from({ length: MAX_CHAT_HISTORY_TURNS + 1 }, (_, i) => ({
        role: (i % 2 === 0 ? ('user' as const) : ('model' as const)), text: `הודעה ${i}`,
      }));
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, modelId: 'mock-standard', history } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('a chat_sessions write that fails (e.g. Firestore document-size ceiling) does not crash an already-successful, already-billed answer — it is caught and the answer is still returned', async () => {
      mockSet.mockRejectedValueOnce(new Error('Firestore: the value of property "messages" exceeds the maximum allowed size'));
      const res = await invokeAiChat(makeRequest());
      expect(res.text).toBe('תשובה לדוגמה');
      expect(mockSet).toHaveBeenCalled();
    });
  });

  // Task 7 review, Important 1 — the same pre-existing gap aiExtractDocument had: getAdapterForModel
  // matched by modelId across the WHOLE registry and ignored defaultForActions, so a direct callable
  // invocation could hand an extraction-only model id to chat and still reach quote()/spend(). Run
  // against the REAL registry (vi.importActual) so the catalog's own tags are what is under test,
  // not a fixture's idea of them — which is exactly why the gap survived a mocked-registry suite.
  describe('server-side action-tag enforcement (real registry, no getAdapterForModel mock)', () => {
    beforeEach(async () => {
      const actual = await vi.importActual<typeof import('../providers/registry')>('../providers/registry');
      mockGetAdapterForModel.mockImplementation(actual.getAdapterForModel);
    });

    it('refuses an extraction-only model id (gemini-3-flash-preview) for chat BEFORE quote()/spend()/any adapter call', async () => {
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, modelId: 'gemini-3-flash-preview' } })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/צ׳אט/) });
      expect(mockQuote).not.toHaveBeenCalled();
      expect(mockSpend).not.toHaveBeenCalled();
      expect(mockGenerateText).not.toHaveBeenCalled();
      // Also proves the guard runs before the context read, so no Firestore work is wasted either.
      expect(mockBuildFinancialContext).not.toHaveBeenCalled();
    });

    it('still accepts a genuinely chat-tagged model id from the real registry', async () => {
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, modelId: 'mock-standard' } }))).resolves.toBeDefined();
      expect(mockSpend).toHaveBeenCalledWith('david-levy', 'chat', expect.anything());
    });

    it('still refuses a model id that is in no provider catalog at all, with different copy', async () => {
      await expect(invokeAiChat(makeRequest({ data: { ...baseData, modelId: 'made-up-model-9000' } })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: 'מודל לא מוכר' });
      expect(mockSpend).not.toHaveBeenCalled();
    });
  });
});
