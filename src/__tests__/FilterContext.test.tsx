import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { FilterProvider, useGlobalFilters, GLOBAL_FILTERS_SESSION_KEY } from '../contexts/FilterContext';

// M2 — FilterProvider now lifts useFamilyMembers()/useGroups() in, so every test in this file
// (including Task 1's, which never touch familyMembers/groups) needs these mocked; they're
// unaffected otherwise since they don't assert on the new fields.
vi.mock('../services/MembersService', () => ({
  listMembers: vi.fn(async () => [{ id: 'omer', name: 'עומר', color: '#1F4E78', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' }]),
}));
vi.mock('../services/GroupsService', () => ({ listGroups: vi.fn(async () => []) }));

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

  // M2 — FilterProvider is now the ONE place that calls listMembers/listGroups for the whole
  // app; FilterBar and Dashboard consume the result instead of each fetching independently.
  it('fetches familyMembers/groups once and exposes them through the context (M2 — shared by FilterBar and Dashboard, not fetched twice)', async () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    await waitFor(() => expect(result.current.familyMembers.status).toBe('ready'));
    expect(result.current.familyMembers.members[0].name).toBe('עומר');
    expect(result.current.groups.status).toBe('ready');
  });
});

// Task 1 review fold-in (i) — isGlobalFilterState previously only checked member.mode/memberIds,
// period.mode/month/year, and category.categories; period.quarter/startDate/endDate and
// member.groupId passed through unvalidated. Inert while nothing reads those fields, but Stage 7
// wires quarter/custom UI onto this exact persisted value — a wrong-typed leaf must be caught
// before then, not discovered as a runtime crash later.
describe('FilterProvider — tightened persisted-value validation (Task 1 review fold-in i)', () => {
  it('rejects a persisted value whose member.groupId is not a string or null', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'group', memberIds: [], groupId: 42 },
      period: { mode: 'month', month: '03', year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: [] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.mode).toBe('all');
  });

  it('rejects a persisted value whose period.quarter is not 1|2|3|4|null', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'all', memberIds: [], groupId: null },
      period: { mode: 'quarter', month: '03', year: '2026', quarter: 'Q1', startDate: null, endDate: null },
      category: { categories: [] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.period.mode).toBe('month');
  });

  it('rejects a persisted value whose period.startDate/endDate are not string or null', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'all', memberIds: [], groupId: null },
      period: { mode: 'custom', month: '03', year: '2026', quarter: null, startDate: 12345, endDate: null },
      category: { categories: [] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.period.mode).toBe('month');
  });

  it('accepts a valid quarter/custom-shaped value once the leaf types are actually correct', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'group', memberIds: [], groupId: 'kids' },
      period: { mode: 'custom', month: '03', year: '2026', quarter: 2, startDate: '2026-01-01', endDate: '2026-03-31' },
      category: { categories: [] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.groupId).toBe('kids');
    expect(result.current.filters.period.startDate).toBe('2026-01-01');
  });
});

// Task 1 review fold-in (ii) — three fail-safe scenarios were prose-only ("falls back to
// defaults, never throws") with no test actually exercising them.
describe('FilterProvider — untested fail-safe scenarios (Task 1 review fold-in ii)', () => {
  it('an old-shape/partial persisted object (missing the category key entirely) falls back to defaults', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'members', memberIds: ['omer'], groupId: null },
      period: { mode: 'month', month: '03', year: '2026', quarter: null, startDate: null, endDate: null },
      // category deliberately absent — an old-shape object from before this field existed.
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.mode).toBe('all');
    expect(result.current.filters.category.categories).toEqual([]);
  });

  it('a structurally-valid-but-wrong-typed leaf (period.month as a number) falls back to defaults', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'all', memberIds: [], groupId: null },
      period: { mode: 'month', month: 3, year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: [] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.period.month).not.toBe(3);
    expect(typeof result.current.filters.period.month).toBe('string');
  });

  it('sessionStorage.getItem THROWING (private mode / quota) falls back to defaults instead of crashing the render', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('access denied', 'SecurityError');
    });
    try {
      const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
      expect(result.current.filters.member.mode).toBe('all');
    } finally {
      spy.mockRestore();
    }
  });

  it('sessionStorage.setItem THROWING (private mode / quota) on the write path leaves in-memory state usable, never crashes', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    try {
      const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
      expect(() => {
        act(() => result.current.setCategoryFilter({ categories: ['מזון וצריכה'] }));
      }).not.toThrow();
      expect(result.current.filters.category.categories).toEqual(['מזון וצריכה']);
    } finally {
      spy.mockRestore();
    }
  });
});
