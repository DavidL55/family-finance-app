// General-purpose "who has how much" comparison primitive (spec §5.4, D9). Built as a
// complete, independently tested component here; D9 wires it to a real Dashboard consumer in
// Task 6 ("מי הוציא כמה החודש", fed by settlementData) — it does not ship unseen.
//
// Reuses the exact same showAll/query large-family pattern MemberMultiSelect uses, so both
// large-family controls in this codebase behave identically (search bypasses the collapse,
// collapse only appears once there's something to hide).
import React, { useMemo, useState } from 'react';

export interface ComparisonRow {
  memberId: string;
  name: string;
  color: string;
  value: number;
}

export interface ComparisonTableProps {
  rows: ComparisonRow[];
  valueLabel: string;
  topN?: number;
}

// Same threshold MemberMultiSelect uses.
const DEFAULT_TOP_N = 8;

export function ComparisonTable({ rows, valueLabel, topN = DEFAULT_TOP_N }: ComparisonTableProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.value - a.value), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return sorted;
    return sorted.filter((r) => r.name.includes(q));
  }, [sorted, query]);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-slate-400 p-4 text-center" dir="rtl">
        אין נתונים להשוואה.
      </div>
    );
  }

  const canCollapse = rows.length > topN;
  const isSearching = canCollapse && query.trim().length > 0;
  const visible = canCollapse && !isSearching && !showAll ? filtered.slice(0, topN) : filtered;
  const hiddenCount = filtered.length - visible.length;

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{valueLabel}</span>
      </div>

      {canCollapse && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      <div className="divide-y divide-slate-100">
        {visible.map((row) => (
          <div key={row.memberId} className="flex items-center justify-between py-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
              <span className="text-sm text-slate-700 truncate">{row.name}</span>
            </div>
            <span className="text-sm font-medium text-slate-800 flex-shrink-0">
              {row.value < 0 ? '-' : ''}₪{Math.abs(row.value).toLocaleString('he-IL')}
            </span>
          </div>
        ))}
      </div>

      {canCollapse && !isSearching && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-sm text-blue-600 hover:underline min-h-[44px]"
        >
          {`הצג את כל ה־${rows.length} רשומות`}
        </button>
      )}
    </div>
  );
}
