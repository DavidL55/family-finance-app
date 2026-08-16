// Stage 5 Task 5 — useScopedRead is the extracted READ half of useOwnedCollectionScreen (D13).
// No FilterContext/NavigationContext dependency at all (see the hook's own header comment for
// why), so this suite mounts nothing but the hook itself — the same bare renderHook() shape
// useNetWorth.test.ts uses for its own accounts/loans fetches.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScopedRead } from '../hooks/useScopedRead';

type Rec = { id: string; ownerId: string; name: string; createdAt: string; updatedAt: string };
const item = (id: string, ownerId = 'david-levy'): Rec => ({ id, ownerId, name: id, createdAt: 'x', updatedAt: 'x' });

describe('useScopedRead', () => {
  it("scope 'none' resolves permission-denied without ever calling list()", async () => {
    const list = vi.fn();
    const { result } = renderHook(() =>
      useScopedRead({ list, scope: 'none', viewerMemberId: 'omer-levy', loadErrorMessage: 'x' })
    );
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
    expect(list).not.toHaveBeenCalled();
  });

  it('a successful fetch resolves ready with the returned items', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1'), item('a2')]);
    const { result } = renderHook(() =>
      useScopedRead({ list, scope: 'family', viewerMemberId: 'david-levy', loadErrorMessage: 'x' })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(2);
    expect(list).toHaveBeenCalledWith('family', 'david-levy');
  });

  it('a permission-denied REJECTION from list() (not just a none scope) resolves permission-denied', async () => {
    const list = vi.fn().mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const { result } = renderHook(() =>
      useScopedRead({ list, scope: 'own', viewerMemberId: 'david-levy', loadErrorMessage: 'x' })
    );
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
  });

  it('a non-permission rejection renders error, never a fabricated empty list', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() =>
      useScopedRead({ list, scope: 'family', viewerMemberId: 'david-levy', loadErrorMessage: 'טעינה נכשלה' })
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('טעינה נכשלה');
    expect(result.current.items).toEqual([]);
  });

  it('reload() re-fetches the list', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([item('a1')]);
    const { result } = renderHook(() =>
      useScopedRead({ list, scope: 'family', viewerMemberId: 'david-levy', loadErrorMessage: 'x' })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('setItems lets a caller apply a local mutation without triggering a refetch', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1')]);
    const { result } = renderHook(() =>
      useScopedRead({ list, scope: 'family', viewerMemberId: 'david-levy', loadErrorMessage: 'x' })
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.setItems((prev) => prev.filter((i) => i.id !== 'a1')));
    expect(result.current.items).toHaveLength(0);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('a scope change from none to own triggers a fresh fetch', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1')]);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: 'own' | 'family' | 'none' }) =>
        useScopedRead({ list, scope, viewerMemberId: 'omer-levy', loadErrorMessage: 'x' }),
      { initialProps: { scope: 'none' } }
    );
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
    rerender({ scope: 'own' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(1);
  });
});
