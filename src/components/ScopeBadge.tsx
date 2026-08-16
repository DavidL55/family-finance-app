// D14/I5 — a persistent "מוצג: הנתונים שלך בלבד" pill whenever the resolved viewing scope is
// 'own'. A single member chip alone reads as "small family," not "restricted view" — this makes
// the restriction itself visible regardless of family size, on every one of the five Stage 5
// owned-collection screens (four via useOwnedCollectionScreen's viewScope, the read-only Net
// Worth screen via its own scope derivation — see task-3-report.md).
import React from 'react';

export function ScopeBadge({ scope }: { scope: 'own' | 'family' | 'none' }): React.JSX.Element | null {
  if (scope !== 'own') return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5"
      dir="rtl"
    >
      מוצג: הנתונים שלך בלבד
    </span>
  );
}
