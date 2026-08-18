// Task 6 (Stage 6) — thin httpsCallable wrapper over listAiModels/aiChat. No provider key of any
// kind lives here — that is the whole point of routing through Cloud Functions (D1/D10). This
// file only proves the wrapper calls the right callable with the right shape and unwraps `.data`.
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(), getFunctions: vi.fn() }));
vi.mock('../services/firebase', () => ({ functions: {} }));

import { httpsCallable } from 'firebase/functions';
import {
  listAiModels, sendChatMessage, extractDocument, getAiUsageSummary, setAiCostCeiling,
  requestAiOverageApproval,
} from '../services/aiClient';

describe('aiClient (thin httpsCallable wrapper, no key of any kind in this file — that is the whole point)', () => {
  it('listAiModels calls the listAiModels callable and unwraps .data.models', async () => {
    const mockCallable = vi.fn(async () => ({ data: { models: [{ modelId: 'mock-standard' }] } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const models = await listAiModels('chat');
    expect(mockCallable).toHaveBeenCalledWith({ action: 'chat' });
    expect(models).toEqual([{ modelId: 'mock-standard' }]);
  });

  it('sendChatMessage calls the aiChat callable, including full history AND filterScope, and unwraps .data', async () => {
    const mockCallable = vi.fn(async () => ({ data: { text: 'שלום', providerId: 'mock', modelId: 'mock-standard', costILS: 0 } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const filterScope = { memberIds: ['omer-levy'], period: { month: '08', year: '2026' } };
    const res = await sendChatMessage({ sessionId: 's1', message: 'שלום', modelId: 'mock-standard', history: [{ role: 'user', text: 'קודם' }], filterScope });
    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ history: [{ role: 'user', text: 'קודם' }], filterScope }));
    expect(res.text).toBe('שלום');
  });

  it('surfaces a resource-exhausted HttpsError (the cost-gate refusal, D4) as a distinguishable error, not a generic failure', async () => {
    const mockCallable = vi.fn(async () => { throw { code: 'functions/resource-exhausted', message: 'נדרש אישור' }; });
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await expect(sendChatMessage({ sessionId: 's1', message: 'שלום', modelId: 'claude-opus-5', history: [], filterScope: { memberIds: null, period: { month: '08', year: '2026' } } }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted' });
  });

  it('surfaces a provider-failure HttpsError (429/timeout/context-overflow, D14) the same distinguishable way as a cost-gate refusal', async () => {
    // NOTE: the brief's own snippet for this test used the regex /עומס/ (ayin-vav-mem-samech,
    // "load"). The actual, already-shipped, already-reviewed copy in
    // functions/src/providers/providerErrors.ts's rate-limited COPY_HE entry is 'עמוס'
    // (ayin-mem-vav-samech, "busy") — a different letter order, confirmed byte-for-byte via the
    // real source file, not assumed. Corrected here to match production, same class of
    // inherited-fixture fix as Task 3's monthKey() DST-boundary correction.
    const mockCallable = vi.fn(async () => { throw { code: 'functions/resource-exhausted', message: 'ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.' }; });
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await expect(sendChatMessage({ sessionId: 's1', message: 'שלום', modelId: 'mock-standard', history: [], filterScope: { memberIds: null, period: { month: '08', year: '2026' } } }))
      .rejects.toMatchObject({ message: expect.stringMatching(/עמוס/) });
  });

  // Task 8 — the two new super-admin-only settings callables.
  it('getAiUsageSummary calls the getAiUsageSummary callable and unwraps .data', async () => {
    const summary = {
      ceilingILS: 50,
      byProvider: [{ providerId: 'mock', usedThisMonthILS: 0, callCount: 0 }],
      byModel: [],
      exchangeRate: { usdToILSRate: 3.75, rateAsOf: '2026-08-17' },
    };
    const mockCallable = vi.fn(async () => ({ data: summary }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const res = await getAiUsageSummary();
    expect(mockCallable).toHaveBeenCalledTimes(1);
    expect(res).toEqual(summary);
  });

  it('setAiCostCeiling calls the setAiCostCeiling callable with the new ceiling', async () => {
    const mockCallable = vi.fn(async () => ({ data: { ok: true } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await setAiCostCeiling(75);
    expect(mockCallable).toHaveBeenCalledWith({ monthlyCeilingILS: 75 });
  });

  it('setAiCostCeiling surfaces a permission-denied HttpsError (a parent attempting to write, D4) verbatim', async () => {
    const mockCallable = vi.fn(async () => { throw { code: 'functions/permission-denied', message: 'רק סופר-אדמין יכול לקבוע את תקרת ה-AI' }; });
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await expect(setAiCostCeiling(10)).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // BATCH 8 (closing review B4) — THE SIXTH CALLABLE.
  //
  // requestAiOverageApproval has existed server-side since Task 3, and this module wrapped FIVE
  // callables without it. That is the client half of why spec §8 shipped its refusal only: the
  // approving call could not be made from the app at all, so hitting the ceiling blocked paid AI
  // permanently with no path forward.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it('requestAiOverageApproval calls the callable with the SERVER\'s own estimate inputs and unwraps .data', async () => {
    const mockCallable = vi.fn(async () => ({ data: { token: 'tok-1', expiresAt: 123, approvedAmountILS: 4.2 } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const res = await requestAiOverageApproval({
      providerId: 'anthropic', modelId: 'claude-sonnet-5',
      estimatedInputTokens: 5000, estimatedOutputTokens: 400,
    });
    // Token COUNTS, never a ₪ amount: the server re-derives the money from these, so a client can
    // never widen what an approval is worth by editing a number in a request body.
    expect(mockCallable).toHaveBeenCalledWith({
      providerId: 'anthropic', modelId: 'claude-sonnet-5',
      estimatedInputTokens: 5000, estimatedOutputTokens: 400,
    });
    expect(res).toEqual({ token: 'tok-1', expiresAt: 123, approvedAmountILS: 4.2 });
  });

  it('requestAiOverageApproval surfaces the parent/member permission-denied refusal verbatim, never swallowed', async () => {
    // The UI must never offer this control to a non-super-admin, but the server is the boundary
    // and its Hebrew refusal has to reach the screen if it is ever reached anyway.
    const mockCallable = vi.fn(async () => { throw { code: 'functions/permission-denied', message: 'רק סופר-אדמין יכול לאשר חריגה מהתקרה' }; });
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await expect(requestAiOverageApproval({ providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedInputTokens: 1, estimatedOutputTokens: 1 }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('sendChatMessage forwards an approvalToken when one is supplied, and omits the key when it is not', async () => {
    const mockCallable = vi.fn(async () => ({ data: { text: 'ok', providerId: 'anthropic', modelId: 'claude-sonnet-5', costILS: 4 } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const base = { sessionId: 's1', message: 'שלום', modelId: 'claude-sonnet-5', history: [], filterScope: { memberIds: null, period: { month: '08', year: '2026' } } };

    await sendChatMessage({ ...base, approvalToken: 'tok-9' });
    expect(mockCallable).toHaveBeenLastCalledWith(expect.objectContaining({ approvalToken: 'tok-9' }));

    await sendChatMessage(base);
    // The KEY is absent, not present-and-undefined: an explicit `approvalToken: undefined` still
    // serialises into a callable payload, and "no token" is what an ordinary call means.
    expect(mockCallable).toHaveBeenLastCalledWith(expect.not.objectContaining({ approvalToken: expect.anything() }));
  });

  it('extractDocument forwards an approvalToken too — the two spending callables stay symmetric', async () => {
    // "A fix applied to one of two symmetric callers is half a fix" is this stage's own standing
    // lesson (batch 6's B1). Both handlers spend; both must be redeemable.
    const mockCallable = vi.fn(async () => ({ data: { analysis: {}, providerId: 'google', modelId: 'gemini-3-flash-preview', costILS: 1 } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await extractDocument({
      fileBase64: 'AAAA', mimeType: 'application/pdf', familyMembers: [],
      modelId: 'gemini-3-flash-preview', approvalToken: 'tok-doc',
    });
    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ approvalToken: 'tok-doc' }));
  });
});
