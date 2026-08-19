// src/config/money.ts — Stage 7 T7b (§7, "One money formatter").
//
// `formatILS` MOVED HERE from `src/config/aiCeiling.ts`, byte-identical. A move, not a rewrite:
// the body and every comment below are unchanged, and `aiCeiling.ts` re-exports the name so
// `aiOverage.ts` and `AiSettingsScreen.tsx` keep working without an edit.
//
// WHY IT MOVED. `aiCeiling.ts` is the AI cost gate's client half. Stage 7 puts ₪ figures on the
// Dashboard's forecast card and on a whole forecast screen, and a forecast module importing the
// AI ceiling module to format a shekel is a dependency that says something false about what the
// forecast depends on. This module is neutral and, like `aiCeiling.ts`, IMPORTS NOTHING — which
// is what keeps `forecastCopy.ts` (whose own header says it cannot reach a formatter) honest
// about where formatting happens: at the render boundary, never inside the copy.

// Task 8 review F8 (Ofra) — one money formatter. Before this, the same table rendered ₪0 (for a
// real ₪0.0004 charge — a genuine cost displayed as nothing), ₪0.038 and ₪1,234.568 side by side:
// no fraction-digit control and `toLocaleString()` with no locale, so grouping followed each
// device. ComparisonTable.tsx already pins 'he-IL'; this follows it.
const MIN_DISPLAYED_ILS = 0.01;

/**
 * Batch 6 (closing review B1) — `number | null`. The server says "unreadable" explicitly instead
 * of leaking a NaN that only rendered as ₪— by accident of Number.isFinite; the guard stays for a
 * NaN arriving some other way, but null is the typed, intended path.
 */
export function formatILS(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '₪—';
  // A charge that is real but smaller than an agora must not round away to "₪0.00", which reads
  // as free. Chosen over adding more decimal places (₪0.0004 is noise a reader cannot use, and it
  // would wreck column alignment for the ₪1,234.57 beside it) and over "₪0.01" (that would round
  // UP, overstating a real number on a screen this batch exists to make honest). "Less than an
  // agora" is the only form that is both readable and true.
  if (amount > 0 && amount < MIN_DISPLAYED_ILS) return `פחות מ-₪${MIN_DISPLAYED_ILS.toFixed(2)}`;
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
