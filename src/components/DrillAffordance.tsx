// Review fix (Stage 5 Task 2, UX — controller-upgraded from Minor). The only prior cue that a KPI
// number was clickable was `hover:text-blue-600` on the value itself — hover never fires on touch,
// and touch is this app's primary surface, so on the device that matters most there was NO signal
// that a number opens a drill-down (quietly defeating the spec §5.1 promise this drill-down work
// exists to deliver).
//
// `<DrillAffordance />` is the ONE reusable pattern for that cue: a small, persistent, always-
// visible chevron rendered next to a drillable value. It is deliberately muted (text-slate-400,
// w-4 h-4) so it signals "opens something" without competing with the number, which stays the
// hero. RTL-aware via the same `rtl:-scale-x-100` flip already used elsewhere in this app (see the
// AI chat's <Send> icon in Dashboard.tsx) — ChevronRight points "forward" in LTR and gets mirrored
// to point toward the RTL reading direction's "forward" (left) when the document is RTL (the
// default here — see index.html's `dir="rtl"`).
//
// Tasks 4-7 add more drill-downs; every sibling screen with a drillable number should render
// `<DrillAffordance />` next to that number's own markup rather than reinventing a cue — do NOT
// re-derive the hover-only pattern this fix just removed.
import { ChevronRight } from 'lucide-react';

export function DrillAffordance({ className = '' }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      data-testid="drill-affordance"
      className={`inline-block w-4 h-4 shrink-0 align-[-2px] text-slate-400 rtl:-scale-x-100 ${className}`}
    />
  );
}
