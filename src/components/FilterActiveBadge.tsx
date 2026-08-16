// Ofra ruling I4 — D7's half-state made visible: FilterBar only mounts on Dashboard
// (usesGlobalFilters, D7), but the filters it sets persist across every other screen
// (sessionStorage, D1). Without this, a user filters to "עומר" on Dashboard, switches to another
// tab, comes back later, and finds it silently still filtered. This small pill lives in the app
// header (outside FilterBar's conditional mount) so it's visible on EVERY screen whenever the
// global filter differs from default, with a one-tap clear.
import React from 'react';
import { useGlobalFilters } from '../contexts/FilterContext';
import { isDefaultGlobalFilters } from '../types/filters';

export function FilterActiveBadge(): React.JSX.Element | null {
  const { filters, resetFilters } = useGlobalFilters();

  if (isDefaultGlobalFilters(filters)) return null;

  return (
    <button
      type="button"
      onClick={resetFilters}
      data-testid="filter-active-badge"
      className="flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors min-h-[44px]"
      title="פילטר גלובלי פעיל — לחץ לניקוי"
    >
      <span>פילטר פעיל</span>
      <span className="underline">נקה</span>
    </button>
  );
}
