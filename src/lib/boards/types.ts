import type { BreakdownItem } from '../../components/FigureBreakdown';

export type SectionLayer = 'status' | 'balances' | 'trends' | 'future' | 'advice';
export interface FigureSource { collection: string; filter: string; asOf: string | null }
export interface ResolvedFigure {
  id: string; explainId: string; labelHe: string;
  value: number | null; items: BreakdownItem[]; source: FigureSource; state: 'ok' | 'empty';
}
/** endBalance and net are null for a month with no verified lines — no data is not ₪0. */
export interface MonthPoint { period: string; endBalance: number | null; net: number | null }
export interface ResolvedSection {
  sectionId: string; layer: SectionLayer; titleHe: string;
  figures: ResolvedFigure[]; state: 'ok' | 'empty'; series?: MonthPoint[];
}
