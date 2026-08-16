// Dead-end avoidance for FilterBar's מי selector (controller ruling, folded into Task 4 — see
// progress.md's "Residual TRUE item, downgraded from security to UX/correctness"). Not a security
// boundary: firestore.rules already denies reads the viewer isn't authorized for regardless of
// what this filters out (the Sasha investigation confirmed transaction_lines/incomes are DENIED
// WHOLESALE for a member without a family-level grant — see security-fix-settings-rules.md and
// progress.md). This is purely a UX fix: offering a chip for a family member whose data the
// viewer can never read leads to a dead-end selection (a filter that silently returns nothing,
// indistinguishable to the user from "this person really has ₪0").
//
// D2 (Stage 5 Task 2) — generalized from a single field hardcoded to `expensesView` (Stage 4 built
// this around the fact that 'dashboard' was the only screen using the global מי control, and its
// data was 'expenses'-gated) to a per-module map, `levelsByModule`, read against whichever module
// is driving the CURRENTLY ACTIVE screen (`filterModuleId`, from that screen's `MODULE_REGISTRY`
// entry — see moduleRegistry.ts). Five more owned modules (accounts/loans/insurances/recurring, +
// net-worth spanning several) each have independently grantable levels; hardcoding 'expenses'
// would silently offer dead-end chips on every one of them.
import type { Member } from './seedFromBudgetConfig';
import type { Group, ModuleId, PermissionLevel, PermissionRole } from '../types/permissions';

export interface ViewerAccess {
  role: PermissionRole;
  memberId: string;
  // Computed once in App.tsx for every matrix-governed module FilterBar might ever need (the
  // super-admin/parent bypass to 'family' happens there, before this map is built — see D2).
  levelsByModule: Partial<Record<ModuleId, PermissionLevel>>;
}

export interface ViewableMembers {
  members: Member[];
  groups: Group[];
}

/**
 * Narrows the member/group lists FilterBar offers in its מי control down to what the current
 * viewer could ever get real data for, ON THE CURRENTLY ACTIVE SCREEN.
 *
 * `viewerAccess === null` (viewer identity/permissions not yet known/wired — e.g. a
 * `FilterProvider` mounted standalone, as this project's own isolated component tests do) or
 * `filterModuleId === null` (the active screen's data isn't cleanly gated by one single module —
 * e.g. a future net-worth-style entry spanning accounts+investments+loans; D2's own disclosed
 * "offer everyone" fallback, matching pre-Stage-4 behavior) both return the lists unrestricted,
 * same as a resolved `'family'` level on the active module. Anything less (`'own'`, `'none'`, or a
 * missing entry in the map — fail-closed the same way `'none'` does) means the viewer can only
 * ever read their OWN rows for that module (or none at all) — every other member is a guaranteed
 * dead end, and so is every group (a group always implies members beyond the viewer). In that case
 * only the viewer's own member entry is offered (empty if it isn't even present in the supplied
 * list), and the group list comes back empty.
 */
export function filterViewableMembers(
  members: Member[],
  groups: Group[],
  viewerAccess: ViewerAccess | null,
  filterModuleId: ModuleId | null
): ViewableMembers {
  if (!viewerAccess || filterModuleId === null) {
    return { members, groups };
  }
  const level = viewerAccess.levelsByModule[filterModuleId] ?? 'none';
  if (level === 'family') {
    return { members, groups };
  }
  return { members: members.filter((m) => m.id === viewerAccess.memberId), groups: [] };
}
