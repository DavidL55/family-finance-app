// Spec C1 §4: the auth session state machine — signed-out -> login, signed-in-without-access ->
// explicit "not provisioned" screen (never a silent guest fallback), signed-in-with-access ->
// ready with role+memberId exposed, listener failure -> error state (never treated as an
// empty/anonymous session). role/memberId come from a live access/{uid} listener, not token
// claims. Mocks the firebase SDK functions directly and stubs '../services/firebase' so
// importing the hook never touches the real Firebase app.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOnAuthStateChanged, mockSignOut, mockOnSnapshot, mockDoc } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
  mockSignOut: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((_db: unknown, ...path: string[]) => path.join('/')),
}));

vi.mock('../services/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
  signOut: mockSignOut,
}));
vi.mock('firebase/firestore', () => ({ onSnapshot: mockOnSnapshot, doc: mockDoc }));

import { useAuthSession, signOutCurrentUser, parseAccess } from '../hooks/useAuthSession';

type SnapCb = (snap: { exists: () => boolean; data: () => unknown; metadata: { fromCache: boolean } }) => void;
const snap = (data: unknown, fromCache = false) => ({
  exists: () => data != null,
  data: () => data,
  metadata: { fromCache },
});
const signIn = (uid = 'u1') =>
  mockOnAuthStateChanged.mockImplementation((_a, next) => { next({ uid }); return () => {}; });

describe('parseAccess', () => {
  it('accepts a valid role + non-empty memberId', () => {
    expect(parseAccess({ role: 'parent', memberId: 'lilit-levy' })).toEqual({ role: 'parent', memberId: 'lilit-levy' });
  });
  it.each([
    ['null', null],
    ['a non-object', 'parent'],
    ['an unknown role', { role: 'god', memberId: 'x' }],
    ['a missing memberId', { role: 'member' }],
    ['an empty memberId', { role: 'member', memberId: '' }],
    ['a non-string memberId', { role: 'member', memberId: 7 }],
  ])('rejects %s', (_label, data) => {
    expect(parseAccess(data)).toBeNull();
  });
});

describe('useAuthSession', () => {
  beforeEach(() => {
    mockOnAuthStateChanged.mockReset();
    mockOnSnapshot.mockReset();
    mockDoc.mockClear();
  });

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

  it('ready when access/{uid} holds a valid role + memberId', async () => {
    signIn();
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => {
      next(snap({ role: 'parent', memberId: 'lilit-levy' }));
      return () => {};
    });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.role).toBe('parent');
    expect(result.current.memberId).toBe('lilit-levy');
    expect(result.current.error).toBeNull();
    expect(mockDoc).toHaveBeenCalledWith({}, 'access', 'u1');
  });

  it('subscribes with includeMetadataChanges so the cache -> server transition is observable', () => {
    signIn();
    mockOnSnapshot.mockImplementation(() => () => {});
    renderHook(() => useAuthSession());
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(mockOnSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
  });

  it('unprovisioned when the server says there is no access doc', async () => {
    signIn();
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => { next(snap(null)); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
    expect(result.current.error).toBeTruthy();
    expect(result.current.role).toBeNull();
    expect(result.current.memberId).toBeNull();
  });

  it('a cache-only "missing" snapshot keeps loading (no flash of לא משויך)', async () => {
    signIn();
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => { next(snap(null, true)); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await act(async () => {});
    expect(result.current.status).toBe('loading');
  });

  it('cache-missing then server-missing ends unprovisioned — never spins forever', async () => {
    signIn();
    let push: SnapCb = () => {};
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => { push = next; next(snap(null, true)); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await act(async () => {});
    expect(result.current.status).toBe('loading');
    act(() => push(snap(null, false)));
    expect(result.current.status).toBe('unprovisioned');
  });

  it('cache-missing then a server doc ends ready', async () => {
    signIn();
    let push: SnapCb = () => {};
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => { push = next; next(snap(null, true)); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await act(async () => {});
    act(() => push(snap({ role: 'member', memberId: 'omer-levy' }, false)));
    expect(result.current.status).toBe('ready');
    expect(result.current.memberId).toBe('omer-levy');
  });

  it('revocation: ready -> unprovisioned when the doc disappears', async () => {
    signIn();
    let push: SnapCb = () => {};
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => {
      push = next;
      next(snap({ role: 'member', memberId: 'omer-levy' }));
      return () => {};
    });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => push(snap(null)));
    expect(result.current.status).toBe('unprovisioned');
    expect(result.current.role).toBeNull();
    expect(result.current.memberId).toBeNull();
  });

  it('a corrupt access doc (unknown role) is unprovisioned, never a guessed role', async () => {
    signIn();
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => {
      next(snap({ role: 'god', memberId: 'x' }));
      return () => {};
    });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
    expect(result.current.role).toBeNull();
  });

  it('a listener error is "error", not an empty session', async () => {
    signIn();
    mockOnSnapshot.mockImplementation((_ref, _opts, _next, onErr: (e: Error) => void) => {
      onErr(new Error('boom'));
      return () => {};
    });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('boom');
    expect(result.current.role).toBeNull();
    expect(result.current.memberId).toBeNull();
  });

  it('signing out unsubscribes the access listener', async () => {
    const unsubAccess = vi.fn();
    let authNext: (u: unknown) => void = () => {};
    mockOnAuthStateChanged.mockImplementation((_a, next) => { authNext = next; next({ uid: 'u1' }); return () => {}; });
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => {
      next(snap({ role: 'member', memberId: 'omer-levy' }));
      return unsubAccess;
    });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => authNext(null));
    expect(unsubAccess).toHaveBeenCalled();
    expect(result.current.status).toBe('signed-out');
  });

  it('unsubscribes from onAuthStateChanged and the access listener on unmount', () => {
    const unsubscribe = vi.fn();
    const unsubAccess = vi.fn();
    mockOnAuthStateChanged.mockImplementation((_a, next) => { next({ uid: 'u1' }); return unsubscribe; });
    mockOnSnapshot.mockImplementation(() => unsubAccess);
    const { unmount } = renderHook(() => useAuthSession());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubAccess).toHaveBeenCalledTimes(1);
  });

  it('drops a late snapshot from a previous user after a different user signs in', () => {
    let authNext: (u: unknown) => void = () => {};
    const pushes: SnapCb[] = [];
    mockOnAuthStateChanged.mockImplementation((_a, next) => { authNext = next; next({ uid: 'uA' }); return () => {}; });
    mockOnSnapshot.mockImplementation((_ref, _opts, next: SnapCb) => { pushes.push(next); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    act(() => authNext({ uid: 'uB' }));
    act(() => pushes[1](snap({ role: 'member', memberId: 'ben-levy' })));
    expect(result.current.memberId).toBe('ben-levy');
    // user A's listener fires late — must be ignored
    act(() => pushes[0](snap({ role: 'parent', memberId: 'lilit-levy' })));
    expect(result.current.memberId).toBe('ben-levy');
    expect(result.current.role).toBe('member');
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
