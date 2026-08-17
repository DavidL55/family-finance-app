// Task 6 (Stage 6) — fetch-once-and-cache hook over aiClient.listAiModels, the same
// loading/ready/error three-state shape this project's other data hooks already use
// (useFamilyMembers/useGroups precedent, Stage 4). No `permission-denied` state here —
// listAiModels requires only isSignedIn, not a matrix grant (D5).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAiModels } from '../hooks/useAiModels';

const { mockListAiModels } = vi.hoisted(() => ({ mockListAiModels: vi.fn() }));
vi.mock('../services/aiClient', () => ({ listAiModels: mockListAiModels }));

describe('useAiModels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts loading, then resolves to ready with the fetched models', async () => {
    mockListAiModels.mockResolvedValueOnce([{ providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה', defaultForActions: ['chat'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 }]);
    const { result } = renderHook(() => useAiModels('chat'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.models).toHaveLength(1);
    expect(mockListAiModels).toHaveBeenCalledWith('chat');
  });

  it('renders an explicit error state on a failed read — never a silent empty list', async () => {
    mockListAiModels.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAiModels('chat'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.models).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it('re-fetches when the action argument changes', async () => {
    mockListAiModels.mockResolvedValue([]);
    const { result, rerender } = renderHook(({ action }: { action: 'chat' | 'extraction' }) => useAiModels(action), {
      initialProps: { action: 'chat' as const },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ action: 'extraction' });
    await waitFor(() => expect(mockListAiModels).toHaveBeenLastCalledWith('extraction'));
  });
});
