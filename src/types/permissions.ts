export type PermissionRole = 'super-admin' | 'parent' | 'member';
export type PermissionLevel = 'none' | 'own' | 'family';
export type PermissionAction = 'view' | 'edit';

// Modules with a real Firestore collection wired to the matrix.
// Stage 2: expenses/income/investments/goals. Stage 3 adds accounts/recurring/loans/
// insurances — all owned from day one via `ownerId` (D2/D3), not ownerless like Stage 2's
// income/investments/goals.
export type ModuleId =
  | 'expenses' | 'income' | 'investments' | 'goals'       // Stage 2
  | 'accounts' | 'recurring' | 'loans' | 'insurances';    // Stage 3 — owned from day one, D2/D3
export const MODULE_IDS: readonly ModuleId[] = [
  'expenses', 'income', 'investments', 'goals',
  'accounts', 'recurring', 'loans', 'insurances',
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
