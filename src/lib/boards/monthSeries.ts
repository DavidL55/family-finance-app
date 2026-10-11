import type { BankLine } from '../../types/bank';
import type { MonthPoint } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 'YYYY-MM' of `today` minus k months (k=0 → today's month). Pure, no Date timezone games. */
export function periodMinus(today: string, k: number): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const idx = y * 12 + (m - 1) - k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/**
 * The last line of the latest day in `lines` (the day's closing balance). Several rows can share a date and
 * the input order is not reliable, so on a multi-row day the closing row is the one whose post-balance is not
 * the pre-balance of any other same-day row (pre = balance + debit − credit). If that is not exactly one row
 * (inconsistent data), fall back to the last in array order.
 */
export function lastLineOf(lines: BankLine[]): BankLine | null {
  if (lines.length === 0) return null;
  const maxDate = lines.reduce((m, l) => (l.date > m ? l.date : m), lines[0].date);
  const day = lines.filter((l) => l.date === maxDate);
  if (day.length === 1) return day[0];
  const preOf = (l: BankLine) => round2(l.balance + (l.debit ?? 0) - (l.credit ?? 0));
  const isPreOfAnother = (l: BankLine) => day.some((o) => o !== l && preOf(o) === round2(l.balance));
  const ends = day.filter((l) => !isPreOfAnother(l));
  return ends.length === 1 ? ends[0] : day[day.length - 1];
}

/**
 * Month-end balance (closing line of the month, see lastLineOf) and the month's net.
 * net excludes internal transfers, so it matches the board's monthNet; endBalance is the real balance.
 */
export function monthSeries(lines: BankLine[], accountId: string, today: string, months = 12): MonthPoint[] {
  const own = lines.filter((l) => l.accountId === accountId && l.verified && l.date <= today);
  return Array.from({ length: months }, (_, i) => periodMinus(today, months - 1 - i)).map((period) => {
    const inMonth = own.filter((l) => l.period === period);
    const last = lastLineOf(inMonth);
    const net = inMonth
      .filter((l) => l.kind !== 'transfer-internal')
      .reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0);
    return { period, endBalance: last ? last.balance : null, net: round2(net) };
  });
}
