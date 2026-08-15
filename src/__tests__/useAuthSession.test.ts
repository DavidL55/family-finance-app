// Task 7: the auth session state machine — signed-out -> login, signed-in-no-claims ->
// explicit "not provisioned" screen (never a silent guest fallback), signed-in-with-claims ->
// ready with role+memberId exposed, claims-fetch failure -> error state (never treated as an
// empty/anonymous session). Mirrors the mocking pattern Dashboard.membersLoad.test.tsx uses for
// firestore: mock the firebase/auth SDK functions directly, and stub '../services/firebase' so
// importing the hook never touches the real Firebase app.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockOnAuthStateChanged, mockSignOut } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
  signOut: mockSignOut,
}));

import { useAuthSession, signOutCurrentUser } from '../hooks/useAuthSession';

describe('useAuthSession', () => {
  it('starts in "loading"', () => {
    mockOnAuthStateChanged.mockImplementation(() => () => {});
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.status).toBe('loading');
    expect(result.current.user).toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.memberId).toBeNull();
  });

  it('moves to "signed-out" when there is no user', async () => {
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(null); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('moves to "ready" with role+memberId when claims are present', async () => {
    const fakeUser = {
      getIdTokenResult: vi.fn(async () => ({ claims: { role: 'parent', memberId: 'lilit-levy' } })),
    };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.role).toBe('parent');
    expect(result.current.memberId).toBe('lilit-levy');
    expect(result.current.error).toBeNull();
    // Force-refresh so newly-provisioned claims are picked up immediately, not on the next
    // natural token refresh (~1h later).
    expect(fakeUser.getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('moves to "unprovisioned" (never a silent guest fallback) when signed in but claims are missing', async () => {
    const fakeUser = { getIdTokenResult: vi.fn(async () => ({ claims: {} })) };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
    expect(result.current.error).toBeTruthy();
    expect(result.current.role).toBeNull();
    expect(result.current.memberId).toBeNull();
  });

  it('moves to "unprovisioned" when only one of role/memberId is present (partial/corrupt claims)', async () => {
    const fakeUser = { getIdTokenResult: vi.fn(async () => ({ claims: { role: 'member' } })) };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
    expect(result.current.error).toBeTruthy();
  });

  it('moves to "error" when reading the token fails — never falls back to empty/anonymous', async () => {
    const fakeUser = { getIdTokenResult: vi.fn(async () => { throw new Error('token fetch failed'); }) };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('token fetch failed');
    expect(result.current.role).toBeNull();
    expect(result.current.memberId).toBeNull();
  });

  it('unsubscribes from onAuthStateChanged on unmount', () => {
    const unsubscribe = vi.fn();
    mockOnAuthStateChanged.mockImplementation(() => unsubscribe);
    const { unmount } = renderHook(() => useAuthSession());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  // Review Task 7 finding — stale-claims race: each onAuthStateChanged firing kicks off an
  // unordered getIdTokenResult(true) promise. If an EARLIER firing's promise resolves AFTER a
  // LATER firing has already settled the session, the stale .then() must not clobber the
  // current, correct state.
  it('drops a stale getIdTokenResult resolution from an earlier auth-state firing', async () => {
    let resolveFirstTokenResult!: (value: { claims: Record<string, unknown> }) => void;
    const firstTokenResult = new Promise<{ claims: Record<string, unknown> }>((resolve) => {
      resolveFirstTokenResult = resolve;
    });
    const userA = { getIdTokenResult: vi.fn(() => firstTokenResult) };

    let emit!: (user: unknown) => void;
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { emit = next; return () => {}; });

    const { result } = renderHook(() => useAuthSession());

    // Firing #1: user A signs in — its token fetch is deliberately left unresolved.
    emit(userA);
    // Firing #2: signed out — settles synchronously, before firing #1's promise resolves.
    emit(null);
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    // Now let firing #1's stale promise resolve, out of order, with user A's claims.
    await act(async () => {
      resolveFirstTokenResult({ claims: { role: 'parent', memberId: 'lilit-levy' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The stale 'ready' must be dropped — the session must still reflect the later, correct
    // 'signed-out' event, not user A's role.
    expect(result.current.status).toBe('signed-out');
    expect(result.current.user).toBeNull();
    expect(result.current.role).toBeNull();
  });

  it('drops a stale getIdTokenResult resolution when a second user signs in before it resolves', async () => {
    let resolveFirstTokenResult!: (value: { claims: Record<string, unknown> }) => void;
    const firstTokenResult = new Promise<{ claims: Record<string, unknown> }>((resolve) => {
      resolveFirstTokenResult = resolve;
    });
    const userA = { getIdTokenResult: vi.fn(() => firstTokenResult) };
    const userB = {
      getIdTokenResult: vi.fn(async () => ({ claims: { role: 'member', memberId: 'ben-levy' } })),
    };

    let emit!: (user: unknown) => void;
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { emit = next; return () => {}; });

    const { result } = renderHook(() => useAuthSession());

    emit(userA);
    emit(userB);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.memberId).toBe('ben-levy');

    // User A's stale token resolves after user B's session already landed — must be ignored.
    await act(async () => {
      resolveFirstTokenResult({ claims: { role: 'parent', memberId: 'lilit-levy' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.memberId).toBe('ben-levy');
    expect(result.current.role).toBe('member');
  });

  it('does not update session state after unmount when a pending getIdTokenResult resolves late', async () => {
    let resolveTokenResult!: (value: { claims: Record<string, unknown> }) => void;
    const tokenResult = new Promise<{ claims: Record<string, unknown> }>((resolve) => {
      resolveTokenResult = resolve;
    });
    const userA = { getIdTokenResult: vi.fn(() => tokenResult) };

    let emit!: (user: unknown) => void;
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { emit = next; return () => {}; });

    const { unmount } = renderHook(() => useAuthSession());
    emit(userA);
    unmount();

    // Resolving after unmount must not throw or trigger a state update on the unmounted hook.
    await act(async () => {
      expect(() => resolveTokenResult({ claims: { role: 'parent', memberId: 'lilit-levy' } })).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});

describe('signOutCurrentUser', () => {
  it('delegates to firebase/auth signOut with the app auth instance', async () => {
    mockSignOut.mockResolvedValueOnce(undefined);
    await signOutCurrentUser();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // Review Task 7 finding — cross-user Drive credential leak: signOutCurrentUser only called
  // Firebase signOut(auth), leaving sessionStorage['drive_token'] and
  // localStorage['drive_folder_id'/'drive_folder_name'] behind. A second family member signing
  // in on the same tab would inherit the first user's live Google Drive OAuth token and folder
  // selection — access that lives outside Firestore rules entirely.
  it('clears the cross-user Drive credential keys on sign-out', async () => {
    sessionStorage.setItem('drive_token', 'user-a-oauth-token');
    localStorage.setItem('drive_folder_id', 'folder-123');
    localStorage.setItem('drive_folder_name', 'Family Drive');
    mockSignOut.mockResolvedValueOnce(undefined);

    await signOutCurrentUser();

    expect(sessionStorage.getItem('drive_token')).toBeNull();
    expect(localStorage.getItem('drive_folder_id')).toBeNull();
    expect(localStorage.getItem('drive_folder_name')).toBeNull();
  });

  it('does not throw when the Drive credential keys are already absent', async () => {
    sessionStorage.removeItem('drive_token');
    localStorage.removeItem('drive_folder_id');
    localStorage.removeItem('drive_folder_name');
    mockSignOut.mockResolvedValueOnce(undefined);

    await expect(signOutCurrentUser()).resolves.toBeUndefined();
  });
});
