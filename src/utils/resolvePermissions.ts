import type { ModulePermissionMap, PermissionDoc, PermissionLevel } from '../types/permissions';

const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, own: 1, family: 2 };
const higherLevel = (a: PermissionLevel, b: PermissionLevel): PermissionLevel =>
  LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;

/**
 * Combines a member's group-derived permission grants (D3: most permissive level
 * wins per module per action, independently for view/edit) with their per-member
 * exception doc (D4: overrides only the modules it explicitly lists — never a
 * wholesale replacement). Pure function; no Firebase, no I/O.
 *
 * A module nobody mentions is absent from the result, which callers must treat as
 * none/none (fail closed) — see the "returns {} when ..." tests.
 */
export function resolveEffectivePermissions(
  memberGroupIds: string[],
  memberExceptionDoc: PermissionDoc | null,
  groupPermissionDocsById: Record<string, PermissionDoc | undefined>
): ModulePermissionMap {
  const combined: ModulePermissionMap = {};

  // Combine every group the member belongs to — most permissive per action wins (D3).
  for (const groupId of memberGroupIds) {
    const groupDoc = groupPermissionDocsById[groupId];
    if (!groupDoc) continue;
    for (const [moduleId, perm] of Object.entries(groupDoc.modules)) {
      if (!perm) continue;
      const existing = combined[moduleId as keyof ModulePermissionMap];
      combined[moduleId as keyof ModulePermissionMap] = existing
        ? { view: higherLevel(existing.view, perm.view), edit: higherLevel(existing.edit, perm.edit) }
        : { view: perm.view, edit: perm.edit };
    }
  }

  // Per-member exception overrides only the modules it mentions (D4) — never a wholesale replace.
  if (memberExceptionDoc) {
    for (const [moduleId, perm] of Object.entries(memberExceptionDoc.modules)) {
      if (!perm) continue;
      combined[moduleId as keyof ModulePermissionMap] = { view: perm.view, edit: perm.edit };
    }
  }

  return combined;
}
