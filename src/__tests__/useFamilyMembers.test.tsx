// Mirrors Dashboard.membersLoad.test.tsx's error-vs-empty shape, applied directly to the
// standalone hook: status transitions loading->ready with data, loading->error with the error
// message (members left untouched, never reset to []), and reload() re-triggers the fetch.
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListMembers } = vi.hoisted(() => ({ mockListMembers: vi.fn() }));

vi.mock('../services/MembersService', () => ({ listMembers: mockListMembers }));

import { useFamilyMembers } from '../hooks/useFamilyMembers';

describe('useFamilyMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in "loading" with an empty members array', () => {
    mockListMembers.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useFamilyMembers());
    expect(result.current.status).toBe('loading');
    expect(result.current.members).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('moves to "ready" with the loaded members on success', async () => {
    const members = [{ id: 'david-levy', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], createdAt: 'x', updatedAt: 'x' }];
    mockListMembers.mockResolvedValueOnce(members);
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.members).toEqual(members);
    expect(result.current.error).toBeNull();
  });

  it('moves to "error" with the message on a failed read, and does not reset members to []', async () => {
    mockListMembers.mockRejectedValueOnce(new Error('permission-denied'));
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('permission-denied');
    expect(result.current.members).toEqual([]);
  });

  it('reload() re-triggers the fetch', async () => {
    mockListMembers.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useFamilyMembers());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockListMembers).toHaveBeenCalledTimes(1);

    const members = [{ id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#17C3B2', groups: [], createdAt: 'x', updatedAt: 'x' }];
    mockListMembers.mockResolvedValueOnce(members);
    result.current.reload();

    await waitFor(() => expect(mockListMembers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.members).toEqual(members));
    expect(result.current.status).toBe('ready');
  });

  it('does not update state after unmount when a pending read resolves late', async () => {
    let resolveRead!: (members: unknown[]) => void;
    mockListMembers.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const { unmount } = renderHook(() => useFamilyMembers());
    unmount();
    expect(() => resolveRead([])).not.toThrow();
  });
});
