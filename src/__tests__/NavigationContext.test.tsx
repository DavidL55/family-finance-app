import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';

function wrapper({ children }: { children: ReactNode }) {
  return <NavigationProvider>{children}</NavigationProvider>;
}

describe('NavigationProvider / useNavigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '');
  });

  it('throws when used outside the provider', () => {
    const { result } = renderHook(() => {
      try { return useNavigation(); } catch (e) { return e as Error; }
    });
    expect(result.current).toBeInstanceOf(Error);
  });
  it('starts on "dashboard"', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    expect(result.current.activeTab).toBe('dashboard');
  });
  it('navigateTo updates activeTab', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    act(() => result.current.navigateTo('expenses'));
    expect(result.current.activeTab).toBe('expenses');
  });
});

describe('NavigationContext (D11 — back-stack)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '');
  });

  it('navigateTo pushes a real history entry carrying the tab id', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.activeTab).toBe('accounts');
    expect((window.history.state as { tab?: string })?.tab).toBe('accounts');
  });

  it('navigateTo to the already-active tab is a no-op — no duplicate history entry', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    const lengthBefore = window.history.length;
    act(() => result.current.navigateTo('dashboard')); // already the default
    expect(window.history.length).toBe(lengthBefore);
  });

  it('a popstate event (OS/browser back gesture) updates activeTab to match', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { tab: 'dashboard' } }));
    });
    expect(result.current.activeTab).toBe('dashboard');
  });

  it('goBack() calls history.back(), which the popstate handler resolves', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    const backSpy = vi.spyOn(window.history, 'back');
    act(() => result.current.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('canGoBack is false on the initial screen, true after one navigateTo', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.canGoBack).toBe(true);
  });

  it('canGoBack is true on mount when the persisted history state is a drilled-down screen (reload case)', () => {
    // Simulates a full page reload while on a deep screen: history.state already carries the
    // drilled-down tab (and its depth) before the provider ever mounts.
    window.history.replaceState({ tab: 'accounts', depth: 1 }, '');
    const { result } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.activeTab).toBe('accounts');
    expect(result.current.canGoBack).toBe(true);
  });

  it('canGoBack is false on the origin screen after a navigate-then-back round trip', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.canGoBack).toBe(true);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { tab: 'dashboard', depth: 0 } }));
    });
    expect(result.current.activeTab).toBe('dashboard');
    expect(result.current.canGoBack).toBe(false);
  });
});

describe('NavigationContext (D11 — payload)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '');
  });

  it('navigateTo(tabId, payload) makes payload available as navigationPayload', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts', { prefillCreate: { balance: 5000 } }));
    expect(result.current.navigationPayload).toEqual({ prefillCreate: { balance: 5000 } });
  });
  it('consumePayload() clears it so a later plain navigation does not resurface stale intent', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts', { prefillCreate: { balance: 5000 } }));
    act(() => result.current.consumePayload());
    expect(result.current.navigationPayload).toBeNull();
  });
});

describe('NavigationContext (D11 — leave-guard)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '');
  });

  it('a registered guard returning false blocks navigateTo', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    const guard = vi.fn().mockReturnValue(false);
    act(() => result.current.setLeaveGuard(guard));
    act(() => result.current.navigateTo('accounts'));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(result.current.activeTab).toBe('dashboard'); // navigation blocked
  });
  it('a registered guard returning true allows navigateTo through', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.setLeaveGuard(() => true));
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.activeTab).toBe('accounts');
  });
  it('goBack() is guarded the same way as navigateTo', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    const guard = vi.fn().mockReturnValue(false);
    act(() => result.current.setLeaveGuard(guard));
    act(() => result.current.goBack());
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
