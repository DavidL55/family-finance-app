import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { FilterProvider, useGlobalFilters, GLOBAL_FILTERS_SESSION_KEY } from '../contexts/FilterContext';

beforeEach(() => sessionStorage.clear());

describe('FilterProvider / useGlobalFilters', () => {
  it('throws when used outside the provider', () => {
    const { result } = renderHook(() => {
      try { return useGlobalFilters(); } catch (e) { return e as Error; }
    });
    expect(result.current).toBeInstanceOf(Error);
  });

  it('starts with defaults (mode "all", current month, no categories) when nothing is persisted', () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.mode).toBe('all');
    expect(result.current.filters.category.categories).toEqual([]);
  });

  it('setMemberSelection updates state and persists to sessionStorage', () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    act(() => result.current.setMemberSelection({ mode: 'members', memberIds: ['omer'], groupId: null }));
    expect(result.current.filters.member.memberIds).toEqual(['omer']);
    const persisted = JSON.parse(sessionStorage.getItem(GLOBAL_FILTERS_SESSION_KEY)!);
    expect(persisted.member.memberIds).toEqual(['omer']);
  });

  it('hydrates from a valid persisted value on mount', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'members', memberIds: ['omer'], groupId: null },
      period: { mode: 'month', month: '03', year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: ['מזון וצריכה'] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.memberIds).toEqual(['omer']);
    expect(result.current.filters.period.month).toBe('03');
  });

  it('a corrupt persisted value falls back to defaults instead of throwing', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, '{not valid json');
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.mode).toBe('all');
  });

  it('resetFilters restores defaults', () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    act(() => result.current.setCategoryFilter({ categories: ['x'] }));
    act(() => result.current.resetFilters());
    expect(result.current.filters.category.categories).toEqual([]);
  });
});
