// Stage 3, Task 6 — net-worth rollup (pure, derived). See D4/D5 in
// docs/superpowers/plans/2026-08-15-stage3-data-model.md: computeNetWorth is NOT a Firestore
// collection or permission module — it is a pure function over data the caller already fetched
// (and which Rules already scoped to what the viewer may see), plus a caller-resolved real-estate
// figure from settings/ecosystem. No Firebase imports here; no permission logic inside the
// function — see D4's "reflects exactly what the caller passed" principle, exercised below.

import { describe, expect, it } from 'vitest';
import { computeNetWorth } from '../utils/netWorth';
import type { Account, Loan } from '../types/finance';

const account = (over: Partial<Account>): Account => ({
  id: 'a1', ownerId: 'david-levy', name: 'עו"ש', type: 'bank', balance: 10000,
  balanceUpdatedAt: '2026-08-01T00:00:00.000Z', status: 'active',
  createdAt: 'x', updatedAt: 'x', ...over,
});

const loan = (over: Partial<Loan>): Loan => ({
  id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000,
  balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: '2020-01-01',
  endDate: '2045-01-01', status: 'active', createdAt: 'x', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
});

describe('computeNetWorth', () => {
  it('family scope sums every account/loan regardless of owner', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balance: 10000 }), account({ id: 'a2', ownerId: 'lilit-levy', balance: 5000 })],
      investments: [{ value: 20000 }],
      loans: [loan({ balance: 800000 })],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.totalAssets).toBe(10000 + 5000 + 20000);
    expect(result.totalLiabilities).toBe(800000);
    expect(result.netWorth).toBe(10000 + 5000 + 20000 - 800000);
  });

  it('own scope excludes accounts/loans owned by other members, and excludes investments entirely (no owner field to filter by)', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'own',
      accounts: [account({ balance: 10000 }), account({ id: 'a2', ownerId: 'lilit-levy', balance: 5000 })],
      investments: [{ value: 20000 }],
      loans: [loan({ balance: 800000 }), loan({ id: 'l2', ownerId: 'lilit-levy', balance: 100000 })],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.totalAssets).toBe(10000);
    expect(result.totalLiabilities).toBe(800000);
    expect(result.assets.find((a) => a.source === 'investments')).toBeUndefined();
  });

  it('includes a real-estate line only when a non-zero value is supplied', () => {
    const withRealEstate = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 2000000, realEstateAsOf: '2026-01-01T00:00:00.000Z',
    });
    expect(withRealEstate.assets.find((a) => a.source === 'realEstate')).toMatchObject({ amount: 2000000 });

    const without = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(without.assets.find((a) => a.source === 'realEstate')).toBeUndefined();
  });

  it('every line item carries source + the LATEST contributing asOf, for the Stage 4 explain layer', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balanceUpdatedAt: '2026-08-01T00:00:00.000Z' }), account({ id: 'a2', balanceUpdatedAt: '2026-08-10T00:00:00.000Z' })],
      investments: [], loans: [], realEstateValue: 0, realEstateAsOf: 'x',
    });
    const accountsLine = result.assets.find((a) => a.source === 'accounts')!;
    expect(accountsLine.asOf).toBe('2026-08-10T00:00:00.000Z');
  });

  it('an empty family with nothing at all yields a zero net worth, not a crash', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.netWorth).toBe(0);
    expect(result.totalAssets).toBe(0);
    expect(result.totalLiabilities).toBe(0);
  });

  it('accounts and loans lines are always present (even at zero) for family scope — only investments/realEstate are conditional', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.assets.find((a) => a.source === 'accounts')).toBeDefined();
    expect(result.liabilities.find((l) => l.source === 'loans')).toBeDefined();
  });

  // --- Additional edge cases beyond the plan's brief ---

  it('loans line carries the LATEST contributing updatedAt, mirroring the accounts line', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [],
      investments: [],
      loans: [loan({ updatedAt: '2026-08-01T00:00:00.000Z' }), loan({ id: 'l2', updatedAt: '2026-08-15T00:00:00.000Z' })],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    const loansLine = result.liabilities.find((l) => l.source === 'loans')!;
    expect(loansLine.asOf).toBe('2026-08-15T00:00:00.000Z');
  });

  it('liabilities exceeding assets produce a negative net worth (no clamping to zero)', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balance: 1000 })], investments: [],
      loans: [loan({ balance: 500000 })],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.netWorth).toBe(1000 - 500000);
    expect(result.netWorth).toBeLessThan(0);
  });

  it('archived accounts are still summed — D4 says the function reflects exactly what the caller passed, with no status filtering inside it', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balance: 10000, status: 'active' }), account({ id: 'a2', balance: 3000, status: 'archived' })],
      investments: [], loans: [], realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.totalAssets).toBe(13000);
  });

  it('an investments array with a zero-value item still produces an investments line (presence, not sum, gates the line)', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [],
      investments: [{ value: 0 }], loans: [], realEstateValue: 0, realEstateAsOf: 'x',
    });
    const investmentsLine = result.assets.find((a) => a.source === 'investments');
    expect(investmentsLine).toMatchObject({ amount: 0 });
  });

  it('real estate is included even under own scope — it is a single household figure with no per-owner attribution, unlike investments', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'own', accounts: [], investments: [], loans: [],
      realEstateValue: 2000000, realEstateAsOf: '2026-01-01T00:00:00.000Z',
    });
    expect(result.assets.find((a) => a.source === 'realEstate')).toMatchObject({ amount: 2000000 });
  });

  it('negative account balances (e.g. overdraft) reduce totalAssets rather than being excluded or clamped', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balance: -500 })], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.totalAssets).toBe(-500);
  });

  it('scope and computedAt are echoed onto the result for the Stage 4 explain layer', () => {
    const before = new Date().toISOString();
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'own', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    const after = new Date().toISOString();
    expect(result.scope).toBe('own');
    expect(result.computedAt >= before && result.computedAt <= after).toBe(true);
  });
});
