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
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 8 review — the two AI-spend entries were written in the SAME commit and contradicted
  // each other about the same number. providerSpend says "משוערת ... ומתקנים" (an estimate, later
  // corrected); modelSpend claimed "מחברים את העלות בפועל" (the ACTUAL cost). byModel sums
  // ai_usage.amountILS, which IS the estimate until reconcileSpend rewrites it — exactly what
  // providerSpend describes. modelSpend overstated.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it('aiSettings.modelSpend describes an estimate later corrected — not a cost already known to be actual', () => {
    const howComputed = GLOSSARY['aiSettings.modelSpend'].howComputed;
    expect(howComputed).not.toMatch(/מחברים את העלות בפועל/);
    expect(howComputed).toMatch(/משוער/);
    expect(howComputed).toMatch(/בפועל/); // it IS corrected to the real cost — just not from the start
  });

  // Task 8 review F5 — every ₪ figure on the AI settings screen is derived from registry.ts's
  // per-token prices, which that file's own 20-line banner records as UNVERIFIED placeholders.
  // The FX half of the conversion was disclosed; this half was not, on screen or here.
  it.each(['aiSettings.providerSpend', 'aiSettings.modelSpend'])(
    '%s discloses that the underlying model prices are not verified against the vendors (F5)',
    (id) => {
      const entry = GLOSSARY[id];
      expect(`${entry.explanation} ${entry.howComputed}`).toMatch(/לא אומת|אינם מאומתים/);
    }
  );

  // Task 8 review F2 fix (commit 9ca9eea) made the cost gate GLOBAL. Pinning that this entry
  // still describes the gate as it actually is — one family-wide cap, not a per-provider one.
  it('aiSettings.ceiling describes ONE family-wide cap, matching the global gate the code enforces', () => {
    const explanation = GLOSSARY['aiSettings.ceiling'].explanation;
    expect(explanation).toMatch(/סכום אחד לכל ספקי ה-AI יחד/);
    expect(explanation).toMatch(/ולא תקרה נפרדת לכל ספק/);
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
