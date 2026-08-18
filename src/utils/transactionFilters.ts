// Pure, shared logic for reading `transaction_lines` rows in the financial report components
// (Fix batch, Stage 1 — closes a review finding from Task 5/6a: this logic was duplicated,
// inline, across Dashboard, ExpensesBreakdown, AnnualReport and CentralExpenseReport with zero
// test coverage — the highest silent-corruption risk in the codebase, because a mistake here
// changes the family's numbers without throwing).
//
// Kept dependency-free (no firebase import), matching the split already established by
// `categoryMap.ts` and `seedFromBudgetConfig.ts`: pure logic in src/utils/, Firestore I/O stays
// in the components/services that call it.

export interface ParsedTransactionDate {
  /** 4-digit year, e.g. "2026" */
  year: string;
  /** 2-digit, zero-padded month, e.g. "03" */
  month: string;
}

/**
 * Parses a `transaction_lines.date` value in either format the collection can hold:
 *   - ISO, `YYYY-MM-DD` — every natively-written row.
 *   - Legacy, `DD/MM/YYYY` — migrated rows, which kept their original formatting verbatim and
 *     may not be zero-padded (e.g. "9/3/2026").
 *
 * Returns `null` when the string cannot be parsed as either format, or parses to an
 * out-of-range month (00 or >12). Callers MUST treat `null` explicitly — skip the row, or warn
 * — and must never substitute a guess (the current date/"now", or bucketing it as if it matched
 * whatever month happens to be selected). A date that fails to parse is a data problem, not an
 * empty one; silently going either direction (drop vs. "now") is the corruption Fix 1 exists to
 * close.
 */
export function parseTransactionDate(dateStr: string | undefined | null): ParsedTransactionDate | null {
  // T3 review F1 — TYPE, not truthiness. Every caller of this function reads
  // `transaction_lines.date` off an untrusted Firestore document, and the root tsconfig is not
  // strict, so `data.date as string` compiles and a NUMBER arrives here at runtime. Nothing in
  // `firestore.rules` prevents that: `date is string` is checked on create and on the
  // matrix-governed update branch only, and the `isSuperAdmin() || isParent()` alternation
  // bypasses it — T0 probed a parent writing `date: 12345` live. Without this line the next call
  // is `dateStr.includes('/')`, i.e. a TypeError from a data problem, which is the one direction
  // this function's own contract forbids ("a date that fails to parse is a data problem, not an
  // empty one"). `null` IS the answer for an unreadable date; a throw is not.
  if (typeof dateStr !== 'string') return null;
  if (!dateStr) return null;

  if (dateStr.includes('/')) {
    // DD/MM/YYYY — day is parts[0] and is intentionally unused below; a day > 12 (e.g.
    // "25/03/2026") must not be confused for the month field.
    const parts = dateStr.split('/');
    const day = parts[0];
    const month = parts[1];
    const year = parts[2];
    if (!day || !month || !year) return null;
    if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
    return normalize(year, month);
  }

  if (dateStr.includes('-')) {
    // YYYY-MM-DD
    const parts = dateStr.split('-');
    const year = parts[0];
    const month = parts[1];
    if (!year || !month) return null;
    if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month)) return null;
    return normalize(year, month);
  }

  return null;
}

function normalize(year: string, month: string): ParsedTransactionDate | null {
  const monthNum = Number(month);
  if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) return null;
  return { year, month: month.padStart(2, '0') };
}

/**
 * True when a transaction's date falls in the given month/year. Built on
 * `parseTransactionDate`, so an unparseable date safely resolves to "does not match" rather
 * than throwing or silently matching every filter.
 */
export function matchesMonthYear(
  dateStr: string | undefined | null,
  month: string,
  year: string
): boolean {
  const parsed = parseTransactionDate(dateStr);
  if (!parsed) return false;
  return parsed.month === month && parsed.year === year;
}

/** True when a transaction's date falls in the given year (any month). */
export function matchesYear(dateStr: string | undefined | null, year: string): boolean {
  const parsed = parseTransactionDate(dateStr);
  if (!parsed) return false;
  return parsed.year === year;
}

// Migrated legacy rows may still carry the pre-mapping category name (`Income_Investments`)
// instead of the mapped Hebrew label (`הכנסות והשקעות`) — both must be recognized as income so
// income never gets counted as an expense regardless of which side of the migration a row is on.
const INCOME_CATEGORIES = new Set(['הכנסות והשקעות', 'Income_Investments']);

export function isIncomeCategory(category: string | undefined | null): boolean {
  if (!category) return false;
  return INCOME_CATEGORIES.has(category);
}

export interface TransactionLineLike {
  category?: string | null;
  isCredit?: boolean | null;
  paymentType?: string | null;
}

/**
 * The aggregate/report rule — used by Dashboard (budget-vs-actual + category pie),
 * AnnualReport, and CentralExpenseReport: a row counts as an expense unless it's an
 * income-category row, or ANY isCredit row (refund or not).
 *
 * The isCredit exclusion was introduced in Task 5 and is controller-confirmed intentional: a
 * refund is not an expense, and applying it unconditionally is what makes these three
 * components' totals consistent with each other. Do not add a refund/cancellation carve-out
 * here — see `isExpenseListRow` below for the one component that has one, and why it was left
 * alone rather than converged.
 */
export function isExpenseRow(row: TransactionLineLike): boolean {
  if (isIncomeCategory(row.category)) return false;
  if (row.isCredit) return false;
  return true;
}

/**
 * ExpensesBreakdown's list-view rule. This predates Task 5 (present since the original
 * commit) and was NOT part of that ruling: a refund or cancellation credit row stays visible
 * (and counted in the list's total) so the user can see the refund happened, while any other
 * isCredit row is hidden. This is a real divergence from `isExpenseRow` above — preserved
 * as-is rather than converged, because it reads as a deliberate list-view-vs-report-total
 * design choice, not a bug. Flagged in the fix-batch report for controller review.
 */
export function isExpenseListRow(row: TransactionLineLike): boolean {
  if (isIncomeCategory(row.category)) return false;
  if (row.isCredit && row.paymentType !== 'refund' && row.paymentType !== 'cancellation') return false;
  return true;
}
