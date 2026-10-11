import React from 'react';
import type { MonthPoint } from '../lib/boards/types';

/** 12 month-end balances as one polyline; a null month breaks the line (a gap, not a zero). */
export function Sparkline({ series, id }: { series: MonthPoint[]; id: string }): React.JSX.Element {
  const vals = series.map((p) => p.endBalance).filter((v): v is number => v !== null);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const W = 240, H = 48, step = W / Math.max(1, series.length - 1);
  const y = (v: number) => H - ((v - min) / span) * (H - 4) - 2;
  const segments: string[] = []; let cur: string[] = [];
  series.forEach((p, i) => {
    if (p.endBalance === null) { if (cur.length) segments.push(cur.join(' ')); cur = []; return; }
    cur.push(`${(i * step).toFixed(1)},${y(p.endBalance).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));
  return (
    <svg data-testid={`sparkline.${id}`} viewBox={`0 0 ${W} ${H}`} className="w-full h-12" role="img" aria-label="יתרת סוף חודש, 12 חודשים">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.15" />
      {segments.map((pts, i) => <polyline key={i} points={pts} fill="none" stroke="currentColor" strokeWidth="2" />)}
    </svg>
  );
}
