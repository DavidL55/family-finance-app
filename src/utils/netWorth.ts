// Client-side derived net-worth rollup (spec §6 "שווי נקי", §10 forecast layer-1 inputs). NOT a
// Firestore collection, NOT its own permission module — Design decision D4: net worth is exactly
// whatever family-vs-own access the viewer already has on the collections that feed it
// (accounts, investments, loans). The home (real estate) is deliberately NOT part of net worth —
// David, 11.10.2026: the figure in settings/ecosystem stays stored, but never becomes a line or a
// total. This module does ONE thing: given data the caller has ALREADY fetched (and
// which Firestore Rules have therefore already filtered to what the viewer may see), compute
// totals + a per-category breakdown carrying `source` and `asOf` on every line — the provenance
// metadata the Stage 4 hover-explain glossary needs ("מה זה, איך חושב, נכון לאיזה תאריך"). Stage 3
// produces this DATA; the rendered rollup screen is Stage 5.
//
// ecosystem.mortgage is expected to migrate into `loans` (loanType: 'mortgage') over time but that migration is NOT done in Stage 3 — a
// caller populating BOTH would double-count a mortgage; see the Stage 3 plan's Risks section.
//
// No Firebase imports here (pure function, no I/O), and no permission logic inside this module —
// per D4, `own` vs `family` scoping is applied here ONLY as a filter over the arrays the caller
// already passed in (mirroring whatever Rules-enforced query the caller ran); it never decides
// what the caller was ALLOWED to fetch. One scoping asymmetry is deliberate, not an oversight:
//   - `investments` docs carry no owner field (Stage 2 D5, ownerless module) — 'own' scope
//     excludes investments entirely rather than guessing at attribution.
// Archived accounts (`status: 'archived'`) are NOT filtered out here — this function reflects
// exactly what the caller passed (D4); if a screen wants to exclude archived accounts from a
// rollup, that is a filter the caller applies before calling computeNetWorth, same as any other
// caller-side data selection (analogous to how Rules-enforced scope is already resolved before
// the caller ever reaches this function).

import type { Account, Loan } from '../types/finance';

export type NetWorthScope = 'own' | 'family';

export interface NetWorthLineItem {
  label: string;
  amount: number;
  source: 'accounts' | 'investments' | 'loans';
  asOf: string;
}

export interface NetWorthResult {
  scope: NetWorthScope;
  assets: NetWorthLineItem[];
  liabilities: NetWorthLineItem[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  computedAt: string;
}

export interface NetWorthInput {
  viewerMemberId: string;
  scope: NetWorthScope;
  accounts: Account[];
  investments: Array<{ value: number }>;
  loans: Loan[];
  /** Accepted for the legacy settings/ecosystem read, deliberately IGNORED — the home is not part of net worth. */
  realEstateValue: number;
  realEstateAsOf: string;
}

const latestOf = (dates: string[], fallback: string): string =>
  dates.length === 0 ? fallback : dates.reduce((a, b) => (a > b ? a : b));

export function computeNetWorth(input: NetWorthInput): NetWorthResult {
  const computedAt = new Date().toISOString();

  const scopedAccounts = input.scope === 'own'
    ? input.accounts.filter((a) => a.ownerId === input.viewerMemberId)
    : input.accounts;
  const scopedLoans = input.scope === 'own'
    ? input.loans.filter((l) => l.ownerId === input.viewerMemberId)
    : input.loans;
  // Investments remain ownerless (Stage 2 D5) — there is no per-item owner to filter by, so an
  // 'own' scope excludes investments entirely rather than guessing. Documented, not silent.
  const scopedInvestments = input.scope === 'own' ? [] : input.investments;

  const assets: NetWorthLineItem[] = [
    {
      label: 'חשבונות ומזומן',
      amount: scopedAccounts.reduce((sum, a) => sum + a.balance, 0),
      source: 'accounts',
      asOf: latestOf(scopedAccounts.map((a) => a.balanceUpdatedAt), computedAt),
    },
  ];
  if (scopedInvestments.length > 0) {
    assets.push({
      label: 'השקעות ופנסיה',
      amount: scopedInvestments.reduce((sum, i) => sum + i.value, 0),
      source: 'investments',
      asOf: computedAt, // the existing investments collection carries no per-doc updatedAt today
    });
  }
  // The home is NOT an asset line (David, 11.10.2026): `realEstateValue` is accepted but never
  // turned into a line item — see the header comment.

  const liabilities: NetWorthLineItem[] = [
    {
      label: 'הלוואות וחובות',
      amount: scopedLoans.reduce((sum, l) => sum + l.balance, 0),
      source: 'loans',
      asOf: latestOf(scopedLoans.map((l) => l.updatedAt), computedAt),
    },
  ];

  const totalAssets = assets.reduce((sum, a) => sum + a.amount, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);

  return {
    scope: input.scope,
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    computedAt,
  };
}
