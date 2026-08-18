// Task 6 (Stage 6) — useAiChat wraps aiClient.sendChatMessage, mirrors Dashboard's existing
// handleSendMessage shape (optimistic user message, then the reply), and is the client half of
// two design decisions: D3/Sun A2 (full `messages` history is now genuinely sent, not dropped)
// and D16/third-lens M3 (filterScope is read fresh from useGlobalFilters() on every send(), never
// captured once at mount).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAiChat, AI_REFUSAL_MESSAGES_HE } from '../hooks/useAiChat';
import { AI_OVERAGE_APPROVAL_FAILED_HE } from '../config/aiOverage';

const { mockSendChatMessage, mockListAiModels, mockUseGlobalFilters, mockRequestApproval } = vi.hoisted(() => ({
  mockSendChatMessage: vi.fn(),
  mockListAiModels: vi.fn(),
  mockUseGlobalFilters: vi.fn(),
  mockRequestApproval: vi.fn(),
}));

vi.mock('../services/aiClient', () => ({
  sendChatMessage: mockSendChatMessage,
  listAiModels: mockListAiModels,
  requestAiOverageApproval: mockRequestApproval,
}));

// NOT mocked, deliberately: readOverageRefusal is pure error-shape narrowing and lives in
// src/config/aiOverage.ts precisely so it can run for real here (the same dependency-free
// convention aiRefusals/aiDisclosure/aiCeiling follow). Stubbing it would test the stub, and the
// property most worth protecting — that only 'over-ceiling' produces an approve affordance — is
// entirely inside it.

vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: mockUseGlobalFilters,
}));

function filtersState(memberIds: string[] | 'all') {
  return {
    filters: {
      member: memberIds === 'all'
        ? { mode: 'all', memberIds: [], groupId: null }
        : { mode: 'members', memberIds, groupId: null },
      period: { mode: 'month', month: '08', year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: [] },
    },
    groups: { status: 'ready', groups: [] },
  };
}

