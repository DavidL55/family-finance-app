import { describe, expect, it } from 'vitest';
import { GLOSSARY, getGlossaryEntry } from '../config/glossary';
import { violatesPlainLanguage } from '../utils/plainLanguage';

const REQUIRED_IDS = [
  'dashboard.totalIncome', 'dashboard.totalExpenses', 'dashboard.monthlyBalance', 'dashboard.plannedBudget',
  'dashboard.netWorth',
  'netWorth.assets.accounts', 'netWorth.assets.investments', 'netWorth.assets.realEstate', 'netWorth.liabilities.loans',
  'expenses.listTotal',
  'accounts.totalBalance', 'accounts.rowBalance',
  'loans.totalBalance', 'loans.rowInterestRate', 'loans.rowMonthlyPayment', 'loans.payoffProgress',
  'insurances.totalPremium', 'insurances.rowPremium', 'insurances.rowCoverageAmount',
  'recurring.totalMonthly', 'recurring.rowAmount',
];

// Every entry actually in GLOSSARY, not just the hardcoded REQUIRED_IDS list — so a new entry
// added to GLOSSARY without also touching REQUIRED_IDS still gets the completeness and
// plain-language checks below (fix for the silent-skip gap REQUIRED_IDS alone left open).
const ALL_IDS = Object.keys(GLOSSARY);

describe('GLOSSARY', () => {
  it.each(REQUIRED_IDS)('the required id %s exists in GLOSSARY', (id) => {
    expect(getGlossaryEntry(id)).not.toBeNull();
  });
  it.each(ALL_IDS)('has a complete entry for %s (title/explanation/howComputed/source all non-empty)', (id) => {
    const entry = getGlossaryEntry(id);
    expect(entry).not.toBeNull();
    expect(entry!.title.length).toBeGreaterThan(0);
    expect(entry!.explanation.length).toBeGreaterThan(0);
    expect(entry!.howComputed.length).toBeGreaterThan(0);
    expect(entry!.source.length).toBeGreaterThan(0);
  });
  it('getGlossaryEntry returns null for an unknown id (never throws)', () => {
    expect(getGlossaryEntry('nonexistent.id')).toBeNull();
  });
  it('the real-estate entry discloses it has no per-item freshness date the way accounts/loans do', () => {
    expect(GLOSSARY['netWorth.assets.realEstate'].asOf).toMatch(/אין תאריך עדכון פרטני/);
  });
  it('the expenses.listTotal entry documents the refund/cancellation carve-out (Stage 1 ledger carry-forward)', () => {
    expect(GLOSSARY['expenses.listTotal'].explanation).toMatch(/החזר|ביטול/);
  });
  it('insurances.totalPremium discloses that a yearly premium is divided by 12 before summing', () => {
    expect(GLOSSARY['insurances.totalPremium'].explanation).toMatch(/12/);
  });
  it('recurring.totalMonthly discloses that a paused/ended item is excluded from the sum', () => {
    expect(GLOSSARY['recurring.totalMonthly'].howComputed).toMatch(/מושהית|הסתיימה/);
  });
  // Ofra ruling I5 — spec §5.2's actual requirement is plain Hebrew a child understands;
  // "the string is non-empty" (above) doesn't test that. Every entry's explanation/howComputed
  // must pass the same testable plain-language standard used across the app.
  it.each(ALL_IDS)('%s has no plain-language violations (Ofra I5 — banned jargon / sentence length)', (id) => {
    const entry = getGlossaryEntry(id)!;
    expect(violatesPlainLanguage(entry.explanation)).toEqual([]);
    expect(violatesPlainLanguage(entry.howComputed)).toEqual([]);
  });
});
