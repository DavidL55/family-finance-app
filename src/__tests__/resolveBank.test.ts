import { describe, it, expect } from 'vitest';
import { resolveBankBoard } from '../lib/boards/resolveBank';
import { monthSeries } from '../lib/boards/monthSeries';
import type { BankLine } from '../types/bank';
import type { Account } from '../types/finance';

const acc = (id: string, ownerId: string, name: string): Account => ({
  id, ownerId, name, type: 'bank', balance: 0, balanceUpdatedAt: '2026-08-29', status: 'active',
  createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z',
});
const JOINT = acc('acc-poalim-joint', 'david-levy', 'משותף');
const DAVID = acc('acc-poalim-david', 'david-levy', 'דויד');

let n = 0;
const bl = (p: Partial<BankLine>): BankLine => ({
  id: `bl-${++n}`, ownerId: 'david-levy', accountId: 'acc-poalim-joint', accountNumber: '12-559-305397',
  date: '2026-10-01', action: 'x', debit: null, credit: null, balance: 0,
  kind: 'other', counterpartAccountId: null, source: 't', verified: true,
  createdAt: '', updatedAt: '', ...p,
  period: p.period ?? (p.date ?? '2026-10-01').slice(0, 7),   // pipeline invariant: period = date.slice(0,7)
});

const TODAY = '2026-10-10';

