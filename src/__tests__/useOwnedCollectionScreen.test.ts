import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';

const mockSetLeaveGuard = vi.fn();
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ setLeaveGuard: mockSetLeaveGuard }) }));
vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: { member: { mode: 'all', memberIds: [], groupId: null } },
    groups: { status: 'ready', groups: [] },
  }),
}));

type Rec = { id: string; ownerId: string; name: string; createdAt: string; updatedAt: string };
const item = (id: string, ownerId = 'david-levy'): Rec => ({ id, ownerId, name: id, createdAt: 'x', updatedAt: 'x' });

describe('useOwnedCollectionScreen (D13)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves permission-denied when the resolved scope is none, without ever calling list()', async () => {
    const list = vi.fn();
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'omer-levy', role: 'member' }, viewLevel: undefined, editLevel: undefined,
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
    expect(list).not.toHaveBeenCalled();
  });

  it('a failed read renders error, never a fabricated empty list', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'טעינה נכשלה',
    }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('טעינה נכשלה');
    expect(result.current.items).toEqual([]);
  });

  it('a permission-denied REJECTION from list() (not just a none scope) also resolves permission-denied, not error', async () => {
    const list = vi.fn().mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
  });

  it('submit() calls save with the acting memberId, reloads the list, and closes the form', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([item('a1')]);
    const save = vi.fn().mockResolvedValueOnce(item('a1'));
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save, remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.openCreate());
    await act(async () => result.current.submit({ ownerId: 'david-levy', name: 'a1' } as any));
    expect(save).toHaveBeenCalledWith({ ownerId: 'david-levy', name: 'a1' }, 'david-levy');
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.isFormOpen).toBe(false);
  });

  it('submit() while editing includes the editing item id in the save payload', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1')]).mockResolvedValueOnce([item('a1')]);
    const save = vi.fn().mockResolvedValueOnce(item('a1'));
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save, remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.openEdit(result.current.items[0]));
    await act(async () => result.current.submit({ ownerId: 'david-levy', name: 'renamed' } as any));
    expect(save).toHaveBeenCalledWith({ ownerId: 'david-levy', name: 'renamed', id: 'a1' }, 'david-levy');
  });

  it('confirmDelete calls remove and removes the item from state without a full reload', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1')]);
    const remove = vi.fn().mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove,
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.requestDelete('a1'));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => result.current.confirmDelete());
    expect(remove).toHaveBeenCalledWith('a1', 'david-levy');
    expect(result.current.items).toHaveLength(0);
  });

  it('cancelDelete clears pendingDeleteId without calling remove', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1')]);
    const remove = vi.fn();
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove,
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.requestDelete('a1'));
    act(() => result.current.cancelDelete());
    expect(result.current.pendingDeleteId).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("visibleItems applies the מי filter (D6) — only items whose ownerId is in the resolved selection", async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1', 'david-levy'), item('a2', 'omer-levy')]);
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    // filters.member.mode === 'all' (per the mocked useGlobalFilters above) -> no filtering, both visible
    expect(result.current.visibleItems).toHaveLength(2);
  });

  it('registers a leave-guard on mount that only blocks when the form is open AND dirty (I4)', async () => {
    const list = vi.fn().mockResolvedValueOnce([]);
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockSetLeaveGuard).toHaveBeenCalledWith(expect.any(Function));
    const guard = mockSetLeaveGuard.mock.calls[0][0];
    expect(guard()).toBe(true); // form not open — never blocks
    act(() => result.current.openCreate());
    act(() => result.current.markDirty(true));
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    expect(guard()).toBe(false); // open + dirty — asks, user declined
  });

  it('reload() re-fetches the list', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([item('a1')]);
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
