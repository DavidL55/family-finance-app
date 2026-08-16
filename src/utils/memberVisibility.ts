// Dead-end avoidance for FilterBar's מי selector (controller ruling, folded into Task 4 — see
// progress.md's "Residual TRUE item, downgraded from security to UX/correctness"). Not a security
// boundary: firestore.rules already denies reads the viewer isn't authorized for regardless of
// what this filters out (the Sasha investigation confirmed transaction_lines/incomes are DENIED
// WHOLESALE for a member without a family-level grant — see security-fix-settings-rules.md and
// progress.md). This is purely a UX fix: offering a chip for a family member whose transaction
// rows the viewer can never read leads to a dead-end selection (a filter that silently returns
// nothing, indistinguishable to the user from "this person really has ₪0").
//
// The one module this stage's מי control actually filters is `transaction_lines`
// (`resolveMemberSelectionNames`, consumed by Dashboard's KPI cards), gated by firestore.rules'
// `canAccessExpenses` on the 'expenses' ModuleId — so `expensesView` is the one permission level
// that matters here; nothing else (income/investments/goals) is filtered by this control.
import type { Member } from './seedFromBudgetConfig';
import type { Group, PermissionLevel, PermissionRole } from '../types/permissions';

export interface ViewerAccess {
  role: PermissionRole;
  memberId: string;
  expensesView: PermissionLevel;
}

export interface ViewableMembers {
  members: Member[];
  groups: Group[];
}

/**
 * Narrows the member/group lists FilterBar offers in its מי control down to what the current
 * viewer could ever get real data for.
 *
 * `viewerAccess === null` (viewer identity/permissions not yet known/wired — e.g. a
 * `FilterProvider` mounted standalone, as this project's own isolated component tests do) or an
 * `expensesView` of `'family'` (full household visibility, including every super-admin/parent
 * session) return the lists unrestricted. Anything less (`'own'` or `'none'`) means the viewer can
 * only ever read their OWN transaction_lines rows (or none at all) — every other member is a
 * guaranteed dead end, and so is every group (a group always implies members beyond the viewer).
 * In that case only the viewer's own member entry is offered (empty if it isn't even present in
 * the supplied list), and the group list comes back empty.
 */
export function filterViewableMembers(
  members: Member[],
  groups: Group[],
  viewerAccess: ViewerAccess | null
): ViewableMembers {
  if (!viewerAccess || viewerAccess.expensesView === 'family') {
    return { members, groups };
  }
  return { members: members.filter((m) => m.id === viewerAccess.memberId), groups: [] };
}
