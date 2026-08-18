export type PermissionRole = 'super-admin' | 'parent' | 'member';
export type PermissionLevel = 'none' | 'own' | 'family';
export type PermissionAction = 'view' | 'edit';

// Modules with a real Firestore collection wired to the matrix.
// Stage 2: expenses/income/investments/goals. Stage 3 adds accounts/recurring/loans/
// insurances — all owned from day one via `ownerId` (D2/D3), not ownerless like Stage 2's
// income/investments/goals. Stage 7 adds forecast — see below.
//
// STAGE 7 D25(a) — `'forecast'` DOES ONE JOB: it authorizes writes to `forecast_assumptions`.
// It is deliberately NOT a tab. `isModuleVisible` (moduleRegistry.ts:86-95) hides any tab whose
// `permissionModuleId` is not null and not granted, so wiring the screen to this id would take the
// tab away from a viewer holding `expenses: family` while the always-shown Dashboard card carried
// on drilling into it. The registry entry therefore lands with `permissionModuleId: null`, in T7b,
// beside the screen — `ModuleRegistryId` is a DIFFERENT union from this one (v2.1 finding 1.4.4),
// and adding a registry id with no matching `case` in App.tsx's exhaustive `never` check fails
// `tsc --noEmit` outright.
//
// This union is MIRRORED at functions/src/shared/permissions.ts:17 across the deploy boundary.
// Nothing held the two in sync until Stage 7 T2; `aiPermissionsContract.test.ts` now compares them
// structurally (both `ModuleId` declarations AND this array), so the next addition fails loudly on
// the half someone forgets.
export type ModuleId =
  | 'expenses' | 'income' | 'investments' | 'goals'       // Stage 2
  | 'accounts' | 'recurring' | 'loans' | 'insurances'     // Stage 3 — owned from day one, D2/D3
  | 'forecast';                                           // Stage 7 — authorizes forecast_assumptions writes (D25a)
export const MODULE_IDS: readonly ModuleId[] = [
  'expenses', 'income', 'investments', 'goals',
  'accounts', 'recurring', 'loans', 'insurances',
  'forecast',
] as const;

// Modules with NO per-person owner field (Design decision D5, Stage 2) — 'own' cannot be
// enforced on these; only 'family' grants access. UNCHANGED in Stage 3 — none of the four
// new modules are ownerless (D2); they use the 'own'-aware rules path from day one.
export const OWNERLESS_MODULES: readonly ModuleId[] = ['income', 'investments', 'goals'] as const;

export interface ModulePermission {
  view: PermissionLevel;
  edit: PermissionLevel;
}
export type ModulePermissionMap = Partial<Record<ModuleId, ModulePermission>>;

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type PermissionScope = 'group' | 'member';

export interface PermissionDoc {
  id: string;            // `group__${targetId}` | `member__${targetId}`
  scope: PermissionScope;
  targetId: string;      // groupId or memberId
  modules: ModulePermissionMap;
  updatedAt: string;
  updatedBy: string;     // memberId of the super-admin who wrote it
}

export const permissionDocId = (scope: PermissionScope, targetId: string): string =>
  `${scope}__${targetId}`;
