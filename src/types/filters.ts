// Global filter state — spec §5.3's three dimensions (מי/מתי/מה). Lives in `FilterContext`
// (React Context + sessionStorage persistence, D1) rather than the URL — this app has no router.
//
// `PeriodMode` is typed for all four modes now (D2) even though `FilterBar` only renders
// month-selection UI this stage; quarter/year/custom exist so Stage 5/7 consumers don't force a
// breaking type change later. `CategoryFilter` is the whole of "מה" (D3) — module filtering is
// already expressed as nav via the module registry, so there is no separate module dimension here.

export type MemberSelectionMode = 'all' | 'members' | 'group';

export interface MemberSelection {
  mode: MemberSelectionMode;
  memberIds: string[]; // meaningful when mode === 'members'
  groupId: string | null; // meaningful when mode === 'group'
}

export type PeriodMode = 'month' | 'quarter' | 'year' | 'custom'; // D2 — only 'month' has UI this stage

export interface PeriodFilter {
  mode: PeriodMode;
  month: string; // 'MM', meaningful when mode === 'month'
  year: string; // 'YYYY'
  quarter: 1 | 2 | 3 | 4 | null;
  startDate: string | null; // ISO, meaningful when mode === 'custom'
  endDate: string | null;
}

export interface CategoryFilter {
  categories: string[]; // empty = all (D3 — no separate module dimension)
}

export interface GlobalFilterState {
  member: MemberSelection;
  period: PeriodFilter;
  category: CategoryFilter;
}

export const ALL_MEMBERS_SELECTION: MemberSelection = {
  mode: 'all',
  memberIds: [],
  groupId: null,
};

export function defaultPeriodFilter(now: Date = new Date()): PeriodFilter {
  return {
    mode: 'month',
    month: String(now.getMonth() + 1).padStart(2, '0'),
    year: String(now.getFullYear()),
    quarter: null,
    startDate: null,
    endDate: null,
  };
}

export function defaultGlobalFilters(now: Date = new Date()): GlobalFilterState {
  return {
    member: ALL_MEMBERS_SELECTION,
    period: defaultPeriodFilter(now),
    category: { categories: [] },
  };
}
