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
import { useFamilyMembers, type FamilyMembersState } from '../hooks/useFamilyMembers';
import { useGroups, type GroupsState } from '../hooks/useGroups';
import type { ViewerAccess } from '../utils/memberVisibility';

export const GLOBAL_FILTERS_SESSION_KEY = 'ff_global_filters';

interface FilterContextType {
  filters: GlobalFilterState;
  setMemberSelection: (s: MemberSelection) => void;
  setPeriod: (p: PeriodFilter) => void;
  setCategoryFilter: (c: CategoryFilter) => void;
  resetFilters: () => void;
  // M2 — FilterProvider is the ONE place that calls useFamilyMembers()/useGroups() for the whole
  // app; FilterBar (Task 4) and Dashboard (Task 6) both read from here instead of each mounting
  // their own fetch. See task-2-report.md's "Shared fetch (M2)" section for the exact contract.
  familyMembers: FamilyMembersState;
  groups: GroupsState;
  // Dead-end avoidance for FilterBar's מי control (controller ruling, folded into Task 4 — see
  // src/utils/memberVisibility.ts). `null` unless the caller mounting <FilterProvider> supplies
  // it (App.tsx does, from the session it already has); tests that mount FilterProvider in
  // isolation simply get unrestricted behavior, matching pre-existing behavior.
  viewerAccess: ViewerAccess | null;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

const isQuarter = (v: unknown): v is 1 | 2 | 3 | 4 | null =>
  v === null || v === 1 || v === 2 || v === 3 || v === 4;
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

// Task 1 review fold-in (i): previously only checked member.mode/memberIds, period.mode/month/
// year, and category.categories — member.groupId and period.quarter/startDate/endDate passed
// through completely unvalidated (harmless while nothing read them, but Stage 7 wires real
// quarter/custom UI onto this exact persisted value, so a wrong-typed leaf must be caught here
// rather than surface as a runtime bug later). Still a shallow structural check by design, not a
// full recursive schema validator — see the module doc comment above.
function isGlobalFilterState(value: unknown): value is GlobalFilterState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const member = v.member as Record<string, unknown> | undefined;
  const period = v.period as Record<string, unknown> | undefined;
  const category = v.category as Record<string, unknown> | undefined;
  if (!member || typeof member.mode !== 'string' || !Array.isArray(member.memberIds)) return false;
  if (!isStringOrNull(member.groupId)) return false;
  if (!period || typeof period.mode !== 'string' || typeof period.month !== 'string' || typeof period.year !== 'string') {
    return false;
  }
  if (!isQuarter(period.quarter)) return false;
  if (!isStringOrNull(period.startDate) || !isStringOrNull(period.endDate)) return false;
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

export function FilterProvider({
  children,
  viewerAccess = null,
}: {
  children: React.ReactNode;
  viewerAccess?: ViewerAccess | null;
}) {
  const [filters, setFilters] = useState<GlobalFilterState>(() => loadPersistedFilters());
  // M2 — called ONCE here, for the whole app; see the FilterContextType doc comment above.
  const familyMembers = useFamilyMembers();
  const groups = useGroups();

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
    <FilterContext.Provider
      value={{ filters, setMemberSelection, setPeriod, setCategoryFilter, resetFilters, familyMembers, groups, viewerAccess }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export const useGlobalFilters = (): FilterContextType => {
  const context = useContext(FilterContext);
  if (!context) throw new Error('useGlobalFilters must be used within FilterProvider');
  return context;
};
