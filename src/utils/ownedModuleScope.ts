// D1 — resolves a session's effective read scope for the four Stage 3 "owned" collections
// (accounts/recurring/loans/insurances) into exactly the shape `financeCollections.ts`'s
// scope-aware `list()` needs. Pure, no I/O — mirrors the Rules layer's own bypass precedent
// (`canAccessOwnedModule`: `isSuperAdmin() || isParent() || ...`) so app code and Rules never
// disagree about who gets the unconstrained 'family' scan.
import type { PermissionLevel, PermissionRole } from '../types/permissions';

/**
 * Super-admin/parent always resolve to 'family' regardless of any stored level, matching the
 * Rules layer's own unconditional bypass. A 'member' role resolves whatever level was granted,
 * defaulting an absent/'none' level to 'none' — fail-closed, matching sanitizeLevel's precedent.
 */
export function resolveOwnedModuleScope(
  role: PermissionRole,
  level: PermissionLevel | undefined
): 'own' | 'family' | 'none' {
  if (role === 'super-admin' || role === 'parent') return 'family';
  if (level === 'family') return 'family';
  if (level === 'own') return 'own';
  return 'none';
}

/**
 * The same resolution for an OWNERLESS module (`income`, `investments`, `goals` — Stage 2 D5).
 *
 * `'own'` is not expressible on a collection with no owner field, so a stored level of `'own'`
 * grants NOTHING here rather than degrading into a family-wide read. That is the asymmetry D17's
 * table records with "❌ structurally" against `incomes` and `goals`: an `'own'` viewer's forecast
 * cannot include income, and the reason is the data model rather than a permission decision.
 *
 * Dashboard already spelled this inline for `investments`
 * (`session.role !== 'member' || investmentsViewLevel === 'family'`). Two spellings of one rule is
 * how the app and Rules start disagreeing about who gets an unconstrained scan, so it lives beside
 * its owned-module sibling.
 */
export function resolveOwnerlessModuleScope(
  role: PermissionRole,
  level: PermissionLevel | undefined
): 'family' | 'none' {
  if (role === 'super-admin' || role === 'parent') return 'family';
  return level === 'family' ? 'family' : 'none';
}