const CHAT_MODELS = [
  { providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה (ללא מפתח)', defaultForActions: ['chat'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 },
  { providerId: 'anthropic', modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', defaultForActions: ['chat'], usdInputPer1kTokens: 0.003, usdOutputPer1kTokens: 0.015 },
];

describe('useAiChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAiModels.mockResolvedValue(CHAT_MODELS);
    mockUseGlobalFilters.mockReturnValue(filtersState('all'));
  });

  it('defaults selectedModelId to the first model useAiModels("chat") returns', async () => {
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
  });

  it('send() appends a user message optimistically, then the model reply carrying providerId/modelId', async () => {
    mockSendChatMessage.mockResolvedValueOnce({ text: 'תשובה', providerId: 'mock', modelId: 'mock-standard', costILS: 0 });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => {
      await result.current.send('שאלה ראשונה');
    });

    expect(result.current.messages).toEqual([
      { role: 'user', text: 'שאלה ראשונה' },
      { role: 'model', text: 'תשובה', providerId: 'mock', modelId: 'mock-standard' },
    ]);
    expect(result.current.isTyping).toBe(false);
  });

  it('passes the CURRENT messages (minus the just-appended user turn) as history on every call — D3/Sun A2', async () => {
    mockSendChatMessage
      .mockResolvedValueOnce({ text: 'תשובה 1', providerId: 'mock', modelId: 'mock-standard', costILS: 0 })
      .mockResolvedValueOnce({ text: 'תשובה 2', providerId: 'mock', modelId: 'mock-standard', costILS: 0 });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה 1'); });
    expect(mockSendChatMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ history: [] }));

    await act(async () => { await result.current.send('שאלה 2'); });
    expect(mockSendChatMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      history: [
        { role: 'user', text: 'שאלה 1' },
        { role: 'model', text: 'תשובה 1' },
      ],
    }));
  });

  it('a thrown resource-exhausted callable error appends the server\'s own Hebrew message (D4 — distinguishable "over-ceiling" vs "ceiling-unconfigured" reasons) and clears isTyping', async () => {
    // Real over-ceiling copy, verbatim from functions/src/costGate/types.ts's ApprovalRequiredError.
    mockSendChatMessage.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'חריגה מתקרת ה-AI החודשית — נדרש אישור מפורש של סופר-אדמין',
    });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה'); });

    expect(result.current.isTyping).toBe(false);
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.role).toBe('model');
    expect(lastMsg.text).toBe('חריגה מתקרת ה-AI החודשית — נדרש אישור מפורש של סופר-אדמין');
  });

  it('a "ceiling not yet configured" refusal (D4\'s OTHER reason) renders as a genuinely DIFFERENT message than an over-ceiling refusal — never collapsed to one generic string', async () => {
    // Real ceiling-unconfigured copy, verbatim from the same ApprovalRequiredError constructor.
    mockSendChatMessage.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'תקרת ה-AI החודשית טרם הוגדרה במערכת — יש להגדיר אותה לפני ביצוע קריאות AI בתשלום (לא ניתן לאשר חריגה מתקרה שלא קיימת)',
    });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה'); });

    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.text).toBe('תקרת ה-AI החודשית טרם הוגדרה במערכת — יש להגדיר אותה לפני ביצוע קריאות AI בתשלום (לא ניתן לאשר חריגה מתקרה שלא קיימת)');
    expect(lastMsg.text).not.toBe('חריגה מתקרת ה-AI החודשית — נדרש אישור מפורש של סופר-אדמין');
  });

  it('a generic thrown error appends the existing generic Hebrew error copy, matching handleSendMessage today', async () => {
    mockSendChatMessage.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה'); });

    expect(result.current.isTyping).toBe(false);
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.text).toBe('מצטער, חלה שגיאה בתקשורת. אנא נסה שוב.');
  });

  // Queued fix 1 (Task 6 review, folded into Task 8) — the two cost-gate refusal reasons stayed
  // distinguishable ONLY because their server-sent Hebrew strings happened to differ; nothing
  // read the structured `err.details.reason` field aiChat.ts's rethrow actually carries. A future
  // copy edit converging the two server strings would have silently collapsed the distinction.
  // This proves the client now renders its OWN canonical 'ceiling-unconfigured' copy keyed off
  // `reason`, independent of whatever `err.message` says.
  it('a resource-exhausted error with details.reason "ceiling-unconfigured" renders the CLIENT-OWNED canonical message, ignoring a divergent err.message (queued fix, keyed off the structured field)', async () => {
    mockSendChatMessage.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'טקסט שרת שונה לגמרי, לא אמור להיות מוצג', // deliberately NOT the canonical copy
      details: { reason: 'ceiling-unconfigured' },
    });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה'); });

    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.text).toBe('תקרת ה-AI החודשית טרם הוגדרה במערכת — יש להגדיר אותה לפני ביצוע קריאות AI בתשלום (לא ניתן לאשר חריגה מתקרה שלא קיימת)');
    expect(lastMsg.text).not.toBe('טקסט שרת שונה לגמרי, לא אמור להיות מוצג');
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Review of 9ca9eea, F-H — the queued fix above client-owned ONE of the cost-gate refusal
  // reasons. Task 8's F1 work added a third ('ceiling-invalid'), so 2 of 3 went back to rendering
  // server prose, and nothing client-side would fail if the server copy converged. All three are
  // now client-owned, which is what makes the distinctness assertion below able to bite at all:
  // it reads the hook's OWN map, so a copy edit that collapses two of them fails here.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it.each([
    ['ceiling-unconfigured'],
    ['ceiling-invalid'],
    ['over-ceiling'],
  ])('reason "%s" renders the CLIENT-OWNED canonical message, ignoring a divergent err.message (F-H)', async (reason) => {
    mockSendChatMessage.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'טקסט שרת שונה לגמרי, לא אמור להיות מוצג', // one identical server string for all three
      details: { reason },
    });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה'); });

    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.text).toBe(AI_REFUSAL_MESSAGES_HE[reason]);
    expect(lastMsg.text).not.toBe('טקסט שרת שונה לגמרי, לא אמור להיות מוצג');
  });

  it('the three cost-gate refusals render three PAIRWISE-DISTINCT messages — a copy edit that collapses any two fails here (F-H)', async () => {
    const reasons = ['ceiling-unconfigured', 'ceiling-invalid', 'over-ceiling'];
    const rendered: string[] = [];

    for (const reason of reasons) {
      // The identical server message every time: if the client were still echoing err.message,
      // all three would render the same string and the distinctness check below would fail. This
      // is the scenario the previous tests could not express, because they hand-wrote a DIFFERENT
      // server string per reason and so passed whether or not the client owned anything.
      mockSendChatMessage.mockRejectedValueOnce({
        code: 'functions/resource-exhausted',
        message: 'תקרה', // one string, shared — the "server copy converged" world
        details: { reason },
      });
      const { result } = renderHook(() => useAiChat());
      await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
      await act(async () => { await result.current.send('שאלה'); });
      rendered.push(result.current.messages[result.current.messages.length - 1].text);
    }

    expect(new Set(rendered).size).toBe(3);
    for (const text of rendered) expect(text).not.toBe('תקרה');
    // Each one actually tells the operator what to DO, rather than three arbitrary distinct
    // strings: set a ceiling / re-save a corrupt one / get an explicit approval.
    expect(rendered[0]).toContain('טרם הוגדרה');
    expect(rendered[1]).toContain('אינו תקין');
    expect(rendered[2]).toContain('נדרש אישור');
  });

  it('a resource-exhausted error with an UNOWNED reason still renders err.message verbatim (unknown-model is a config bug, not a spend decision)', async () => {
    mockSendChatMessage.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'הודעת שרת כלשהי על דגם לא מוכר',
      details: { reason: 'unknown-model' },
    });
    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה'); });

    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.text).toBe('הודעת שרת כלשהי על דגם לא מוכר');
  });

  // Queued fix 2 (Task 6 review, folded into Task 8) — clicking "שיחה חדשה" mid-request used to
  // clear messages, then the pending reply appended a STALE reply into the fresh conversation once
  // it resolved, with isTyping stuck true (input disabled) until that stale response settled.
  it('resetConversation() mid-flight: clears messages and isTyping IMMEDIATELY, and the later-resolving stale reply is dropped, not appended (queued fix)', async () => {
    let resolveSend!: (value: { text: string; providerId: string; modelId: string; costILS: number }) => void;
    mockSendChatMessage.mockReturnValueOnce(new Promise((resolve) => { resolveSend = resolve; }));

    const { result } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send('שאלה ראשונה');
    });
    // The request is now in flight: optimistic user message appended, isTyping true.
    await waitFor(() => expect(result.current.isTyping).toBe(true));
    expect(result.current.messages).toHaveLength(1);

    // User clicks "שיחה חדשה" WHILE the request is still pending.
    act(() => {
      result.current.resetConversation();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isTyping).toBe(false); // never stuck disabled

    // The stale request now resolves — its reply must NOT land in the fresh conversation.
    await act(async () => {
      resolveSend({ text: 'תשובה מאוחרת', providerId: 'mock', modelId: 'mock-standard', costILS: 0 });
      await sendPromise;
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isTyping).toBe(false);
  });

  it('D16/third-lens M3 — filterScope is built fresh on every send() from the CURRENT global filter, not captured once at mount', async () => {
    mockSendChatMessage.mockResolvedValue({ text: 'תשובה', providerId: 'mock', modelId: 'mock-standard', costILS: 0 });
    const { result, rerender } = renderHook(() => useAiChat());
    await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));

    await act(async () => { await result.current.send('שאלה 1'); });
    expect(mockSendChatMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      filterScope: { memberIds: null, period: { month: '08', year: '2026' } },
    }));

    // The global מי filter changes BETWEEN the two send() calls — simulating FilterBar's setter
    // firing mid-conversation, the same trigger every other filtered screen already reacts to.
    mockUseGlobalFilters.mockReturnValue(filtersState(['omer-levy']));
    rerender();

    await act(async () => { await result.current.send('שאלה 2'); });
    expect(mockSendChatMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      filterScope: { memberIds: ['omer-levy'], period: { month: '08', year: '2026' } },
    }));
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // BATCH 8 (closing review B4) — THE APPROVE-AND-RETRY STATE MACHINE.
  //
  // The refusal bubble stays (the transcript should record what happened), but a bubble is not a
  // path forward. This is the client half of spec §8's redemption: a super-admin can approve THIS
  // call and resend it, once.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('useAiChat — overage approval (closing review B4)', () => {
    const OVER_CEILING_ERROR = {
      code: 'functions/resource-exhausted',
      message: 'חריגה מהתקרה',
      details: {
        reason: 'over-ceiling',
        quote: { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedILS: 4.25 },
        usedThisMonthILS: 48, ceilingILS: 50,
        estimatedInputTokens: 5210, estimatedOutputTokens: 400,
      },
    };

    beforeEach(() => {
      mockRequestApproval.mockResolvedValue({ token: 'tok-1', expiresAt: Date.now() + 120_000, approvedAmountILS: 4.25 });
    });

    async function refusedHook() {
      mockSendChatMessage.mockRejectedValueOnce(OVER_CEILING_ERROR);
      const { result } = renderHook(() => useAiChat());
      await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
      await act(async () => { await result.current.send('שאלה יקרה'); });
      return result;
    }

    it('an over-ceiling refusal exposes the SERVER\'s own refusal figures, alongside the transcript bubble', async () => {
      const result = await refusedHook();
      expect(result.current.overage).toEqual({
        status: 'refused',
        error: null,
        refusal: {
          providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedILS: 4.25,
          usedThisMonthILS: 48, ceilingILS: 50,
          estimatedInputTokens: 5210, estimatedOutputTokens: 400,
        },
      });
      // The conversation still records the refusal — the panel is a way forward, not a replacement
      // for saying what happened.
      expect(result.current.messages[1].text).toBe(AI_REFUSAL_MESSAGES_HE['over-ceiling']);
    });

    it.each(['ceiling-unconfigured', 'ceiling-invalid', 'counter-corrupt', 'unknown-model'])(
      'a %s refusal offers NO approval path — an overage token cannot authorise any of them',
      async (reason) => {
        // Every one of these is a refusal an approval genuinely cannot fix: no ceiling to exceed, a
        // ceiling nobody can read, a balance nobody can read (bd97326 refuses a token there on
        // purpose), or a registry bug. An approve control here would be a button guaranteed to fail.
        mockSendChatMessage.mockRejectedValueOnce({ ...OVER_CEILING_ERROR, details: { ...OVER_CEILING_ERROR.details, reason } });
        const { result } = renderHook(() => useAiChat());
        await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
        await act(async () => { await result.current.send('שאלה'); });
        expect(result.current.overage).toBeNull();
      }
    );

    it('a provider 429 shares the resource-exhausted code and must NOT offer an approval either', async () => {
      mockSendChatMessage.mockRejectedValueOnce({ code: 'functions/resource-exhausted', message: 'ספק ה-AI עמוס כרגע' });
      const { result } = renderHook(() => useAiChat());
      await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
      await act(async () => { await result.current.send('שאלה'); });
      expect(result.current.overage).toBeNull();
    });

    it('a refusal missing the server estimates offers no approval — better no button than one that burns the token', async () => {
      // An older deployed Function, or a details object that lost a field. Minting an approval from
      // a client-side guess would size it below what the retry re-quotes, and consumeApproval's
      // `<=` ceiling refuses the redemption AFTER consuming the single-use token.
      const { estimatedInputTokens: _drop, ...partial } = OVER_CEILING_ERROR.details;
      mockSendChatMessage.mockRejectedValueOnce({ ...OVER_CEILING_ERROR, details: partial });
      const { result } = renderHook(() => useAiChat());
      await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
      await act(async () => { await result.current.send('שאלה'); });
      expect(result.current.overage).toBeNull();
    });

    it('THE DONE CRITERION, client side: approve mints a token for the server\'s own estimate and resends the SAME call with it', async () => {
      const result = await refusedHook();
      mockSendChatMessage.mockResolvedValueOnce({ text: 'התשובה', providerId: 'anthropic', modelId: 'claude-sonnet-5', costILS: 4.2 });

      await act(async () => { await result.current.approveOverageAndRetry(); });

      expect(mockRequestApproval).toHaveBeenCalledWith({
        providerId: 'anthropic', modelId: 'claude-sonnet-5',
        estimatedInputTokens: 5210, estimatedOutputTokens: 400,
      });
      const retry = mockSendChatMessage.mock.calls[1][0];
      expect(retry.approvalToken).toBe('tok-1');
      // The SAME message and the SAME history as the refused call. Not "roughly the same": the
      // server re-quotes the retry from its own prompt, and any extra turn changes estIn, pushes the
      // re-quote above the approved amount and trips consumeApproval's `<=` ceiling.
      expect(retry.message).toBe('שאלה יקרה');
      expect(retry.history).toEqual(mockSendChatMessage.mock.calls[0][0].history);
      expect(retry.modelId).toBe(mockSendChatMessage.mock.calls[0][0].modelId);

      expect(result.current.overage).toBeNull();
      expect(result.current.messages[result.current.messages.length - 1]).toEqual({
        role: 'model', text: 'התשובה', providerId: 'anthropic', modelId: 'claude-sonnet-5',
      });
      expect(result.current.isTyping).toBe(false);
    });

    it('EXACTLY ONCE on the client: a second approve while one is in flight mints no second token', async () => {
      // The server guarantees a token is redeemable once (proven on a real Firestore in
      // firestore-tests/ai-overage-approval.emulator.test.ts). This is the other half: a double
      // click must not MINT two approvals, because the second would be a second real authorisation
      // of the same spend that nobody consciously granted.
      const result = await refusedHook();
      let resolveSend: (v: unknown) => void = () => undefined;
      mockSendChatMessage.mockImplementationOnce(() => new Promise((r) => { resolveSend = r; }));

      let first: Promise<void> = Promise.resolve();
      act(() => { first = result.current.approveOverageAndRetry(); });
      await waitFor(() => expect(result.current.overage?.status).toBe('retrying'));

      await act(async () => { await result.current.approveOverageAndRetry(); });
      expect(mockRequestApproval).toHaveBeenCalledTimes(1);
      expect(mockSendChatMessage).toHaveBeenCalledTimes(2); // the refused one + the single retry

      await act(async () => {
        resolveSend({ text: 'התשובה', providerId: 'anthropic', modelId: 'claude-sonnet-5', costILS: 4.2 });
        await first;
      });
    });

    it('a failed approval keeps the refusal on screen with the server\'s reason, so the user can try again', async () => {
      const result = await refusedHook();
      mockRequestApproval.mockRejectedValueOnce({ code: 'functions/permission-denied', message: 'רק סופר-אדמין יכול לאשר חריגה מהתקרה' });

      await act(async () => { await result.current.approveOverageAndRetry(); });

      expect(result.current.overage?.status).toBe('failed');
      expect(result.current.overage?.error).toBe('רק סופר-אדמין יכול לאשר חריגה מהתקרה');
      expect(result.current.overage?.refusal.estimatedILS).toBe(4.25); // still actionable
      expect(mockSendChatMessage).toHaveBeenCalledTimes(1); // nothing was resent without a token
    });

    it('a non-callable approval failure falls back to the client\'s own copy rather than a raw JS message', async () => {
      const result = await refusedHook();
      mockRequestApproval.mockRejectedValueOnce(new Error('Network request failed'));
      await act(async () => { await result.current.approveOverageAndRetry(); });
      expect(result.current.overage?.error).toBe(AI_OVERAGE_APPROVAL_FAILED_HE);
    });

    it('a retry that is refused AGAIN replaces the pending overage rather than stacking a second one', async () => {
      const result = await refusedHook();
      mockSendChatMessage.mockRejectedValueOnce({
        ...OVER_CEILING_ERROR,
        details: { ...OVER_CEILING_ERROR.details, quote: { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedILS: 9.5 } },
      });
      await act(async () => { await result.current.approveOverageAndRetry(); });
      expect(result.current.overage?.status).toBe('refused');
      expect(result.current.overage?.refusal.estimatedILS).toBe(9.5);
    });

    it('asking a NEW question clears the stale approval path IMMEDIATELY, not only when the new call lands', async () => {
      // Found by mutation: deleting the clear in send() changed nothing, because dispatch's own
      // success and failure paths both reset the overage once the new call settles. The window
      // that matters is the one in between — while the new question is in flight, a panel offering
      // to authorise money for the PREVIOUS question is still on screen and still clickable, and
      // approving it would spend against a call the user has visibly moved on from.
      const result = await refusedHook();
      expect(result.current.overage?.status).toBe('refused');

      let resolveSend: (v: unknown) => void = () => undefined;
      mockSendChatMessage.mockImplementationOnce(() => new Promise((r) => { resolveSend = r; }));

      let inFlight: Promise<void> = Promise.resolve();
      act(() => { inFlight = result.current.send('שאלה אחרת לגמרי'); });

      // Mid-flight, before the new call has settled.
      expect(result.current.isTyping).toBe(true);
      expect(result.current.overage).toBeNull();

      await act(async () => {
        resolveSend({ text: 'תשובה', providerId: 'anthropic', modelId: 'claude-sonnet-5', costILS: 0.1 });
        await inFlight;
      });
      expect(result.current.overage).toBeNull();
    });

    it('dismissing clears the approval path without touching the transcript', async () => {
      const result = await refusedHook();
      act(() => { result.current.dismissOverage(); });
      expect(result.current.overage).toBeNull();
      expect(result.current.messages).toHaveLength(2);
    });

    it('starting a new conversation abandons a pending overage — it belongs to a call the user walked away from', async () => {
      const result = await refusedHook();
      act(() => { result.current.resetConversation(); });
      expect(result.current.overage).toBeNull();
    });

    it('approveOverageAndRetry is inert when there is nothing to approve', async () => {
      mockSendChatMessage.mockResolvedValueOnce({ text: 'תשובה', providerId: 'mock', modelId: 'mock-standard', costILS: 0 });
      const { result } = renderHook(() => useAiChat());
      await waitFor(() => expect(result.current.selectedModelId).toBe('mock-standard'));
      await act(async () => { await result.current.send('שאלה'); });
      await act(async () => { await result.current.approveOverageAndRetry(); });
      expect(mockRequestApproval).not.toHaveBeenCalled();
    });
  });
});
