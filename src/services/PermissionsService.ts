// `permissions` collection CRUD + resolvedPermissions materialization (Stage 2, D2/D9).
//
// D9: the `permissions` collection is super-admin-only for read AND write — enforced in
// firestore.rules (Task 5/6), not here; this service just talks to the collection assuming the
// caller is already authorized to.
//
// D2 (the load-bearing architectural decision of this stage): Firestore Rules cannot loop over
// a member's `groups` array, so cross-group combination happens in tested TypeScript
// (`resolveEffectivePermissions`) and the flattened result is written onto
// `members/{id}.resolvedPermissions`. `recomputeResolvedPermissions` is the ONLY place that
// materializes it, and it always writes the member doc and (when invoked from
// `saveModulePermissions`) the same-batch guarantee is honored at the call-site level: any
// caller that changes `groups`/`permissions` must call `recomputeResolvedPermissions` for every
// affected member before/alongside that change is considered "done" — see the per-function docs
// below for exactly which batch each write lands in.
//
// Per the Task 3 correction: this module does NOT apply any "ownerless module" downgrade to
// `'own'` grants on income/investments/goals. That is closed structurally in Firestore Rules
// (Task 5) — `ownerlessModuleAllowed()` only ever compares against `'family'`, never `'own'`, so
// a stray `'own'` here can never grant anything there. Materialize the resolver's output
// faithfully; do not rewrite levels.

import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Member } from '../utils/seedFromBudgetConfig';
import type { ModulePermissionMap, PermissionDoc, PermissionScope } from '../types/permissions';
import { permissionDocId } from '../types/permissions';
import { resolveEffectivePermissions } from '../utils/resolvePermissions';
import { writeAuditLog } from '../utils/auditLog';

const PERMISSIONS_COLLECTION = 'permissions';
const MEMBERS_COLLECTION = 'members';

/**
 * Reads every document in the `permissions` collection. Does NOT catch/swallow a query failure
 * into `[]` — a failed read must surface as a rejected promise (project-wide rule: a failed read
 * renders an error, never an empty state).
 */
export async function listPermissionDocs(): Promise<PermissionDoc[]> {
  const snap = await getDocs(collection(db, PERMISSIONS_COLLECTION));
  return snap.docs.map((d) => d.data() as PermissionDoc);
}

/**
 * Writes (creates or overwrites) the module-permission matrix for one group or one member, and
 * an audit_log entry describing the change, in a single atomic batch.
 *
 * This does NOT itself recompute `resolvedPermissions` for any member — the set of affected
 * members for a GROUP-scoped change is not known here without a members query, and the caller
 * (the permissions-matrix UI, Task 8) already knows exactly which member(s) it's editing on
 * behalf of. Callers MUST call `recomputeResolvedPermissions` for every affected member
 * immediately after this resolves, so `resolvedPermissions` never drifts from this write.
 */
export async function saveModulePermissions(
  scope: PermissionScope,
  targetId: string,
  modules: ModulePermissionMap,
  actorMemberId: string
): Promise<void> {
  const id = permissionDocId(scope, targetId);
  const batch = writeBatch(db);
  const permDoc: PermissionDoc = {
    id,
    scope,
    targetId,
    modules,
    updatedAt: new Date().toISOString(),
    updatedBy: actorMemberId,
  };
  batch.set(doc(db, PERMISSIONS_COLLECTION, id), permDoc);
  writeAuditLog(batch, {
    actorMemberId,
    action: 'permissions.update',
    target: `${PERMISSIONS_COLLECTION}/${id}`,
  });
  await batch.commit();
}

/**
 * Recomputes `members/{memberId}.resolvedPermissions` from the member's current `groups` plus
 * whatever `permissions` docs currently exist, and writes it in its own batch (merge write —
 * touches only `resolvedPermissions`, leaves the rest of the member doc untouched).
 *
 * Throws (does not silently no-op) when the member doc does not exist, so a caller passing a bad
 * id finds out immediately rather than the resolvedPermissions field quietly never getting set.
 */
export async function recomputeResolvedPermissions(memberId: string): Promise<void> {
  const memberSnap = await getDoc(doc(db, MEMBERS_COLLECTION, memberId));
  if (!memberSnap.exists()) {
    throw new Error(`[PermissionsService.recomputeResolvedPermissions] member not found: ${memberId}`);
  }
  const member = memberSnap.data() as Member;

  const allDocs = await listPermissionDocs();
  const groupDocsById: Record<string, PermissionDoc | undefined> = {};
  let exceptionDoc: PermissionDoc | null = null;
  for (const permDoc of allDocs) {
    if (permDoc.scope === 'group') groupDocsById[permDoc.targetId] = permDoc;
    if (permDoc.scope === 'member' && permDoc.targetId === memberId) exceptionDoc = permDoc;
  }

  const resolved = resolveEffectivePermissions(member.groups ?? [], exceptionDoc, groupDocsById);

  const batch = writeBatch(db);
  batch.set(doc(db, MEMBERS_COLLECTION, memberId), { resolvedPermissions: resolved }, { merge: true });
  await batch.commit();
}

/**
 * Drift-recovery utility: recomputes and rewrites `resolvedPermissions` for every member.
 * Documented mitigation for the case where someone edits `groups`/`permissions`/`members`
 * directly via the Firestore Emulator UI (bypassing the app entirely, so D2's same-batch
 * guarantee never ran) and resolvedPermissions is left stale.
 */
export async function recomputeAllResolvedPermissions(): Promise<void> {
  const snap = await getDocs(collection(db, MEMBERS_COLLECTION));
  for (const memberDoc of snap.docs) {
    await recomputeResolvedPermissions(memberDoc.id);
  }
}
