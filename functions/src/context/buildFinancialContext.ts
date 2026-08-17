import { getFirestore } from 'firebase-admin/firestore';
import { resolveOwnedModuleScope } from '../shared/permissions';
import type { PermissionRole } from '../shared/permissions';
import type { FinancialContext, FinancialFact, AiFilterScope } from './types';

export type { FinancialContext, FinancialFact, AiFilterScope } from './types';

/**
 * D8 — the critical fix both review lenses found independently: `role` is a VERIFIED, REQUIRED
 * parameter, sourced by every caller from `request.auth.token.role` (the custom claim), never
 * read from the `members/{memberId}` document fetched below. That document is read ONLY for
 * `resolvedPermissions` — never consulted for identity or role. See
 * `functions/src/shared/permissions.ts`'s file header for the contract this function must never
 * violate, and `src/__tests__/aiPermissionsContract.test.ts` for the AST-based guard that
 * enforces it at the repo level.
 */
export async function buildFinancialContext(
  memberId: string,
  role: PermissionRole,
  filterScope: AiFilterScope
): Promise<FinancialContext> {
  const db = getFirestore();
  const memberSnap = await db.doc(`members/${memberId}`).get();
  const member = memberSnap.data() as { resolvedPermissions?: { recurring?: { view?: string } } } | undefined;

  const level = member?.resolvedPermissions?.recurring?.view as 'none' | 'own' | 'family' | undefined;
  const scope = resolveOwnedModuleScope(role, level);

  if (scope === 'none') {
    return { scope, filterScope, totalMonthlyExpense: null, totalMonthlyIncome: null, netWorth: null };
  }

  // D16 (third-lens M3) — the member axis of the global filter narrows a family-scope query to
  // the selected subset, exactly like every other owned-collection consumer already narrows on
  // filters.member. An 'own'-scope caller is already narrower than any filter could make it, so
  // filterScope.memberIds is deliberately ignored there — filtering an already-single-member
  // query by a DIFFERENT member id would silently zero it out, which is not what "I filtered the
  // screen" means for a caller who can only ever see their own data anyway.
  let recurringQuery = db.collection('recurring').where('status', '==', 'active');
  if (scope === 'family') {
    if (filterScope.memberIds) {
      // Firestore 'in' caps at 30 values — this app's family sizes are nowhere near that;
      // documented as a known, low-risk limit rather than engineered around (D16).
      recurringQuery = recurringQuery.where('ownerId', 'in', filterScope.memberIds.slice(0, 30));
    }
  } else {
    recurringQuery = recurringQuery.where('ownerId', '==', memberId);
  }
  const recurringSnap = await recurringQuery.get();

  // Two SEPARATE sums — never one blind total (D8, the Stage 5 C2 lesson: totalMonthlyExpense
  // and totalMonthlyIncome must never be collapsed into one figure).
  let expenseTotal = 0;
  let incomeTotal = 0;
  recurringSnap.forEach((doc) => {
    const d = doc.data() as { kind?: string; amount?: number };
    if (d.kind === 'expense') expenseTotal += Number(d.amount ?? 0);
    else if (d.kind === 'income') incomeTotal += Number(d.amount ?? 0);
  });

  const asOfToday = new Date().toISOString().slice(0, 10);
  const fact = (value: number, source: string): FinancialFact => ({ value, source, asOf: asOfToday });

  return {
    scope,
    filterScope, // echoed back unchanged so aiChat.ts's system prompt can disclose the covered
                 // scope to the model verbatim (D16) — this function only ever narrows the query
                 // by it, never mutates or re-derives it.
    totalMonthlyExpense: fact(expenseTotal, 'recurring (סוג הוצאה, פעיל)'),
    totalMonthlyIncome: fact(incomeTotal, 'recurring (סוג הכנסה, פעיל)'),
    // netWorth ships null this stage — a deliberate, documented scope decision (see the plan's
    // D8 discussion and progress.md), not an oversight: computeNetWorth() is a pure function
    // safe to call server-side once the accounts/loans reads are added following the same scope
    // pattern above; flagged inline rather than rushed in, matching this project's "flag, don't
    // fabricate" convention from Stage 5's own netWorth.ts.
    netWorth: null,
  };
}
