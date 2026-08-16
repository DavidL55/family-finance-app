import type { ModulePermissionMap, PermissionDoc, PermissionLevel } from '../types/permissions';

// Exported so PermissionsManager.tsx can apply the identical none < own < family ordering when
// restricting the edit choices it offers, rather than re-declaring its own copy of this map.
export const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, own: 1, family: 2 };
const higherLevel = (a: PermissionLevel, b: PermissionLevel): PermissionLevel =>
  LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
const lowerLevel = (a: PermissionLevel, b: PermissionLevel): PermissionLevel =>
  LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;

const VALID_LEVELS: ReadonlySet<PermissionLevel> = new Set(['none', 'own', 'family']);

// Rules and callers alike trust this map's values to be exactly 'none' | 'own' | 'family'
// (fail-closed depends on it) — coerce anything else (a hand-edited or corrupt Firestore
// doc, e.g. 'admin') to 'none' rather than let it flow through unchanged.
const sanitizeLevel = (level: PermissionLevel, context: string): PermissionLevel => {
  if (VALID_LEVELS.has(level)) return level;
  console.warn(
    `[resolveEffectivePermissions] coerced out-of-union level "${String(level)}" to "none" (${context})`
  );
  return 'none';
};

// A group or member-exception doc with a missing/malformed `modules` field must contribute
// nothing rather than throw — Object.entries(undefined/null) throws a TypeError, and an
// unhandled exception here is an availability problem for every caller of this resolver.
const safeModuleEntries = (
  modules: PermissionDoc['modules'] | null | undefined
): Array<[string, ModulePermissionMap[keyof ModulePermissionMap]]> => {
  if (!modules || typeof modules !== 'object') return [];
  return Object.entries(modules);
};

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
    for (const [moduleId, perm] of safeModuleEntries(groupDoc.modules)) {
      if (!perm) continue;
      const view = sanitizeLevel(perm.view, `group ${groupId}, module ${moduleId}, view`);
      const edit = sanitizeLevel(perm.edit, `group ${groupId}, module ${moduleId}, edit`);
      const existing = combined[moduleId as keyof ModulePermissionMap];
      combined[moduleId as keyof ModulePermissionMap] = existing
        ? { view: higherLevel(existing.view, view), edit: higherLevel(existing.edit, edit) }
        : { view, edit };
    }
  }

  // Per-member exception overrides only the modules it mentions (D4) — never a wholesale replace.
  if (memberExceptionDoc) {
    for (const [moduleId, perm] of safeModuleEntries(memberExceptionDoc.modules)) {
      if (!perm) continue;
      const view = sanitizeLevel(perm.view, `member exception ${memberExceptionDoc.targetId}, module ${moduleId}, view`);
      const edit = sanitizeLevel(perm.edit, `member exception ${memberExceptionDoc.targetId}, module ${moduleId}, edit`);
      combined[moduleId as keyof ModulePermissionMap] = { view, edit };
    }
  }

  // Clamp DOWNWARD only: effective edit can never exceed effective view. An edit grant on a
  // module you cannot see is not an edit you can perform in a UI-driven app, and Stage 5's
  // owned-collection writes read the existing doc first (financeCollections.ts's save()/remove()
  // run inside a runTransaction that calls tx.get() before it writes) — that read is gated by the
  // view rule, independently of edit. So the honest resolved value is min(edit, view), never
  // view raised to match edit — auto-granting view would silently widen read access beyond what
  // a super-admin explicitly chose, which is unacceptable for a family's financial data. A no-op
  // whenever edit <= view already (every case the resolver produced before this existed).
  for (const moduleId of Object.keys(combined) as Array<keyof ModulePermissionMap>) {
    const entry = combined[moduleId];
    if (!entry) continue;
    combined[moduleId] = { view: entry.view, edit: lowerLevel(entry.edit, entry.view) };
  }

  return combined;
}
