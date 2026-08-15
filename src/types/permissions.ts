export type PermissionRole = 'super-admin' | 'parent' | 'member';
export type PermissionLevel = 'none' | 'own' | 'family';
export type PermissionAction = 'view' | 'edit';

// Modules with a real Firestore collection wired to the matrix as of Stage 2.
// Stage 3 extends this union when accounts/loans/insurances collections land.
export type ModuleId = 'expenses' | 'income' | 'investments' | 'goals';
export const MODULE_IDS: readonly ModuleId[] = ['expenses', 'income', 'investments', 'goals'] as const;

// Modules with NO per-person owner field yet (Design decision D5) — 'own' cannot be
// enforced on these; only 'family' grants access until Stage 3 adds ownership.
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
