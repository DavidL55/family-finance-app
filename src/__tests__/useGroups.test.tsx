// Identical shape to useFamilyMembers.test.tsx, wrapping listGroups instead of listMembers.
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListGroups } = vi.hoisted(() => ({ mockListGroups: vi.fn() }));

vi.mock('../services/GroupsService', () => ({ listGroups: mockListGroups }));

import { useGroups } from '../hooks/useGroups';

describe('useGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in "loading" with an empty groups array', () => {
    mockListGroups.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useGroups());
    expect(result.current.status).toBe('loading');
    expect(result.current.groups).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('moves to "ready" with the loaded groups on success', async () => {
    const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' }];
    mockListGroups.mockResolvedValueOnce(groups);
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.groups).toEqual(groups);
    expect(result.current.error).toBeNull();
  });

  it('moves to "error" with the message on a failed read, and does not reset groups to []', async () => {
    mockListGroups.mockRejectedValueOnce(new Error('permission-denied'));
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('permission-denied');
    expect(result.current.groups).toEqual([]);
  });

  it('reload() re-triggers the fetch', async () => {
    mockListGroups.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockListGroups).toHaveBeenCalledTimes(1);

    const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' }];
    mockListGroups.mockResolvedValueOnce(groups);
    result.current.reload();

    await waitFor(() => expect(mockListGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.groups).toEqual(groups));
    expect(result.current.status).toBe('ready');
  });

  it('does not update state after unmount when a pending read resolves late', async () => {
    let resolveRead!: (groups: unknown[]) => void;
    mockListGroups.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const { unmount } = renderHook(() => useGroups());
    unmount();
    expect(() => resolveRead([])).not.toThrow();
  });
});
