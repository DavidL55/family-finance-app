// Client-side derived net-worth rollup (spec §6 "שווי נקי", §10 forecast layer-1 inputs). NOT a
// Firestore collection, NOT its own permission module — Design decision D4: net worth is exactly
// whatever family-vs-own access the viewer already has on the collections that feed it
// (accounts, investments, loans), plus the pre-existing manually-maintained real-estate figure in
// settings/ecosystem. This module does ONE thing: given data the caller has ALREADY fetched (and
// which Firestore Rules have therefore already filtered to what the viewer may see), compute
// totals + a per-category breakdown carrying `source` and `asOf` on every line — the provenance
// metadata the Stage 4 hover-explain glossary needs ("מה זה, איך חושב, נכון לאיזה תאריך"). Stage 3
// produces this DATA; the rendered rollup screen is Stage 5.
//
// D5: real estate has no dedicated collection yet — passed in as a resolved number (caller reads
// it from settings/ecosystem, unchanged legacy shape). ecosystem.mortgage is expected to migrate
// into `loans` (loanType: 'mortgage') over time but that migration is NOT done in Stage 3 — a
// caller populating BOTH would double-count a mortgage; see the Stage 3 plan's Risks section.
//
// No Firebase imports here (pure function, no I/O), and no permission logic inside this module —
// per D4, `own` vs `family` scoping is applied here ONLY as a filter over the arrays the caller
// already passed in (mirroring whatever Rules-enforced query the caller ran); it never decides
// what the caller was ALLOWED to fetch. Two scoping asymmetries are deliberate, not oversights:
//   - `investments` docs carry no owner field (Stage 2 D5, ownerless module) — 'own' scope
//     excludes investments entirely rather than guessing at attribution.
//   - `realEstateValue` is a single household figure with no owner field either, but unlike
//     investments it is always included regardless of scope — there is no "family investments
//     pool" analogue to hide; the figure already represents the whole household by definition, so
//     hiding it under 'own' would just make an existing household asset invisible, not more
//     correctly attributed. Stage 4/5's hover-explain copy should call this out explicitly so
//     "own" net worth is never mistaken for "money legally mine."
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
  source: 'accounts' | 'investments' | 'loans' | 'realEstate';
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
  // Real estate is always included regardless of scope — see the header comment on the
  // own-vs-family asymmetry with investments.
  if (input.realEstateValue !== 0) {
    assets.push({ label: 'נדל״ן', amount: input.realEstateValue, source: 'realEstate', asOf: input.realEstateAsOf });
  }

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
