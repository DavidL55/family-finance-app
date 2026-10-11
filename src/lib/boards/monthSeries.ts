import type { BankLine } from '../../types/bank';
import type { MonthPoint } from './types';

/** 'YYYY-MM' of `today` minus k months (k=0 → today's month). Pure, no Date timezone games. */
export function periodMinus(today: string, k: number): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const idx = y * 12 + (m - 1) - k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Month-end balance (last verified line of the month, by date then by insertion order) and the month's net. */
export function monthSeries(lines: BankLine[], accountId: string, today: string, months = 12): MonthPoint[] {
  const own = lines.filter((l) => l.accountId === accountId && l.verified && l.date <= today);
  return Array.from({ length: months }, (_, i) => periodMinus(today, months - 1 - i)).map((period) => {
    const inMonth = own.filter((l) => l.period === period);
    const last = inMonth.reduce<BankLine | null>((acc, l) => (acc === null || l.date >= acc.date ? l : acc), null);
    const net = inMonth.reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0);
    return { period, endBalance: last ? last.balance : null, net: Math.round(net * 100) / 100 };
  });
}