describe('resolveBankBoard — status', () => {
  it('today\'s balance is the latest verified line on or before today, with month in/out', () => {
    const lines = [
      bl({ date: '2026-09-28', balance: 42.04, debit: 10 }),
      bl({ date: '2026-10-05', balance: 7042.04, credit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
      bl({ date: '2026-10-05', balance: 6992.14, debit: 49.9, kind: 'card-charge' }),
    ];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    const f = Object.fromEntries(status.figures.map((x) => [x.id, x]));
    expect(f['bank.joint.balanceToday'].value).toBe(6992.14);
    expect(f['bank.joint.monthOut'].value).toBe(49.9);
    expect(f['bank.joint.monthIn'].value).toBe(0);            // internal transfers are neutral
    expect(f['bank.joint.balanceToday'].source.collection).toBe('bank_lines');
    expect(f['bank.joint.balanceToday'].source.asOf).toBe('2026-10-05');
  });

  it('balance today ignores future-dated rows', () => {
    const lines = [bl({ date: '2026-10-05', balance: 100 }), bl({ date: '2026-10-11', balance: 999 })];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    expect(status.figures.find((x) => x.id === 'bank.joint.balanceToday')!.value).toBe(100);
  });

  it('ignores unverified rows everywhere', () => {
    const lines = [bl({ date: '2026-10-05', balance: 100, debit: 5 }), bl({ date: '2026-10-06', balance: 50, debit: 50, verified: false })];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    expect(status.figures.find((x) => x.id === 'bank.joint.balanceToday')!.value).toBe(100);
    expect(status.figures.find((x) => x.id === 'bank.joint.monthOut')!.value).toBe(5);
  });

  it('internal transfers are neutral: not in, not out', () => {
    const lines = [
      bl({ date: '2026-10-05', balance: 7000, credit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
      bl({ accountId: 'acc-poalim-david', date: '2026-10-05', balance: 1000, debit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-joint' }),
    ];
    const secs = resolveBankBoard(lines, [JOINT, DAVID], TODAY);
    const j = secs.find((s) => s.sectionId === 'bank.joint.status')!.figures;
    const d = secs.find((s) => s.sectionId === 'bank.david.status')!.figures;
    expect(j.find((x) => x.id === 'bank.joint.monthIn')!.value).toBe(0);
    expect(d.find((x) => x.id === 'bank.david.monthOut')!.value).toBe(0);
  });

  it('negative balance reconciles: breakdown of the month\'s movements sums to the net', () => {
    const lines = [
      bl({ date: '2026-10-01', balance: -453.84, debit: 1738.16, kind: 'card-charge' }),
      bl({ date: '2026-10-02', balance: 6546.16, credit: 7000, kind: 'transfer-in' }),
    ];
    const bal = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.balances')!;
    const fig = bal.figures.find((x) => x.id === 'bank.joint.monthNet')!;
    expect(fig.value).toBeCloseTo(7000 - 1738.16, 2);
    expect(fig.items.reduce((s, i) => s + i.amountILS, 0)).toBeCloseTo(fig.value!, 2);
  });
});

describe('monthSeries', () => {
  it('month-end balance per period over 12 months, null when a month has no line, net per month', () => {
    const lines = [
      bl({ date: '2026-08-27', balance: 500, credit: 500, kind: 'transfer-in' }),
      bl({ date: '2026-10-05', balance: 7042.04, credit: 7000, kind: 'transfer-in' }),
      bl({ date: '2026-10-05', balance: 6992.14, debit: 49.9, kind: 'card-charge' }),
    ];
    const s = monthSeries(lines, 'acc-poalim-joint', TODAY, 12);
    expect(s).toHaveLength(12);
    expect(s[11]).toEqual({ period: '2026-10', endBalance: 6992.14, net: 6950.1 });
    expect(s[10]).toEqual({ period: '2026-09', endBalance: null, net: 0 });
    expect(s[9].period).toBe('2026-08');
    expect(s[9].endBalance).toBe(500);
  });
});

describe('resolveBankBoard — empty and ordering', () => {
  it('an account with no lines yields empty sections, the others resolve; joint comes first', () => {
    const lines = [bl({ accountId: 'acc-poalim-david', date: '2026-10-01', balance: 10 })];
    const secs = resolveBankBoard(lines, [DAVID, JOINT], TODAY);
    expect(secs[0].sectionId).toBe('bank.joint.status');
    expect(secs.find((s) => s.sectionId === 'bank.joint.status')!.state).toBe('empty');
    expect(secs.find((s) => s.sectionId === 'bank.david.status')!.state).toBe('ok');
  });
});

describe('fix 1 — same-day ordering and series net excluding internal transfers', () => {
  const sameDay = () => [
    bl({ date: '2026-09-28', balance: 42.04, debit: 10 }),
    bl({ date: '2026-10-05', balance: 7042.04, credit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
    bl({ date: '2026-10-05', balance: 6992.14, debit: 49.9, kind: 'card-charge' }),
  ];

  it('today\'s balance is the same-day chain end even when the array order is reversed', () => {
    const reversed = [...sameDay()].reverse();
    const status = resolveBankBoard(reversed, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    expect(status.figures.find((x) => x.id === 'bank.joint.balanceToday')!.value).toBe(6992.14);
  });

  it('month-end balance is the same-day chain end even when the array order is reversed', () => {
    const reversed = [...sameDay()].reverse();
    const s = monthSeries(reversed, 'acc-poalim-joint', TODAY, 12);
    expect(s[11].endBalance).toBe(6992.14);
  });

  it('a negative latest balance is reported as negative', () => {
    const lines = [bl({ date: '2026-10-01', balance: -453.84, debit: 1738.16, kind: 'card-charge' })];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    const v = status.figures.find((x) => x.id === 'bank.joint.balanceToday')!.value!;
    expect(v).toBe(-453.84);
    expect(v).toBeLessThan(0);
  });

  it('series net excludes internal transfers and equals the board monthNet for the same lines', () => {
    const lines = [
      bl({ date: '2026-10-05', balance: 7000, credit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
      bl({ date: '2026-10-06', balance: 6950.1, debit: 49.9, kind: 'card-charge' }),
    ];
    const series = monthSeries(lines, 'acc-poalim-joint', TODAY, 12);
    expect(series[11].net).toBe(-49.9);
    const bal = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.balances')!;
    const monthNet = bal.figures.find((x) => x.id === 'bank.joint.monthNet')!.value;
    expect(series[11].net).toBe(monthNet);
  });
});

describe('Task 8 verification — honest net labels and the real 12-month balance change', () => {
  const trends = (lines: BankLine[]) => resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.trends')!;

  it('an account funded by internal transfers: balanceChange12m is last − first endBalance while net12m is negative', () => {
    const lines = [
      bl({ date: '2026-01-05', balance: 12000, credit: 12000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
      bl({ date: '2026-01-20', balance: 11000, debit: 1000, kind: 'card-charge' }),
      bl({ date: '2026-10-03', balance: 500, debit: 10500, kind: 'card-charge' }),
    ];
    const t = trends(lines);
    const f = Object.fromEntries(t.figures.map((x) => [x.id, x]));
    expect(f['bank.joint.net12m'].value).toBe(-11500);
    expect(f['bank.joint.balanceChange12m'].value).toBe(-10500);   // 500 − 11,000
    expect(f['bank.joint.balanceChange12m'].explainId).toBe('bank.balanceChange12m');
    expect(f['bank.joint.balanceChange12m'].labelHe).toBe('שינוי ביתרה ב-12 חודשים');
    expect(f['bank.joint.balanceChange12m'].items).toEqual([]);
    expect(t.figures.map((x) => x.id)).toEqual(['bank.joint.net12m', 'bank.joint.balanceChange12m']);
  });

  it('balanceChange12m is the difference of the last and first non-null month-end balances (gaps skipped)', () => {
    const lines = [
      bl({ date: '2026-02-10', balance: 200, credit: 200, kind: 'income' }),
      bl({ date: '2026-07-10', balance: 1200, credit: 1000, kind: 'income' }),
    ];
    expect(trends(lines).figures.find((x) => x.id === 'bank.joint.balanceChange12m')!.value).toBe(1000);
  });

  it('fewer than two months with movements: balanceChange12m is null, not zero', () => {
    const one = trends([bl({ date: '2026-10-03', balance: 500, debit: 10, kind: 'card-charge' })]);
    expect(one.figures.find((x) => x.id === 'bank.joint.balanceChange12m')!.value).toBeNull();
  });

  it('the net labels say what they compute', () => {
    const lines = [bl({ date: '2026-10-03', balance: 500, debit: 10, kind: 'card-charge' })];
    const secs = resolveBankBoard(lines, [JOINT], TODAY);
    const label = (sid: string, id: string) => secs.find((s) => s.sectionId === sid)!.figures.find((x) => x.id === id)!.labelHe;
    expect(label('bank.joint.balances', 'bank.joint.monthNet')).toBe('נכנס פחות יצא החודש');
    expect(label('bank.joint.trends', 'bank.joint.net12m')).toBe('נכנס פחות יצא ב-12 חודשים');
  });
});
