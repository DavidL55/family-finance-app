import type { BankLine, BankLineKind } from '../../types/bank';
import type { Account } from '../../types/finance';
import type { ResolvedFigure, ResolvedSection, FigureSource } from './types';
import { monthSeries, lastLineOf, firstLineOf, preBalanceOf, periodMinus } from './monthSeries';
import { formatIsoDateHe } from './formatDate';

const KIND_HE: Record<BankLineKind, string> = {
  'card-charge': 'חיובי כרטיסי אשראי', 'standing-order': 'הוראות קבע', 'transfer-internal': 'העברות פנימיות',
  'transfer-in': 'העברות נכנסות', cash: 'משיכות מזומן', fee: 'עמלות וריבית', income: 'הכנסות', other: 'אחר',
};
/** Order on the board: the joint account first (spec §2 — "המשותף הכי חשוב"), then by name. */
const ACCOUNT_ORDER = ['acc-poalim-joint', 'acc-poalim-david', 'acc-poalim-lilit'];
const shortId = (accountId: string) => accountId.replace('acc-poalim-', '');   // 'joint' | 'david' | 'lilit'

const round2 = (n: number) => Math.round(n * 100) / 100;
const src = (accountId: string, filter: string, asOf: string | null): FigureSource =>
  ({ collection: 'bank_lines', filter: `accountId = ${accountId}; ${filter}`, asOf });

function byKind(lines: BankLine[], sign: 'debit' | 'credit') {
  const sums = new Map<BankLineKind, number>();
  for (const l of lines) { const v = l[sign]; if (v) sums.set(l.kind, (sums.get(l.kind) ?? 0) + v); }
  return [...sums.entries()].map(([k, v]) => ({ label: KIND_HE[k], amountILS: round2(v) }));
}

export function resolveBankBoard(lines: BankLine[], accounts: Account[], today: string): ResolvedSection[] {
  const period = today.slice(0, 7);
  const ordered = [...accounts].sort((a, b) =>
    (ACCOUNT_ORDER.indexOf(a.id) + 1 || 99) - (ACCOUNT_ORDER.indexOf(b.id) + 1 || 99) || a.name.localeCompare(b.name, 'he'));
  const out: ResolvedSection[] = [];
  for (const acct of ordered) {
    const s = shortId(acct.id);
    const own = lines.filter((l) => l.accountId === acct.id && l.verified && l.date <= today);
    const latest = lastLineOf(own);
    const month = own.filter((l) => l.period === period);
    const external = month.filter((l) => l.kind !== 'transfer-internal');
    const monthOut = round2(external.reduce((t, l) => t + (l.debit ?? 0), 0));
    const monthIn = round2(external.reduce((t, l) => t + (l.credit ?? 0), 0));
    const empty = own.length === 0;
    // Lines exist but none this month (the sync has not reached it yet): the month figures are unknown, not ₪0.
    const noMonthData = month.length === 0;
    const fig = (id: string, labelHe: string, value: number | null, items: ResolvedFigure['items'], filter: string, asOf: string | null): ResolvedFigure =>
      ({ id: `bank.${s}.${id}`, explainId: `bank.${id}`, labelHe, value, items, source: src(acct.id, filter, asOf), state: empty ? 'empty' : 'ok' });
    const monthFig = (id: string, labelHe: string, value: number, items: ResolvedFigure['items'], filter: string): ResolvedFigure =>
      fig(id, labelHe, noMonthData ? null : value, noMonthData ? [] : items, filter, latest?.date ?? null);
    const internal = month.filter((l) => l.kind === 'transfer-internal');

    out.push({
      sectionId: `bank.${s}.status`, layer: 'status', titleHe: `${acct.name} — היום`, state: empty ? 'empty' : 'ok',
      figures: [
        fig('balanceToday', 'יתרה היום', latest ? latest.balance : null, [], 'latest verified line ≤ today', latest?.date ?? null),
        monthFig('monthOut', 'יצא החודש', monthOut, byKind(external, 'debit'), `period = ${period}; debit; kind ≠ transfer-internal`),
        monthFig('monthIn', 'נכנס החודש', monthIn, byKind(external, 'credit'), `period = ${period}; credit; kind ≠ transfer-internal`),
      ],
    });
    const net = round2(monthIn - monthOut);
    out.push({
      sectionId: `bank.${s}.balances`, layer: 'balances', titleHe: `${acct.name} — תנועות החודש`, state: empty ? 'empty' : 'ok',
      figures: [
        monthFig('monthNet', 'נכנס פחות יצא החודש', net,
          [...byKind(external, 'credit').map((i) => ({ ...i, label: `נכנס: ${i.label}` })),
            ...byKind(external, 'debit').map((i) => ({ label: `יצא: ${i.label}`, amountILS: -i.amountILS }))],
          `period = ${period}; credit − debit; kind ≠ transfer-internal`),
        monthFig('internalMoved', 'הועבר בין החשבונות שלנו', round2(internal.reduce((t, l) => t + (l.credit ?? 0) + (l.debit ?? 0), 0)),
          internal.map((l) => ({ label: `${formatIsoDateHe(l.date)} ${l.credit ? 'נכנס' : 'יצא'}`, amountILS: (l.credit ?? 0) + (l.debit ?? 0) })),
          `period = ${period}; kind = transfer-internal`),
      ],
    });
    const series = monthSeries(lines, acct.id, today, 12);
    const withData = series.flatMap((p) => (p.net === null ? [] : [{ label: p.period, amountILS: p.net }]));
    const net12 = withData.length ? round2(withData.reduce((t, i) => t + i.amountILS, 0)) : null;
    // Same window as net12m: the 12 periods ending today. Opening = the balance before its first line's movement.
    const windowLines = own.filter((l) => l.period >= periodMinus(today, 11));
    const first = firstLineOf(windowLines), last = lastLineOf(windowLines);
    const balanceChange = first && last ? round2(last.balance - preBalanceOf(first)) : null;
    const changeItems = first && last
      ? [{ label: `יתרה ב-${formatIsoDateHe(last.date)}`, amountILS: last.balance },
        { label: `פחות יתרה לפני ${formatIsoDateHe(first.date)}`, amountILS: round2(0 - preBalanceOf(first)) }]   // 0 − x: never −0
      : [];
    const trendAsOf = windowLines.length ? latest?.date ?? null : null;
    out.push({
      sectionId: `bank.${s}.trends`, layer: 'trends', titleHe: `${acct.name} — 12 חודשים`, state: empty ? 'empty' : 'ok', series,
      figures: [
        fig('net12m', 'נכנס פחות יצא ב-12 חודשים', net12, withData, '12 periods ending today; Σ(credit − debit) per period with lines; kind ≠ transfer-internal', trendAsOf),
        fig('balanceChange12m', 'שינוי ביתרה ב-12 חודשים', balanceChange, changeItems, '12 periods ending today; closing balance − pre-balance of the first line', trendAsOf),
      ],
    });
  }
  return out;
}
