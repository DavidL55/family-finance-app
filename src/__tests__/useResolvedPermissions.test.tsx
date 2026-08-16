// Mirrors useFamilyMembers.test.tsx's mocking/status-transition pattern, applied to a single
// getMember(session.memberId) read keyed off session.status/session.memberId. `session.status
// !== 'ready'` (loading/signed-out/unprovisioned/error) never fetches — there's no memberId to
// resolve permissions for. A resolved member with no `resolvedPermissions` field yet (not
// materialized by PermissionsService for this member) still reaches 'ready', with
// resolvedPermissions defaulted to `{}` — never `null` once ready; `null` is reserved for the
// distinct "we don't know, the read failed" error case (see moduleRegistry's isModuleVisible,
// which fails closed on both `{}` and `null` for a 'member' role, but the type here stays honest
// about what was actually fetched).
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../hooks/useAuthSession';

const { mockGetMember } = vi.hoisted(() => ({ mockGetMember: vi.fn() }));

vi.mock('../services/MembersService', () => ({ getMember: mockGetMember }));

import { useResolvedPermissions } from '../hooks/useResolvedPermissions';

const baseMember = {
  id: 'omer-levy',
  name: 'עומר',
  role: 'ילד' as const,
  color: '#17C3B2',
  groups: [],
  createdAt: 'x',
  updatedAt: 'x',
};

function session(overrides: Partial<AuthSession>): AuthSession {
  return {
    status: 'ready',
    user: null,
    role: 'member',
    memberId: 'omer-levy',
    error: null,
    ...overrides,
  };
}

describe('useResolvedPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays "idle" and never fetches when session.status !== "ready"', () => {
    const { result } = renderHook(() => useResolvedPermissions(session({ status: 'loading', role: null, memberId: null })));
    expect(result.current.status).toBe('idle');
    expect(result.current.resolvedPermissions).toBeNull();
    expect(mockGetMember).not.toHaveBeenCalled();
  });

  it('moves to "ready" with the member\'s resolvedPermissions on success', async () => {
    const resolvedPermissions = { expenses: { view: 'own' as const, edit: 'none' as const } };
    mockGetMember.mockResolvedValueOnce({ ...baseMember, resolvedPermissions });
    const { result } = renderHook(() => useResolvedPermissions(session({})));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.resolvedPermissions).toEqual(resolvedPermissions);
    expect(result.current.error).toBeNull();
  });

  it('a member with resolvedPermissions undefined reaches "ready" with {} (never null)', async () => {
    mockGetMember.mockResolvedValueOnce({ ...baseMember, resolvedPermissions: undefined });
    const { result } = renderHook(() => useResolvedPermissions(session({})));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.resolvedPermissions).toEqual({});
  });

  it('moves to "error" with the message on a rejected getMember read', async () => {
    mockGetMember.mockRejectedValueOnce(new Error('permission-denied'));
    const { result } = renderHook(() => useResolvedPermissions(session({})));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('permission-denied');
    expect(result.current.resolvedPermissions).toBeNull();
  });

  it('retry() re-fetches', async () => {
    mockGetMember.mockResolvedValueOnce({ ...baseMember, resolvedPermissions: {} });
    const { result } = renderHook(() => useResolvedPermissions(session({})));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetMember).toHaveBeenCalledTimes(1);

    const resolvedPermissions = { expenses: { view: 'family' as const, edit: 'own' as const } };
    mockGetMember.mockResolvedValueOnce({ ...baseMember, resolvedPermissions });
    result.current.retry();

    await waitFor(() => expect(mockGetMember).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.resolvedPermissions).toEqual(resolvedPermissions));
    expect(result.current.status).toBe('ready');
  });

  it('does not update state after unmount when a pending read resolves late', async () => {
    let resolveRead!: (member: unknown) => void;
    mockGetMember.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const { unmount } = renderHook(() => useResolvedPermissions(session({})));
    unmount();
    expect(() => resolveRead({ ...baseMember, resolvedPermissions: {} })).not.toThrow();
  });
});
