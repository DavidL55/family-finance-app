import { beforeEach, describe, expect, it, vi } from 'vitest';

// Module-boundary mocking convention — identical to aiChat.test.ts (Task 5): the registry and
// costGate are mocked, ApprovalRequiredError is the REAL class (via importOriginal) so
// `instanceof` inside aiExtractDocument.ts keeps working. There is no buildFinancialContext,
// chat_sessions, or filterScope here — extraction has no chat context or session to build (Task 7
// brief's own note), so this file mocks strictly less than aiChat.test.ts does.
const { mockGetAdapterForModel, mockQuote, mockSpend, mockReconcileSpend, mockGenerateJson, FakeHttpsError } =
  vi.hoisted(() => {
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
      mockGetAdapterForModel: vi.fn(),
      mockQuote: vi.fn(),
      mockSpend: vi.fn(),
      mockReconcileSpend: vi.fn(),
      mockGenerateJson: vi.fn(),
      FakeHttpsError,
    };
  });

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (fn: unknown) => fn,
  HttpsError: FakeHttpsError,
}));

vi.mock('../providers/registry', () => ({
  getAdapterForModel: mockGetAdapterForModel,
}));

vi.mock('../costGate/costGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../costGate/costGate')>();
  return { ...actual, quote: mockQuote, spend: mockSpend, reconcileSpend: mockReconcileSpend };
});

import { aiExtractDocument, MAX_DOCUMENT_BASE64_BYTES, EXTRACTION_OUTPUT_TOKEN_ESTIMATE } from './aiExtractDocument';
import { ApprovalRequiredError } from '../costGate/costGate';

type FakeRequest = {
  auth: { token: Record<string, unknown> } | null;
  data: Record<string, unknown>;
};

const handler = aiExtractDocument as unknown as (
  req: FakeRequest
) => Promise<{ analysis: unknown; providerId: string; modelId: string; costILS: number }>;
const invokeAiExtractDocument = (req: FakeRequest) => handler(req);

const superAdminAuth = { token: { role: 'super-admin', memberId: 'david-levy' } };
const memberAuth = (role: string) => ({ token: { role, memberId: 'omer-levy' } });

const baseExtractData = {
  fileBase64: 'AAAA',
  mimeType: 'application/pdf',
  familyMembers: ['דויד'],
  modelId: 'mock-standard',
};

const CANNED_ANALYSIS = { documentType: 'invoice', issuer: 'ספק', accountId: '0000', periodStart: '2026-01-01', periodEnd: '2026-01-31', owner: null, totalAmount: 0, currency: 'ILS', transactions: [] };

function makeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return { auth: superAdminAuth, data: baseExtractData, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdapterForModel.mockReturnValue({
    ok: true,
    adapter: { id: 'mock', isConfigured: () => true, generateText: vi.fn(), generateJson: mockGenerateJson },
    model: { providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה', defaultForActions: ['extraction'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 },
  });
  mockQuote.mockReturnValue({ providerId: 'mock', modelId: 'mock-standard', metered: false, estimatedILS: 0, unknown: false, exchangeRateAsOf: '2026-08-17' });
  mockSpend.mockResolvedValue({ spent: true, amountILS: 0, ceilingILS: 100, usedThisMonthILS: 0, ledgerId: 'ledger-1' });
  mockReconcileSpend.mockResolvedValue({ correctedAmountILS: 0 });
  mockGenerateJson.mockResolvedValue({ text: JSON.stringify(CANNED_ANALYSIS), inputTokens: 100, outputTokens: 50 });
});

