import type { OwnedRecord } from './finance';

/** Spec §4.1 — classification assigned by the sync pipeline, never by the client. */
export const BANK_LINE_KINDS = [
  'card-charge', 'standing-order', 'transfer-internal', 'transfer-in',
  'cash', 'fee', 'income', 'other',
] as const;
export type BankLineKind = (typeof BANK_LINE_KINDS)[number];

/**
 * One bank-account transaction (Hapoalim ledger row). ownerId = the account's owner
 * ('david-levy' for the joint account; parents read everything through the Rules bypass).
 * Written only by family-data/tools/statements/ingest_bank.py.
 */
export interface BankLine extends OwnedRecord {
  accountId: string;            // 'acc-poalim-joint' | 'acc-poalim-david' | 'acc-poalim-lilit'
  accountNumber: string;        // '12-559-305397'
  date: string;                 // ISO yyyy-mm-dd
  period: string;               // 'YYYY-MM'
  action: string;               // the bank's own text
  debit: number | null;
  credit: number | null;
  balance: number;              // running balance AFTER this line
  kind: BankLineKind;
  counterpartAccountId: string | null;
  source: string;               // file the row came from
  verified: boolean;            // direction proven by the balance chain / explicit columns
}
