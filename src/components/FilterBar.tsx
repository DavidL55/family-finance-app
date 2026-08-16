// Global sticky FilterBar (spec §5.3, מי/מתי/מה) — the shell every future module screen will
// mount its own controls into, this stage limited to Dashboard (D7). Sits directly under
// App.tsx's sticky header (`sticky top-[57px] md:top-[73px]`, matching the header's own height).
//
// Mobile-first collapse (Ofra ruling B2): three always-expanded rows pinned under a sticky header
// above a fixed bottom nav would eat the glance on the one screen this stage exists to improve.
// A single tap-to-expand summary line (`filter-summary-line`) is always visible; the real מי/מתי/
// מה controls (`filter-detail-sections`) are collapsed (`hidden`) behind it on mobile and always
// shown on desktop (`md:block`) — the collapse is a mobile-only concession, not a permanent hide.
//
// Shared fetch (M2): familyMembers/groups come from FilterContext (lifted there once, Task 2/4),
// not from a second listMembers()/listGroups() call here. Dead-end avoidance (controller ruling,
// folded from Task 1's review): the מי control only ever offers members `viewerAccess` says the
// current viewer can actually see real data for — see src/utils/memberVisibility.ts.
//
// Empty-vs-error, explicitly: the מי section gates on familyMembers.status/groups.status, and the
// מה section gates on its own local categories-load status — a failed read renders an explicit
// error + retry, never an empty-looking family/category list (this project's repeatedly-re-broken
// rule).
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useGlobalFilters } from '../contexts/FilterContext';
import { getCategories } from '../services/CategoriesService';
import { MemberMultiSelect } from './MemberMultiSelect';
import { filterViewableMembers } from '../utils/memberVisibility';
import type { PeriodFilter } from '../types/filters';

