// Task 7: the auth session state machine — signed-out -> login, signed-in-no-claims ->
// explicit "not provisioned" screen (never a silent guest fallback), signed-in-with-claims ->
// ready with role+memberId exposed, claims-fetch failure -> error state (never treated as an
// empty/anonymous session). Mirrors the mocking pattern Dashboard.membersLoad.test.tsx uses for
// firestore: mock the firebase/auth SDK functions directly, and stub '../services/firebase' so
// importing the hook never touches the real Firebase app.

import { renderHook, waitFor } from '@testing-library/react';
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
});

describe('signOutCurrentUser', () => {
  it('delegates to firebase/auth signOut with the app auth instance', async () => {
    mockSignOut.mockResolvedValueOnce(undefined);
    await signOutCurrentUser();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
