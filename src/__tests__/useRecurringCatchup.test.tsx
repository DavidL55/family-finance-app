// Task 9: bootstrap wiring for the Stage 3 recurring catch-up engine
// (RecurringService.postDueRecurringTransactions, Task 5). Extracted into its own hook
// (useRecurringCatchup) rather than tested through the full App.tsx tree, which would drag in
// Dashboard's heavy dependencies (recharts, ai, firestore) for no reason — App.tsx's own wiring
// is a single `useRecurringCatchup(session, recurringViewLevel)` call, consistent with
// `ensureSeeded`'s un-tested inline wiring (Task 5's report / Stage 2 Task 8's convention: no
// dedicated App.tsx test file).
//
// Covers: runs once per ready session (any role — unlike ensureSeeded, NOT gated to
// super-admin), never for signed-out/loading/unprovisioned, a partial-failure outcome surfaces a
// non-blocking Hebrew notice (NotificationContext) + console.error without crashing, an
// unexpected rejection is equally non-fatal, a second auth-state fire for the SAME session
// doesn't re-run (double-run guard), a genuinely different member DOES get their own run,
// React.StrictMode's dev-mode double-effect-invocation doesn't cause a double run either, and —
// D1 (this stage's fix for the live member-role catch-up gap) — the hook resolves the caller's
// scope via resolveOwnedModuleScope and skips the call ENTIRELY (no query, no error) when that
// resolves to 'none', while returning whatever outcome the underlying engine last produced (D10,
// for Task 7's per-row failure badge).

import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../contexts/NotificationContext';

const { mockPostDueRecurringTransactions } = vi.hoisted(() => ({
  mockPostDueRecurringTransactions: vi.fn(),
}));

vi.mock('../services/RecurringService', () => ({
  postDueRecurringTransactions: mockPostDueRecurringTransactions,
}));

import { useRecurringCatchup } from '../hooks/useRecurringCatchup';
import type { AuthSession } from '../hooks/useAuthSession';
import type { PermissionLevel } from '../types/permissions';

type Session = Pick<AuthSession, 'status' | 'memberId' | 'role'>;

function wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

function readySession(memberId = 'david-levy', role: Session['role'] = 'member'): Session {
  return { status: 'ready', memberId, role };
}

