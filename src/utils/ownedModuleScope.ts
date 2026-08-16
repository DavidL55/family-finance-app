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
