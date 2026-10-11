import type { BankLine, BankLineKind } from '../../types/bank';
import type { Account } from '../../types/finance';
import type { ResolvedFigure, ResolvedSection, FigureSource } from './types';
import { monthSeries, lastLineOf } from './monthSeries';

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
    const fig = (id: string, labelHe: string, value: number | null, items: ResolvedFigure['items'], filter: string, asOf: string | null): ResolvedFigure =>
      ({ id: `bank.${s}.${id}`, explainId: `bank.${id}`, labelHe, value, items, source: src(acct.id, filter, asOf), state: empty ? 'empty' : 'ok' });

    out.push({
      sectionId: `bank.${s}.status`, layer: 'status', titleHe: `${acct.name} — היום`, state: empty ? 'empty' : 'ok',
      figures: [
        fig('balanceToday', 'יתרה היום', latest ? latest.balance : null, [], 'latest verified line ≤ today', latest?.date ?? null),
        fig('monthOut', 'יצא החודש', monthOut, byKind(external, 'debit'), `period = ${period}; debit; kind ≠ transfer-internal`, latest?.date ?? null),
        fig('monthIn', 'נכנס החודש', monthIn, byKind(external, 'credit'), `period = ${period}; credit; kind ≠ transfer-internal`, latest?.date ?? null),
      ],
    });
    const net = round2(monthIn - monthOut);
    out.push({
      sectionId: `bank.${s}.balances`, layer: 'balances', titleHe: `${acct.name} — תנועות החודש`, state: empty ? 'empty' : 'ok',
      figures: [
        fig('monthNet', 'שינוי נטו החודש', net,
          [...byKind(external, 'credit'), ...byKind(external, 'debit').map((i) => ({ ...i, amountILS: -i.amountILS }))],
          `period = ${period}; credit − debit; kind ≠ transfer-internal`, latest?.date ?? null),
        fig('internalMoved', 'הועבר בין החשבונות שלנו', round2(month.filter((l) => l.kind === 'transfer-internal').reduce((t, l) => t + (l.credit ?? 0) + (l.debit ?? 0), 0)),
          month.filter((l) => l.kind === 'transfer-internal').map((l) => ({ label: `${l.date} ${l.credit ? 'נכנס' : 'יצא'}`, amountILS: (l.credit ?? 0) + (l.debit ?? 0) })),
          `period = ${period}; kind = transfer-internal`, latest?.date ?? null),
      ],
    });
    const series = monthSeries(lines, acct.id, today, 12);
    const net12 = round2(series.reduce((t, p) => t + p.net, 0));
    out.push({
      sectionId: `bank.${s}.trends`, layer: 'trends', titleHe: `${acct.name} — 12 חודשים`, state: empty ? 'empty' : 'ok', series,
      figures: [fig('net12m', 'שינוי נטו ב-12 חודשים', net12, series.map((p) => ({ label: p.period, amountILS: p.net })), '12 periods ending today; Σ(credit − debit) per period; kind ≠ transfer-internal', latest?.date ?? null)],
    });
  }
  return out;
}