describe('useRecurringCatchup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs postDueRecurringTransactions once when the session is ready and scope resolves to 'family'", async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    renderHook(() => useRecurringCatchup(readySession(), 'family'), { wrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
    expect(mockPostDueRecurringTransactions).toHaveBeenCalledWith('david-levy', 'family');
  });

  it("a 'member' session with recurringViewLevel: 'own' calls postDueRecurringTransactions(memberId, 'own')", async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    renderHook(() => useRecurringCatchup(readySession('omer-levy', 'member'), 'own'), { wrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
    expect(mockPostDueRecurringTransactions).toHaveBeenCalledWith('omer-levy', 'own');
  });

  it("a super-admin/parent session always resolves to 'family' regardless of the passed level (matches Rules' own bypass)", async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    renderHook(() => useRecurringCatchup(readySession('david-levy', 'super-admin'), 'none'), { wrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
    expect(mockPostDueRecurringTransactions).toHaveBeenCalledWith('david-levy', 'family');
  });

  it("a 'member' with recurringViewLevel: undefined (fail-closed to 'none') does NOT call postDueRecurringTransactions at all — nothing to post, not an error", async () => {
    renderHook(() => useRecurringCatchup(readySession('omer-levy', 'member'), undefined), { wrapper });
    // Give any stray microtask a chance to run before asserting the negative.
    await Promise.resolve();
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it("a 'member' with recurringViewLevel: 'none' also does NOT call postDueRecurringTransactions", async () => {
    renderHook(() => useRecurringCatchup(readySession('omer-levy', 'member'), 'none'), { wrapper });
    await Promise.resolve();
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for a loading session', () => {
    renderHook(() => useRecurringCatchup({ status: 'loading', memberId: null, role: null }, 'family'), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for a signed-out session', () => {
    renderHook(() => useRecurringCatchup({ status: 'signed-out', memberId: null, role: null }, 'family'), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for an unprovisioned session', () => {
    renderHook(() => useRecurringCatchup({ status: 'unprovisioned', memberId: null, role: null }, 'family'), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for an error session', () => {
    renderHook(() => useRecurringCatchup({ status: 'error', memberId: null, role: null }, 'family'), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('surfaces a non-blocking Hebrew notice and logs to console.error on a partial-failure outcome, without throwing', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPostDueRecurringTransactions.mockResolvedValue({
      posted: [],
      failed: [{ recurringId: 'rec-1', error: 'permission-denied' }],
    });

    function Harness() {
      useRecurringCatchup(readySession(), 'family');
      return <div>alive</div>;
    }
    render(<Harness />, { wrapper });

    expect(screen.getByText('alive')).toBeInTheDocument();
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/עדכון תנועות קבועות נכשל/)).toBeInTheDocument()
    );

    consoleErrorSpy.mockRestore();
  });

  it('does not surface a notice or log an error on a fully-successful outcome', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPostDueRecurringTransactions.mockResolvedValue({
      posted: [{ recurringId: 'rec-1', period: '2026-08' }],
      failed: [],
    });

    render(<div />, { wrapper });
    renderHook(() => useRecurringCatchup(readySession(), 'family'), { wrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/עדכון תנועות קבועות נכשל/)).not.toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('does not crash the app when postDueRecurringTransactions itself rejects unexpectedly', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPostDueRecurringTransactions.mockRejectedValue(new Error('boom'));

    function Harness() {
      useRecurringCatchup(readySession(), 'family');
      return <div>alive</div>;
    }
    render(<Harness />, { wrapper });

    expect(screen.getByText('alive')).toBeInTheDocument();
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/עדכון תנועות קבועות נכשל/)).toBeInTheDocument()
    );

    consoleErrorSpy.mockRestore();
  });

  it('does not re-run when a second auth-state fire produces the same ready session (double-run guard)', async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    const { rerender } = renderHook((s: Session) => useRecurringCatchup(s, 'family'), {
      wrapper,
      initialProps: readySession(),
    });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));

    // Same status/memberId values, fresh object identity — simulates onAuthStateChanged
    // re-firing for the same already-provisioned session (e.g. a forced token refresh).
    rerender(readySession());
    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
  });

  it('runs again for a genuinely different memberId (a second user signing in on the same tab)', async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    const { rerender } = renderHook((s: Session) => useRecurringCatchup(s, 'family'), {
      wrapper,
      initialProps: readySession('david-levy'),
    });
    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));

    rerender(readySession('lilit-levy'));
    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(2));
    expect(mockPostDueRecurringTransactions).toHaveBeenLastCalledWith('lilit-levy', 'family');
  });

  it('runs again for the same member re-signing in after a sign-out in the same tab (guard reset)', async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    const { rerender } = renderHook((s: Session) => useRecurringCatchup(s, 'family'), {
      wrapper,
      initialProps: readySession('david-levy'),
    });
    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));

    // Sign out, then sign back in as the SAME member without a page reload — the
    // double-run guard must not mistake this for a redundant re-fire of the same session.
    rerender({ status: 'signed-out', memberId: null, role: null });
    rerender(readySession('david-levy'));

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(2));
  });

  it('does not double-run under React.StrictMode dev-mode double-invoked effects', async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });

    function StrictWrapper({ children }: { children: ReactNode }) {
      return (
        <StrictMode>
          <NotificationProvider>{children}</NotificationProvider>
        </StrictMode>
      );
    }

    renderHook(() => useRecurringCatchup(readySession(), 'family'), { wrapper: StrictWrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
  });

  // ── D10 — returns the resolved outcome, so a consumer (Task 7's RecurringScreen) can render ──
  it('returns the resolved outcome from the hook, so a consumer can render per-item failures (M5)', async () => {
    const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'owner not found' }] };
    mockPostDueRecurringTransactions.mockResolvedValueOnce(outcome);
    const { result } = renderHook(() => useRecurringCatchup(readySession(), 'family'), { wrapper });

    await waitFor(() => expect(result.current).toEqual(outcome));
  });

  it('returns null before the catch-up has resolved, and for a session that never runs one (e.g. none-scope)', () => {
    const { result } = renderHook(
      () => useRecurringCatchup(readySession('omer-levy', 'member'), 'none' as PermissionLevel),
      { wrapper }
    );
    expect(result.current).toBeNull();
  });
});
