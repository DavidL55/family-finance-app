import type { BreakdownItem } from '../../components/FigureBreakdown';

export type SectionLayer = 'status' | 'balances' | 'trends' | 'future' | 'advice';
export interface FigureSource { collection: string; filter: string; asOf: string | null }
export interface ResolvedFigure {
  id: string; explainId: string; labelHe: string;
  value: number | null; items: BreakdownItem[]; source: FigureSource; state: 'ok' | 'empty';
}
export interface MonthPoint { period: string; endBalance: number | null; net: number }
export interface ResolvedSection {
  sectionId: string; layer: SectionLayer; titleHe: string;
  figures: ResolvedFigure[]; state: 'ok' | 'empty'; series?: MonthPoint[];
}