const MONTHS_HE: { value: string; label: string }[] = [
  { value: '01', label: 'ינואר' }, { value: '02', label: 'פברואר' }, { value: '03', label: 'מרץ' },
  { value: '04', label: 'אפריל' }, { value: '05', label: 'מאי' }, { value: '06', label: 'יוני' },
  { value: '07', label: 'יולי' }, { value: '08', label: 'אוגוסט' }, { value: '09', label: 'ספטמבר' },
  { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' },
];

function monthLabel(month: string): string {
  return MONTHS_HE.find((m) => m.value === month)?.label ?? month;
}

function describeMemberSelection(
  filters: ReturnType<typeof useGlobalFilters>['filters'],
  members: { id: string; name: string }[],
  groups: { id: string; name: string }[]
): string {
  if (filters.member.mode === 'all') return 'כולם';
  if (filters.member.mode === 'group') {
    return groups.find((g) => g.id === filters.member.groupId)?.name ?? 'כולם';
  }
  const names = filters.member.memberIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter((n): n is string => typeof n === 'string');
  return names.length > 0 ? names.join(', ') : 'כולם';
}

function describeCategoryFilter(categories: string[]): string {
  if (categories.length === 0) return 'הכל';
  if (categories.length === 1) return categories[0];
  return `${categories.length} קטגוריות`;
}

type CategoriesLoadState =
  | { status: 'loading'; categories: string[]; error: null }
  | { status: 'error'; categories: string[]; error: string }
  | { status: 'ready'; categories: string[]; error: null };

export default function FilterBar(): React.JSX.Element {
  const { filters, setMemberSelection, setPeriod, setCategoryFilter, familyMembers, groups, viewerAccess } =
    useGlobalFilters();
  const [isExpanded, setIsExpanded] = useState(false);

  const [categoriesState, setCategoriesState] = useState<CategoriesLoadState>({
    status: 'loading',
    categories: [],
    error: null,
  });
  const [categoriesReloadToken, setCategoriesReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCategoriesState((prev) => ({ status: 'loading', categories: prev.categories, error: null }));
    getCategories()
      .then((list) => {
        if (cancelled) return;
        setCategoriesState({ status: 'ready', categories: list, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCategoriesState((prev) => ({
          status: 'error',
          categories: prev.categories,
          error: err instanceof Error ? err.message : 'שגיאה בטעינת קטגוריות',
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [categoriesReloadToken]);

  // Dead-end avoidance (controller ruling): don't offer a chip for a family member the current
  // viewer has no grant to see real data for — see memberVisibility.ts's doc comment.
  const { members: viewableMembers, groups: viewableGroups } = useMemo(
    () => filterViewableMembers(familyMembers.members, groups.groups, viewerAccess),
    [familyMembers.members, groups.groups, viewerAccess]
  );

  // Critical review fix: the collapsed line is the ONLY thing visible by default on mobile, and
  // it was previously composed with zero regard for familyMembers.status/groups.status/
  // categoriesState.status — a failed listMembers() rendered a perfectly ordinary-looking
  // "כולם · אוגוסט 2026 · הכל" while the app actually knew nothing. Error takes priority over
  // loading (a genuinely broken read must never be swallowed by a "still loading" reading, e.g.
  // if categories fail after members already loaded). Loading gets a neutral placeholder rather
  // than composing text that would otherwise assert "כולם" as settled fact before the fetch has
  // even resolved once.
  const membersLoadFailed = familyMembers.status === 'error' || groups.status === 'error';
  const membersLoading = familyMembers.status === 'loading' || groups.status === 'loading';
  const summaryLoadFailed = membersLoadFailed || categoriesState.status === 'error';
  const summaryLoading = !summaryLoadFailed && (membersLoading || categoriesState.status === 'loading');

  const summaryLine = useMemo(() => {
    if (summaryLoadFailed) return '⚠ שגיאה בטעינת הסינון';
    if (summaryLoading) return 'טוען סינון...';
    return [
      describeMemberSelection(filters, viewableMembers, viewableGroups),
      `${monthLabel(filters.period.month)} ${filters.period.year}`,
      describeCategoryFilter(filters.category.categories),
    ].join(' · ');
  }, [summaryLoadFailed, summaryLoading, filters, viewableMembers, viewableGroups]);

  const shiftMonth = (direction: 1 | -1): void => {
    const idx = MONTHS_HE.findIndex((m) => m.value === filters.period.month);
    let nextIdx = idx + direction;
    let nextYear = parseInt(filters.period.year, 10);
    if (nextIdx > 11) {
      nextIdx = 0;
      nextYear += 1;
    } else if (nextIdx < 0) {
      nextIdx = 11;
      nextYear -= 1;
    }
    const next: PeriodFilter = {
      ...filters.period,
      month: MONTHS_HE[nextIdx].value,
      year: String(nextYear),
    };
    setPeriod(next);
  };

  const toggleCategory = (category: string): void => {
    const has = filters.category.categories.includes(category);
    const next = has
      ? filters.category.categories.filter((c) => c !== category)
      : [...filters.category.categories, category];
    setCategoryFilter({ categories: next });
  };

  const retryMembersLoad = (): void => {
    familyMembers.reload();
    groups.reload();
  };

  return (
    <div
      data-testid="global-filter-bar"
      dir="rtl"
      className="sticky top-[57px] md:top-[73px] z-40 bg-white border-b border-slate-200"
    >
      <button
        type="button"
        data-testid="filter-summary-line"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 min-h-[44px] text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors md:hidden"
      >
        <span className="truncate">{summaryLine}</span>
        <span className="text-slate-400 flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
      </button>

      <div
        data-testid="filter-detail-sections"
        className={`${isExpanded ? 'block' : 'hidden'} md:block px-4 py-3 space-y-3 md:flex md:items-start md:gap-6 md:space-y-0`}
      >
        <div data-tour-id="filter.who" className="space-y-1.5">
          <h3 className="text-xs font-semibold text-slate-500">מי</h3>
          {membersLoading && <p className="text-sm text-slate-400">טוען בני משפחה...</p>}
          {membersLoadFailed && (
            <div className="text-sm text-red-600 flex items-center gap-2">
              <span>שגיאה בטעינת בני המשפחה</span>
              <button type="button" onClick={retryMembersLoad} className="underline">
                נסה שוב
              </button>
            </div>
          )}
          {familyMembers.status === 'ready' && groups.status === 'ready' && (
            <MemberMultiSelect
              members={viewableMembers}
              groups={viewableGroups}
              value={filters.member}
              onChange={setMemberSelection}
            />
          )}
        </div>

        <div data-tour-id="filter.when" className="space-y-1.5">
          <h3 className="text-xs font-semibold text-slate-500">מתי</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="חודש קודם"
              onClick={() => shiftMonth(-1)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-slate-700 min-w-[7rem] text-center">
              {monthLabel(filters.period.month)} {filters.period.year}
            </span>
            <button
              type="button"
              aria-label="חודש הבא"
              onClick={() => shiftMonth(1)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div data-tour-id="filter.what" className="space-y-1.5">
          <h3 className="text-xs font-semibold text-slate-500">מה</h3>
          {categoriesState.status === 'loading' && categoriesState.categories.length === 0 && (
            <p className="text-sm text-slate-400">טוען קטגוריות...</p>
          )}
          {categoriesState.status === 'error' && (
            <div className="text-sm text-red-600 flex items-center gap-2">
              <span>שגיאה בטעינת קטגוריות</span>
              <button
                type="button"
                onClick={() => setCategoriesReloadToken((t) => t + 1)}
                className="underline"
              >
                נסה שוב
              </button>
            </div>
          )}
          {categoriesState.categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categoriesState.categories.map((category) => {
                const selected = filters.category.categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCategory(category)}
                    className={`rounded-full border px-3 py-1.5 text-sm min-h-[44px] transition-colors ${
                      selected
                        ? 'bg-blue-50 border-blue-400 text-blue-800'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
