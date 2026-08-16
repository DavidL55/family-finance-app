import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';

describe('NavigationProvider / useNavigation', () => {
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
