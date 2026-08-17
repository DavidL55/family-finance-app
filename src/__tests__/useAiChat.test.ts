// Task 6 (Stage 6) — useAiChat wraps aiClient.sendChatMessage, mirrors Dashboard's existing
// handleSendMessage shape (optimistic user message, then the reply), and is the client half of
// two design decisions: D3/Sun A2 (full `messages` history is now genuinely sent, not dropped)
// and D16/third-lens M3 (filterScope is read fresh from useGlobalFilters() on every send(), never
// captured once at mount).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAiChat } from '../hooks/useAiChat';

const { mockSendChatMessage, mockListAiModels, mockUseGlobalFilters } = vi.hoisted(() => ({
  mockSendChatMessage: vi.fn(),
  mockListAiModels: vi.fn(),
  mockUseGlobalFilters: vi.fn(),
}));

vi.mock('../services/aiClient', () => ({
  sendChatMessage: mockSendChatMessage,
  listAiModels: mockListAiModels,
}));

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
});
