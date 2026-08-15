// Task 9: bootstrap wiring for the Stage 3 recurring catch-up engine
// (RecurringService.postDueRecurringTransactions, Task 5). Extracted into its own hook
// (useRecurringCatchup) rather than tested through the full App.tsx tree, which would drag in
// Dashboard's heavy dependencies (recharts, ai, firestore) for no reason — App.tsx's own wiring
// is a single `useRecurringCatchup(session)` call, consistent with `ensureSeeded`'s un-tested
// inline wiring (Task 5's report / Stage 2 Task 8's convention: no dedicated App.tsx test file).
//
// Covers: runs once per ready session (any role — unlike ensureSeeded, NOT gated to
// super-admin), never for signed-out/loading/unprovisioned, a partial-failure outcome surfaces a
// non-blocking Hebrew notice (NotificationContext) + console.error without crashing, an
// unexpected rejection is equally non-fatal, a second auth-state fire for the SAME session
// doesn't re-run (double-run guard), a genuinely different member DOES get their own run, and
// React.StrictMode's dev-mode double-effect-invocation doesn't cause a double run either.

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

type Session = Pick<AuthSession, 'status' | 'memberId'>;

function wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

function readySession(memberId = 'david-levy'): Session {
  return { status: 'ready', memberId };
}

describe('useRecurringCatchup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs postDueRecurringTransactions once when the session is ready', async () => {
    mockPostDueRecurringTransactions.mockResolvedValue({ posted: [], failed: [] });
    renderHook(() => useRecurringCatchup(readySession()), { wrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
    expect(mockPostDueRecurringTransactions).toHaveBeenCalledWith('david-levy');
  });

  it('does not run for a loading session', () => {
    renderHook(() => useRecurringCatchup({ status: 'loading', memberId: null }), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for a signed-out session', () => {
    renderHook(() => useRecurringCatchup({ status: 'signed-out', memberId: null }), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for an unprovisioned session', () => {
    renderHook(() => useRecurringCatchup({ status: 'unprovisioned', memberId: null }), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('does not run for an error session', () => {
    renderHook(() => useRecurringCatchup({ status: 'error', memberId: null }), { wrapper });
    expect(mockPostDueRecurringTransactions).not.toHaveBeenCalled();
  });

  it('surfaces a non-blocking Hebrew notice and logs to console.error on a partial-failure outcome, without throwing', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPostDueRecurringTransactions.mockResolvedValue({
      posted: [],
      failed: [{ recurringId: 'rec-1', error: 'permission-denied' }],
    });

    function Harness() {
      useRecurringCatchup(readySession());
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
    renderHook(() => useRecurringCatchup(readySession()), { wrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/עדכון תנועות קבועות נכשל/)).not.toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('does not crash the app when postDueRecurringTransactions itself rejects unexpectedly', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPostDueRecurringTransactions.mockRejectedValue(new Error('boom'));

    function Harness() {
      useRecurringCatchup(readySession());
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
    const { rerender } = renderHook((s: Session) => useRecurringCatchup(s), {
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
    const { rerender } = renderHook((s: Session) => useRecurringCatchup(s), {
      wrapper,
      initialProps: readySession('david-levy'),
    });
    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));

    rerender(readySession('lilit-levy'));
    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(2));
    expect(mockPostDueRecurringTransactions).toHaveBeenLastCalledWith('lilit-levy');
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

    renderHook(() => useRecurringCatchup(readySession()), { wrapper: StrictWrapper });

    await waitFor(() => expect(mockPostDueRecurringTransactions).toHaveBeenCalledTimes(1));
  });
});