describe('aiExtractDocument onCall handler', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(invokeAiExtractDocument(makeRequest({ auth: null }))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it('rejects a signed-in caller with no known role claim (Sasha W10, same guard as aiChat)', async () => {
    await expect(invokeAiExtractDocument(makeRequest({ auth: { token: { memberId: 'x' } } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized model id before touching the cost gate', async () => {
    mockGetAdapterForModel.mockReturnValue({ ok: false, reason: 'unknown-model', messageHe: 'מודל לא מוכר' });
    await expect(invokeAiExtractDocument(makeRequest())).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it('asks the registry for an EXTRACTION-tagged model — the action is not left to the caller', async () => {
    await invokeAiExtractDocument(makeRequest());
    expect(mockGetAdapterForModel).toHaveBeenCalledWith('mock-standard', 'extraction');
  });

  it('calls spend() with the "extraction" action', async () => {
    await invokeAiExtractDocument(makeRequest());
    expect(mockSpend).toHaveBeenCalledWith('david-levy', 'extraction', expect.anything(), undefined);
  });

  it('spends against the VERIFIED caller memberId from the token, for any known role — never a client-supplied id', async () => {
    await invokeAiExtractDocument({ auth: memberAuth('member'), data: baseExtractData });
    expect(mockSpend).toHaveBeenCalledWith('omer-levy', 'extraction', expect.anything(), undefined);
  });

  it('returns the analysis alongside providerId/modelId/costILS, same shape as aiChat', async () => {
    const res = await invokeAiExtractDocument(makeRequest());
    expect(res.analysis).toEqual(CANNED_ANALYSIS);
    expect(res.providerId).toBe('mock');
    expect(res.modelId).toBe('mock-standard');
    expect(typeof res.costILS).toBe('number');
  });

  it('passes the document as an attachment (mimeType + base64Data), not as plain prompt text', async () => {
    await invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, fileBase64: 'ZmFrZQ==', mimeType: 'image/png' } }));
    expect(mockGenerateJson).toHaveBeenCalledWith(expect.objectContaining({
      attachment: { mimeType: 'image/png', base64Data: 'ZmFrZQ==' },
    }));
  });

  it('sends the extraction prompt as a single user message — no history parameter on this request shape', async () => {
    await invokeAiExtractDocument(makeRequest());
    const call = mockGenerateJson.mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe('user');
    expect(typeof call.messages[0].text).toBe('string');
  });

  it('rethrows a cost-gate ApprovalRequiredError as HttpsError("resource-exhausted", ...) — never lets onCall redact it to "internal" (D4 fix, same as aiChat)', async () => {
    const q = { providerId: 'google', modelId: 'gemini-3-flash-preview', metered: true, estimatedILS: 5, unknown: false, exchangeRateAsOf: '2026-08-17' };
    mockSpend.mockRejectedValueOnce(new ApprovalRequiredError(q, 10, 5));
    await expect(invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, modelId: 'gemini-3-flash-preview' } })))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockGenerateJson).not.toHaveBeenCalled();
  });

  // Batch 8 (closing review B4) — the extraction half of spec §8's redemption path. Same three
  // properties as aiChat's, because these two handlers are the only two that reach a provider and
  // "a fix applied to one of two symmetric callers is half a fix" is this stage's standing lesson.
  describe('overage approval redemption (closing review B4)', () => {
    it('threads the request\'s approvalToken into spend()', async () => {
      await invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, approvalToken: 'tok-doc' } }));
      expect(mockSpend).toHaveBeenCalledWith('david-levy', 'extraction', expect.anything(), 'tok-doc');
    });

    it('passes undefined — never a placeholder string — when the caller sends no token', async () => {
      await invokeAiExtractDocument(makeRequest());
      expect(mockSpend).toHaveBeenCalledWith('david-levy', 'extraction', expect.anything(), undefined);
    });

    it('the over-ceiling refusal carries the SERVER\'s own token estimates for this exact document', async () => {
      const q = { providerId: 'google', modelId: 'gemini-3-flash-preview', metered: true, estimatedILS: 5, unknown: false, exchangeRateAsOf: '2026-08-17' };
      mockSpend.mockRejectedValueOnce(new ApprovalRequiredError(q, 10, 5, 'over-ceiling'));
      const err = await invokeAiExtractDocument(makeRequest()).catch((e) => e);
      expect(err.code).toBe('resource-exhausted');
      const details = err.details as { estimatedInputTokens: number; estimatedOutputTokens: number };
      expect(details.estimatedOutputTokens).toBe(EXTRACTION_OUTPUT_TOKEN_ESTIMATE);
      expect(details.estimatedInputTokens).toBeGreaterThan(0);
      expect(mockQuote).toHaveBeenCalledWith(
        'mock', 'mock-standard', details.estimatedInputTokens, details.estimatedOutputTokens
      );
    });
  });

  describe('aiExtractDocument — pre-flight size guard (D17)', () => {
    it('rejects a fileBase64 over MAX_DOCUMENT_BASE64_BYTES with a Hebrew "המסמך גדול מדי" HttpsError, BEFORE quote()/spend()/any adapter call', async () => {
      const oversized = 'A'.repeat(MAX_DOCUMENT_BASE64_BYTES + 1);
      await expect(invokeAiExtractDocument({ auth: superAdminAuth, data: { fileBase64: oversized, mimeType: 'application/pdf', familyMembers: [], modelId: 'mock-standard' } }))
        .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/גדול מדי/) });
      expect(mockQuote).not.toHaveBeenCalled();
      expect(mockSpend).not.toHaveBeenCalled();
      expect(mockGenerateJson).not.toHaveBeenCalled();
    });

    it('accepts a fileBase64 at or under the limit and proceeds normally', async () => {
      const ok = 'A'.repeat(1000);
      const res = await invokeAiExtractDocument({ auth: superAdminAuth, data: { fileBase64: ok, mimeType: 'application/pdf', familyMembers: [], modelId: 'mock-standard' } });
      expect(res.analysis).toBeDefined();
    });

    it('accepts a fileBase64 at EXACTLY the limit (boundary is inclusive)', async () => {
      const exact = 'A'.repeat(MAX_DOCUMENT_BASE64_BYTES);
      await expect(invokeAiExtractDocument({ auth: superAdminAuth, data: { fileBase64: exact, mimeType: 'application/pdf', familyMembers: [], modelId: 'mock-standard' } }))
        .resolves.toBeDefined();
    });
  });

  describe('aiExtractDocument — provider-error wrapping + spend reconciliation (D14, mirrors aiChat.ts)', () => {
    it("wraps the adapter's generateJson call and rethrows a provider failure via toAiHttpsError, never a plain Error", async () => {
      mockGenerateJson.mockRejectedValueOnce({ status: 400, message: 'maximum context length exceeded' });
      await expect(invokeAiExtractDocument(makeRequest({ data: baseExtractData })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/גדול מדי|ארוך מדי/) });
    });

    it('a malformed (non-JSON) generateJson response is also translated, never a raw SyntaxError', async () => {
      mockGenerateJson.mockResolvedValueOnce({ text: 'not json at all', inputTokens: 10, outputTokens: 5 });
      await expect(invokeAiExtractDocument(makeRequest())).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mockReconcileSpend).not.toHaveBeenCalled();
    });

    it("calls reconcileSpend with the adapter's REAL token counts after a successful extraction (same pattern as aiChat.ts)", async () => {
      mockSpend.mockResolvedValueOnce({ spent: true, amountILS: 0.2, ceilingILS: 100, usedThisMonthILS: 0.2, ledgerId: 'ledger-doc-1' });
      mockGenerateJson.mockResolvedValueOnce({ text: '{"transactions":[]}', inputTokens: 4200, outputTokens: 310 });
      await invokeAiExtractDocument(makeRequest({ data: baseExtractData }));
      expect(mockReconcileSpend).toHaveBeenCalledWith('ledger-doc-1', 4200, 310, expect.objectContaining({ providerId: 'mock', modelId: 'mock-standard' }));
    });

    it('a failed adapter call never calls reconcileSpend — the estimate stands, deliberately (D14)', async () => {
      mockGenerateJson.mockRejectedValueOnce({ status: 429 });
      await expect(invokeAiExtractDocument(makeRequest())).rejects.toBeDefined();
      expect(mockReconcileSpend).not.toHaveBeenCalled();
    });
  });

  // Task 7 review, Important 1 — WASTED SPEND ON AN UNTAGGED MODEL.
  //
  // Every other test in this file mocks getAdapterForModel, which is exactly why this gap could
  // exist unnoticed: the mock always handed back a well-tagged model. These tests deliberately run
  // the handler against the REAL registry (vi.importActual) so the model catalog's own
  // defaultForActions tags are the thing under test, not a fixture's idea of them. The tag was
  // enforced ONLY client-side (ModelPicker's listConfiguredModels(action)); a direct callable
  // invocation with a chat-only model id reached the adapter — for a PDF, OpenAI's adapter sends
  // only its disclosed-gap text note, so no real document ever reaches the model — and spend()
  // still ran. Real money for an answer with nothing behind it.
  describe('server-side action-tag enforcement (real registry, no getAdapterForModel mock)', () => {
    beforeEach(async () => {
      const actual = await vi.importActual<typeof import('../providers/registry')>('../providers/registry');
      mockGetAdapterForModel.mockImplementation(actual.getAdapterForModel);
    });

    it('refuses a chat-only model id (gpt-5.1) for extraction BEFORE quote()/spend()/any adapter call', async () => {
      await expect(invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, modelId: 'gpt-5.1' } })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(/ניתוח מסמכים/) });
      // The load-bearing assertion: no money moves for a request that cannot succeed — the same
      // guard-before-spend ordering D17's size guard follows.
      expect(mockQuote).not.toHaveBeenCalled();
      expect(mockSpend).not.toHaveBeenCalled();
      expect(mockGenerateJson).not.toHaveBeenCalled();
    });

    it('still accepts a genuinely extraction-tagged model id from the real registry', async () => {
      await expect(invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, modelId: 'mock-standard' } })))
        .resolves.toBeDefined();
      expect(mockSpend).toHaveBeenCalledWith('david-levy', 'extraction', expect.anything(), undefined);
    });

    it('still refuses a model id that is in no provider catalog at all, with different copy', async () => {
      await expect(invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, modelId: 'made-up-model-9000' } })))
        .rejects.toMatchObject({ code: 'invalid-argument', message: 'מודל לא מוכר' });
      expect(mockSpend).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE SYMMETRIC HALF of aiChat's request-shape gap. The acceptance re-measure named
  // aiChat.ts:74 only; this handler destructures request.data the same way and then reads
  // `fileBase64.length` with no check at all, one line later.
  //
  // The non-string case is the WORSE of the two and is not merely a crash: `.length` on a number
  // is `undefined`, `undefined > MAX_DOCUMENT_BASE64_BYTES` is FALSE, so a non-string payload
  // walks straight PAST D17's size guard, makes estIn NaN, and reaches spend(). The guard that
  // exists specifically to stop an oversized document from costing anything is bypassed by
  // sending the wrong TYPE rather than too many bytes.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('request shape guard (the symmetric half of aiChat\'s gap)', () => {
    const expectBadShape = async (data: unknown) => {
      const err = await invokeAiExtractDocument({ auth: superAdminAuth, data } as FakeRequest).catch((e) => e);
      expect(err).toBeInstanceOf(FakeHttpsError);
      expect(err.code).toBe('invalid-argument');
      expect(err.message).toMatch(/[֐-׿]/);
      // NOT the oversized-document copy: "you sent the wrong shape" and "your file is too big"
      // are different problems, and D17's message names a fix that would not help here.
      expect(err.message).not.toMatch(/גדול מדי/);
      expect(mockQuote).not.toHaveBeenCalled();
      expect(mockSpend).not.toHaveBeenCalled();
      expect(mockGenerateJson).not.toHaveBeenCalled();
      return err;
    };

    it('refuses an omitted `fileBase64` instead of throwing an unhandled TypeError out of the D17 size check', async () => {
      const { fileBase64: _omitted, ...withoutFile } = baseExtractData;
      await expectBadShape(withoutFile);
    });

    it('refuses a NON-STRING `fileBase64`, which used to walk past the D17 size guard and reach spend()', async () => {
      await expectBadShape({ ...baseExtractData, fileBase64: 12345 });
    });

    it('refuses a missing or non-string `mimeType` — it is handed to the adapter as the attachment type', async () => {
      const { mimeType: _omitted, ...withoutMime } = baseExtractData;
      await expectBadShape(withoutMime);
      vi.clearAllMocks();
      await expectBadShape({ ...baseExtractData, mimeType: { pdf: true } });
    });

    it('refuses a `familyMembers` that is not an array of strings — it is JSON.stringify\'d straight into the prompt', async () => {
      await expectBadShape({ ...baseExtractData, familyMembers: 'דויד' });
      vi.clearAllMocks();
      await expectBadShape({ ...baseExtractData, familyMembers: ['דויד', 7] });
    });

    it('refuses an `approvalToken` of the wrong type — forwarded verbatim into consumeApproval', async () => {
      await expectBadShape({ ...baseExtractData, approvalToken: 12345 });
    });

    it('refuses a request with no data payload at all', async () => {
      await expectBadShape(undefined);
      vi.clearAllMocks();
      await expectBadShape(null);
    });

    // CONTROLS — an unconditional throw would pass every case above.
    it('still accepts the well-formed request', async () => {
      await expect(invokeAiExtractDocument(makeRequest())).resolves.toBeDefined();
      expect(mockSpend).toHaveBeenCalledWith('david-levy', 'extraction', expect.anything(), undefined);
    });

    it('an OMITTED familyMembers is still allowed — `familyMembers ?? []` was already deliberate', async () => {
      // The handler has always tolerated this; the new guard must not quietly tighten a contract
      // it was only asked to make honest.
      const { familyMembers: _omitted, ...withoutMembers } = baseExtractData;
      await expect(invokeAiExtractDocument({ auth: superAdminAuth, data: withoutMembers })).resolves.toBeDefined();
    });

    it('an EMPTY familyMembers array and an empty fileBase64 are still accepted', async () => {
      await expect(invokeAiExtractDocument(makeRequest({ data: { ...baseExtractData, familyMembers: [], fileBase64: '' } })))
        .resolves.toBeDefined();
    });
  });
});
