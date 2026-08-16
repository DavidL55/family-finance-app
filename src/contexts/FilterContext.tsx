// Global filter state (מי/מתי/מה, spec §5.3) — React Context + sessionStorage persistence (D1).
// Follows `NotificationContext.tsx`'s Provider/`useContext`-with-throw shape, the only precedent
// for a Context provider in this codebase.
//
// Persistence fails safe: a missing, corrupt, or old-shape sessionStorage value is treated
// exactly like "nothing persisted" and falls back to `defaultGlobalFilters()` — never throws,
// never half-applies a partially-valid object. `isGlobalFilterState` is a shallow structural
// check (not a full schema validator) — good enough to catch JSON.parse failures, an old-shape
// object from a previous stage, or `sessionStorage` tampering, without over-engineering a runtime
// schema for a same-session convenience cache.

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { GlobalFilterState, MemberSelection, PeriodFilter, CategoryFilter } from '../types/filters';
import { defaultGlobalFilters } from '../types/filters';

export const GLOBAL_FILTERS_SESSION_KEY = 'ff_global_filters';

interface FilterContextType {
  filters: GlobalFilterState;
  setMemberSelection: (s: MemberSelection) => void;
  setPeriod: (p: PeriodFilter) => void;
  setCategoryFilter: (c: CategoryFilter) => void;
  resetFilters: () => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

function isGlobalFilterState(value: unknown): value is GlobalFilterState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const member = v.member as Record<string, unknown> | undefined;
  const period = v.period as Record<string, unknown> | undefined;
  const category = v.category as Record<string, unknown> | undefined;
  if (!member || typeof member.mode !== 'string' || !Array.isArray(member.memberIds)) return false;
  if (!period || typeof period.mode !== 'string' || typeof period.month !== 'string' || typeof period.year !== 'string') {
    return false;
  }
  if (!category || !Array.isArray(category.categories)) return false;
  return true;
}

function loadPersistedFilters(): GlobalFilterState {
  try {
    const raw = sessionStorage.getItem(GLOBAL_FILTERS_SESSION_KEY);
    if (!raw) return defaultGlobalFilters();
    const parsed: unknown = JSON.parse(raw);
    if (!isGlobalFilterState(parsed)) return defaultGlobalFilters();
    return parsed;
  } catch {
    return defaultGlobalFilters();
  }
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilterState>(() => loadPersistedFilters());

  useEffect(() => {
    try {
      sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify(filters));
    } catch {
      // sessionStorage unavailable/full — filter state remains fully usable in-memory for the
      // rest of this session; it just won't survive a reload. Never throw out of this effect.
    }
  }, [filters]);

  const setMemberSelection = useCallback((s: MemberSelection) => {
    setFilters((prev) => ({ ...prev, member: s }));
  }, []);

  const setPeriod = useCallback((p: PeriodFilter) => {
    setFilters((prev) => ({ ...prev, period: p }));
  }, []);

  const setCategoryFilter = useCallback((c: CategoryFilter) => {
    setFilters((prev) => ({ ...prev, category: c }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(defaultGlobalFilters());
  }, []);

  return (
    <FilterContext.Provider value={{ filters, setMemberSelection, setPeriod, setCategoryFilter, resetFilters }}>
      {children}
    </FilterContext.Provider>
  );
}

export const useGlobalFilters = (): FilterContextType => {
  const context = useContext(FilterContext);
  if (!context) throw new Error('useGlobalFilters must be used within FilterProvider');
  return context;
};
