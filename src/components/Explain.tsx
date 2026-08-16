// D5 — the ⓘ trigger is always present and always tap/click-able; hover is a desktop convenience
// layered on top, never a second interaction model. This is what makes it compliant with spec
// §5.2's explicit "אין אינטראקציה קריטית שתלויה בריחוף בלבד" (no interaction depends solely on
// hover) without branching on device type: `onMouseEnter` opens the card (desktop-only in
// practice, since touch doesn't fire it), `onClick` toggles a `pinned` state that keeps it open
// regardless of hover — the same code path serves "hover on desktop" and "tap or long-press on
// mobile" from one component.
//
// Looks up its copy in the single central glossary (src/config/glossary.ts, D4). An unknown id
// renders nothing rather than a broken info button — a dev-only console.warn flags the mistake
// without breaking the screen for a real user.
//
// D12 — carries a stable `data-tour-id={`explain.${id}`}` for Stage 10's guided tour.
// Ofra ruling — the ⓘ glyph is small, but its tap target isn't: `min-w-[44px] min-h-[44px]`.
import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { getGlossaryEntry } from '../config/glossary';

export function Explain({ id }: { id: string }): React.JSX.Element | null {
  const entry = getGlossaryEntry(id);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const close = (): void => {
      setPinned(false);
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const handleOutsideClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`Explain: unknown glossary id "${id}" — rendering nothing`);
    }
    return null;
  }

  const handleMouseEnter = (): void => setOpen(true);
  const handleMouseLeave = (): void => {
    if (!pinned) setOpen(false);
  };
  const handleClick = (): void => {
    setPinned((prev) => {
      const next = !prev;
      setOpen(next);
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative inline-block" dir="rtl">
      <button
        type="button"
        aria-label={`הסבר: ${entry.title}`}
        data-tour-id={`explain.${id}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
      >
        <Info className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-lg"
        >
          <p className="font-semibold text-slate-900">{entry.title}</p>
          <p className="mt-1">{entry.explanation}</p>
          <p className="mt-1 text-xs text-slate-500">איך מחשבים: {entry.howComputed}</p>
          <p className="mt-1 text-xs text-slate-500">מקור: {entry.source}</p>
          {entry.asOf && <p className="mt-1 text-xs text-slate-500">נכון ל: {entry.asOf}</p>}
        </div>
      )}
    </div>
  );
}
