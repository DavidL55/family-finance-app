// Stage 3 — full data model. Doc shapes for the four collections newly wired to the
// permission matrix (see src/types/permissions.ts MODULE_IDS). All four are OWNED from
// day one (D2) via `ownerId: Member.id` (D1) — not a display name, unlike Stage 2's
// `transaction_lines.owner` (see docs/superpowers/plans/2026-08-15-stage3-data-model.md D1).

export interface OwnedRecord {
  id: string;
  ownerId: string;   // Member.id — D1
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export type AccountType = 'bank' | 'cash' | 'credit';

export interface Account extends OwnedRecord {
  name: string;
  type: AccountType;
  balance: number;
  balanceUpdatedAt: string;
  status: 'active' | 'archived';
}

export type RecurringKind = 'income' | 'expense';
export type RecurringStatus = 'active' | 'paused' | 'ended';

export interface RecurringItem extends OwnedRecord {
  kind: RecurringKind;
  description: string;
  amount: number;
  category?: string;
  chargeDay: number; // 1-31
  status: RecurringStatus;
  startDate: string;  // ISO date 'YYYY-MM-DD'
  endDate?: string;   // ISO date
  lastPostedPeriod?: string; // 'YYYY-MM'
}

export type LoanType = 'mortgage' | 'personal' | 'creditLine' | 'other';
export type LoanStatus = 'active' | 'paid-off';

export interface Loan extends OwnedRecord {
  name: string;
  loanType: LoanType;
  principal: number;
  balance: number;
  interestRate: number; // annual %
  monthlyPayment: number;
  startDate: string; // ISO date
  endDate: string;   // ISO date — expected payoff
  status: LoanStatus;
}

export type InsuranceType = 'life' | 'health' | 'car' | 'home' | 'other';
export type InsuranceStatus = 'active' | 'lapsed' | 'cancelled';
export type PremiumFrequency = 'monthly' | 'yearly';

export interface Coverage {
  label: string;   // Hebrew description of what's covered
  amount?: number; // ₪ coverage cap, optional
}

export interface Insurance extends OwnedRecord {
  type: InsuranceType;
  provider: string;
  insuredMemberId: string; // who the policy covers — may differ from ownerId (parent owns, child insured)
  premium: number;
  premiumFrequency: PremiumFrequency;
  coverages: Coverage[];
  renewalDate: string; // ISO date
  documentId?: string; // links to `documents` collection
  status: InsuranceStatus;
}
