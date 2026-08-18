// MIRROR of src/utils/ownedModuleScope.ts (D2). Keep in sync by hand; the cross-package
// contract test at src/__tests__/aiPermissionsContract.test.ts is what actually enforces it —
// this comment is a pointer, not the guarantee.
//
// CONTRACT (D8, states this once so Stages 7-9 inherit it instead of re-deriving their own
// version of the bug this contract exists to prevent): a verified PermissionRole in Functions
// always comes from `request.auth.token.role`. NOTHING in functions/src reads `Member.role` for
// an authorization decision — Member.role is the family relationship (הורה/ילד), not this union,
// and src/utils/provisionRole.ts's own D1 already forbids using it that way.
//
// SCOPE (D2): only pure, side-effect-free authorization HELPER functions may ever be mirrored
// into this file — never anything that derives an identity or a role from stored data. The day a
// second piece of logic needs sharing across the deploy boundary, switch to an esbuild/tsup
// predeploy compile step from ../../src/utils instead of hand-copying a second time.
export type PermissionRole = 'super-admin' | 'parent' | 'member';
export type PermissionLevel = 'none' | 'own' | 'family';
// MIRROR of src/types/permissions.ts's ModuleId. Held in sync by the structural comparison in
// src/__tests__/aiPermissionsContract.test.ts, which parses BOTH declarations and asserts the two
// member sets are equal — added in Stage 7 T2, because until then nothing did and this copy could
// drift silently while the client half broke the build loudly.
export type ModuleId =
  | 'expenses' | 'income' | 'investments' | 'goals'
  | 'accounts' | 'recurring' | 'loans' | 'insurances'
  | 'forecast';

export function resolveOwnedModuleScope(
  role: PermissionRole,
  level: PermissionLevel | undefined
): 'own' | 'family' | 'none' {
  if (role === 'super-admin' || role === 'parent') return 'family';
  if (level === 'family') return 'family';
  if (level === 'own') return 'own';
  return 'none';
}
