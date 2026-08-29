// src/components/FigureBreakdown.tsx — Stage 8 S1 ("הערסל"). The accordion under a composite figure.
//
// David's rule 2 (docs/superpowers/specs/2026-08-29-glanceable-screens-design.md): a figure that
// is a SUM of components opens IN PLACE — click the number, see what it is made of, click again
// to collapse. The screen stays glanceable because the breakdown lives under the figure it
// explains, not in a modal or another screen.
//
// Design rulings this encodes:
// - A real <button> with aria-expanded — keyboard and touch first-class; hover is never the only
//   path (Ofra). The chevron is decoration; the whole figure is the target.
// - EMPTY items render the figure PLAIN, with no button role at all. A dead accordion that opens
//   onto nothing teaches the reader to stop clicking; better to promise nothing than break a
//   promise (the same fail-honest instinct as "₪0 never means unknown").
// - Items are sorted largest-first so the first line answers "what dominates this number".
// - Amounts go through formatILS — the app's ONE money formatter — with tabular-nums (§7).
// - This component RENDERS what it is handed and fetches nothing (Sun: UI renders only). The
//   caller owns data, loading, and error states; by the time items reach here they are truth.
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatILS } from '../config/money';

export interface BreakdownItem {
  label: string;
  amountILS: number;
}

export function FigureBreakdown({
  id,
  figure,
  items,
  footer,
}: {
  /** Stable id — becomes the testid/tour hook (`breakdown.<id>`). */
  id: string;
  /** The composite figure exactly as the screen already renders it. */
  figure: React.ReactNode;
  /** The components the figure sums. Empty → plain figure, no accordion. */
  items: BreakdownItem[];
  /** Optional last row of the OPEN panel — e.g. the drill link to the full screen. */
  footer?: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (items.length === 0) {
    // No accordion for nothing — but a footer (the drill link to the full screen) must survive
    // an empty month, or D8's "one obvious click away" dies exactly when a reader most wants to
    // check why a figure is empty. Rendered inline, visible immediately.
    return (
      <div data-testid={`breakdown.${id}`}>
        {figure}
        {footer !== undefined && (
          <div className="mt-1 text-sm" data-testid={`breakdown.${id}.footer-inline`}>{footer}</div>
        )}
      </div>
    );
  }
  const sorted = [...items].sort((a, b) => Math.abs(b.amountILS) - Math.abs(a.amountILS));
  return (
    <div data-testid={`breakdown.${id}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-tour-id={`breakdown.${id}`}
        className="inline-flex items-center gap-1 text-right hover:opacity-80 transition-opacity"
      >
        {figure}
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-r-2 border-slate-200 pr-3" data-testid={`breakdown.${id}.panel`}>
          {sorted.map((item, i) => (
            <li key={`${item.label}-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span data-testid="breakdown.item.label" className="text-slate-600">{item.label}</span>
              <span className="font-medium text-slate-800 tabular-nums">{formatILS(item.amountILS)}</span>
            </li>
          ))}
          {footer !== undefined && (
            <li className="pt-1 text-sm" data-testid="breakdown.footer">{footer}</li>
          )}
        </ul>
      )}
    </div>
  );
}
