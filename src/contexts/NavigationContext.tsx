// Public, programmatic screen navigation — replaces `App.tsx`'s private `activeTab` `useState`
// (Task 3) so Stage 8's insight deep-links and Stage 10's guided tours have a way to change
// screens from outside `App.tsx`. Follows the identical Provider/`useContext`-with-throw shape as
// `FilterContext`/`NotificationContext`.
//
// D11 (Stage 5 Task 2, B2 blocking UX finding) — real back-stack backed by the browser History
// API, plus a leave-guard hook and a typed navigation payload. This was a single `useState` with
// no history of any kind; Stage 5 introduces the app's first 3-deep drill path (Dashboard -> Net
// Worth -> Accounts) and the OS/browser back gesture used to do nothing useful. `navigateTo` now
// calls `history.pushState({ tab }, '')` (skipped as a no-op when navigating to the already-active
// tab) and a `popstate` listener updates `activeTab` to match, so the OS/browser back gesture — and
// a new in-header back button, rendered whenever `canGoBack` — both actually return to the origin
// screen. Unlike a filter choice (FilterContext's own sessionStorage persistence, D1), a
// killed/reloaded session landing back on whatever tab was last open is not desired; the history
// state is in-memory-backed only (never restored from a previous browser session) and a fresh
// mount always starts on `dashboard`.
//
// Two small additions ride on this same file, since it was already being reopened for the history
// mechanism: (a) `setLeaveGuard(guard)`, consulted by `navigateTo`/`goBack` before changing tabs —
// a dirty, unsaved form (I4) registers a guard that pops a native confirm and returns the user's
// choice, so a bottom-nav thumb-slip while editing a form can no longer discard it silently; (b)
// `navigateTo(tabId, payload?)` — an optional payload, stored alongside `{ tab }` in the same
// history-state object, read once via `navigationPayload` by the destination screen and cleared via
// `consumePayload()`.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface HistoryState {
  tab: string;
  payload?: unknown;
}

interface NavigationContextType {
  activeTab: string;
  navigationPayload: unknown;
  navigateTo: (tabId: string, payload?: unknown) => void;
  goBack: () => void;
  canGoBack: boolean;
  consumePayload: () => void;
  setLeaveGuard: (guard: (() => boolean) | null) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

function readHistoryState(): HistoryState {
  const raw = window.history.state as Partial<HistoryState> | null;
  return { tab: raw?.tab ?? 'dashboard', payload: raw?.payload };
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HistoryState>(() => readHistoryState());
  const [canGoBack, setCanGoBack] = useState(false);
  const leaveGuardRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    // Seed the initial entry so the very first back gesture has somewhere to land inside the
    // app, instead of leaving it — the B2 finding's exact complaint.
    if (!(window.history.state as Partial<HistoryState> | null)?.tab) {
      window.history.replaceState({ tab: 'dashboard' } satisfies HistoryState, '');
    }
    const onPopState = (e: PopStateEvent) => {
      const next = (e.state as Partial<HistoryState> | null) ?? { tab: 'dashboard' };
      setState({ tab: next.tab ?? 'dashboard', payload: next.payload });
      setCanGoBack(!!(e.state as Partial<HistoryState> | null)?.tab && window.history.length > 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const requestLeave = useCallback((): boolean => leaveGuardRef.current?.() ?? true, []);

  const navigateTo = useCallback((tabId: string, payload?: unknown) => {
    setState((current) => {
      if (current.tab === tabId) return current; // no duplicate history entry for a same-tab click
      if (!requestLeave()) return current; // I4 — a dirty form vetoes the navigation
      window.history.pushState({ tab: tabId, payload } satisfies HistoryState, '');
      setCanGoBack(true);
      return { tab: tabId, payload };
    });
  }, [requestLeave]);

  const goBack = useCallback(() => {
    if (!requestLeave()) return;
    window.history.back(); // resolved by the popstate listener above
  }, [requestLeave]);

  const consumePayload = useCallback(() => {
    setState((current) => ({ ...current, payload: undefined }));
  }, []);

  const setLeaveGuard = useCallback((guard: (() => boolean) | null) => {
    leaveGuardRef.current = guard;
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        activeTab: state.tab,
        navigationPayload: state.payload ?? null,
        navigateTo,
        goBack,
        canGoBack,
        consumePayload,
        setLeaveGuard,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within NavigationProvider');
  return context;
};
