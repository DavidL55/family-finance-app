import { describe, expect, it } from 'vitest';
import {
  parseTransactionDate,
  matchesMonthYear,
  isIncomeCategory,
  isExpenseRow,
  isExpenseListRow,
} from '../utils/transactionFilters';

describe('parseTransactionDate', () => {
  it('parses ISO (YYYY-MM-DD) dates', () => {
    expect(parseTransactionDate('2026-03-25')).toEqual({ year: '2026', month: '03' });
  });

  it('parses DD/MM/YYYY dates', () => {
    expect(parseTransactionDate('05/03/2026')).toEqual({ year: '2026', month: '03' });
  });

  it('parses a DD/MM/YYYY date where the day is > 12 without confusing day and month', () => {
    // If the parser mixed up day/month fields (e.g. treating this as MM/DD/YYYY) it would
    // silently produce month "25", which isn't a valid month at all — this is exactly the
    // silent-corruption case the shared module exists to prevent.
    expect(parseTransactionDate('25/03/2026')).toEqual({ year: '2026', month: '03' });
  });

  it('zero-pads an unpadded legacy month (DD/M/YYYY)', () => {
    expect(parseTransactionDate('9/3/2026')).toEqual({ year: '2026', month: '03' });
  });

  it('returns null for an unparseable date rather than defaulting to "now" or dropping silently', () => {
    expect(parseTransactionDate('not-a-date')).toBeNull();
    expect(parseTransactionDate('')).toBeNull();
    expect(parseTransactionDate(undefined)).toBeNull();
    expect(parseTransactionDate(null)).toBeNull();
  });

  it('returns null for an out-of-range month', () => {
    expect(parseTransactionDate('05/13/2026')).toBeNull();
    expect(parseTransactionDate('2026-13-05')).toBeNull();
  });
});

describe('matchesMonthYear', () => {
  it('matches an ISO date against the selected month/year', () => {
    expect(matchesMonthYear('2026-03-25', '03', '2026')).toBe(true);
  });

  it('matches a DD/MM/YYYY date against the selected month/year', () => {
    expect(matchesMonthYear('25/03/2026', '03', '2026')).toBe(true);
  });

  it('does not match a different month/year', () => {
    expect(matchesMonthYear('25/03/2026', '04', '2026')).toBe(false);
    expect(matchesMonthYear('25/03/2026', '03', '2025')).toBe(false);
  });

  it('does not match (and does not throw) on an unparseable date', () => {
    expect(matchesMonthYear('garbage', '03', '2026')).toBe(false);
  });
});

describe('isIncomeCategory', () => {
  it('flags the Hebrew income/investment category', () => {
    expect(isIncomeCategory('הכנסות והשקעות')).toBe(true);
  });

  it('flags the pre-mapping legacy income category key', () => {
    expect(isIncomeCategory('Income_Investments')).toBe(true);
  });

  it('does not flag a normal expense category', () => {
    expect(isIncomeCategory('מזון')).toBe(false);
  });

  it('does not flag a missing category', () => {
    expect(isIncomeCategory(undefined)).toBe(false);
  });
});

describe('isExpenseRow (Dashboard / AnnualReport / CentralExpenseReport aggregate rule)', () => {
  it('includes a normal expense row', () => {
    expect(isExpenseRow({ category: 'מזון', isCredit: false })).toBe(true);
  });

  it('excludes an income-category row', () => {
    expect(isExpenseRow({ category: 'הכנסות והשקעות', isCredit: false })).toBe(false);
  });

  it('excludes ANY isCredit row, including a refund', () => {
    // Task 5, controller-confirmed: a refund is not an expense. This applies unconditionally
    // in the aggregate/report components — unlike ExpensesBreakdown's list view below.
    expect(isExpenseRow({ category: 'מזון', isCredit: true, paymentType: 'refund' })).toBe(false);
    expect(isExpenseRow({ category: 'מזון', isCredit: true })).toBe(false);
  });
});

describe('isExpenseListRow (ExpensesBreakdown list-view rule — pre-existing, not converged)', () => {
  it('includes a normal expense row', () => {
    expect(isExpenseListRow({ category: 'מזון', isCredit: false })).toBe(true);
  });

  it('excludes an income-category row', () => {
    expect(isExpenseListRow({ category: 'הכנסות והשקעות', isCredit: false })).toBe(false);
  });

  it('excludes a non-refund credit row', () => {
    expect(isExpenseListRow({ category: 'מזון', isCredit: true })).toBe(false);
  });

  it('keeps a refund or cancellation credit row visible (pre-existing ExpensesBreakdown behavior)', () => {
    expect(isExpenseListRow({ category: 'מזון', isCredit: true, paymentType: 'refund' })).toBe(true);
    expect(isExpenseListRow({ category: 'מזון', isCredit: true, paymentType: 'cancellation' })).toBe(true);
  });
});
