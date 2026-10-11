import React, { useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { BOARDS, type BoardId } from '../config/boards';
import { useBankBoardData } from '../hooks/useBankBoardData';
import { resolveBankBoard } from '../lib/boards/resolveBank';
import { formatIsoDateHe } from '../lib/boards/formatDate';
import type { ResolvedFigure, ResolvedSection } from '../lib/boards/types';
import { Explain } from './Explain';
import { FigureBreakdown } from './FigureBreakdown';
import { Sparkline } from './Sparkline';
import { formatILS } from '../config/money';
import { currentAppDate } from '../config/time';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

interface BoardScreenProps { session: { memberId: string; role: PermissionRole }; accountsViewLevel: PermissionLevel | undefined }

/** The line under a figure: when it is true as of, or — for a figure with no data — when the data last arrived. */
function asOfLine(f: ResolvedFigure): string {
  if (!f.source.asOf) return 'אין נתונים';
  const asOf = formatIsoDateHe(f.source.asOf);
  return f.value === null ? `אין נתונים לחודש הזה — עדכון אחרון ${asOf}` : `נכון ל-${asOf}`;
}

function Figure({ f }: { f: ResolvedFigure }): React.JSX.Element {
  const value = f.value === null ? '—' : formatILS(f.value);
  const figure = (
    <span className="flex flex-col">
      <span className="text-sm text-slate-500 flex items-center gap-1">{f.labelHe}<Explain id={f.explainId} /></span>
      <span className={`text-2xl font-bold ${f.value !== null && f.value < 0 ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
      <span className="text-xs text-slate-400">{asOfLine(f)}</span>
    </span>
  );
  return <div data-testid={`figure.${f.id}`}><FigureBreakdown id={f.id} figure={figure} items={f.items} /></div>;
}

function Section({ s, open, onToggle }: { s: ResolvedSection; open: boolean; onToggle: () => void }): React.JSX.Element {
  const panelId = `panel.${s.sectionId}`;
  return (
    <div data-testid={`board.${s.sectionId}`} className="bg-white rounded-2xl shadow-sm border border-slate-100">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-right">
        <span className="font-semibold text-slate-800">{s.titleHe}</span>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={panelId} className="px-4 pb-4 space-y-3">
          {s.state === 'empty' ? (
            <p className="text-sm text-slate-500">אין תנועות עדיין — החשבון יתמלא בסנכרון הבא.</p>
          ) : (
            <>
              {s.series && <Sparkline series={s.series} id={s.sectionId} />}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{s.figures.map((f) => <Figure key={f.id} f={f} />)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function BoardScreen({ session, accountsViewLevel }: BoardScreenProps): React.JSX.Element {
  // Every hook sits above the early returns below (09.10.2026 rule).
  const [boardId] = useState<BoardId>('bank');                       // S1: one board; the selector arrives with the second board
  const data = useBankBoardData(session, accountsViewLevel);
  const today = useMemo(() => currentAppDate(), []);
  const sections = useMemo(() => (data.status === 'ready' ? resolveBankBoard(data.lines, data.accounts, today) : []), [data.status, data.lines, data.accounts, today]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const board = BOARDS.find((b) => b.id === boardId)!;
  const isOpen = (s: ResolvedSection) => open[s.sectionId] ?? s.layer === 'status';   // mobile-first: only status open

  if (data.status === 'permission-denied') {
    return <div className="p-8 text-center text-slate-600" dir="rtl">אין לך הרשאה לצפות בחשבונות</div>;
  }
  if (data.status === 'loading') {
    return <div className="p-8 flex items-center justify-center gap-2 text-slate-500" dir="rtl"><Loader2 className="w-5 h-5 animate-spin" />טוען…</div>;
  }
  if (data.status === 'error') {
    return (
      <div role="alert" className="m-4 p-4 rounded-xl border border-red-200 bg-red-50 text-red-700" dir="rtl">
        {data.errorMessage}
        <button type="button" onClick={data.reload} className="mr-3 underline">נסה שוב</button>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3" dir="rtl" data-testid={`board.${board.id}`}>
      <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><board.icon className="w-5 h-5" />{board.labelHe}</h1>
      {sections.map((s) => <Section key={s.sectionId} s={s} open={isOpen(s)} onToggle={() => setOpen((o) => ({ ...o, [s.sectionId]: !isOpen(s) }))} />)}
    </div>
  );
}
