// `groups` collection CRUD (Stage 2). Every write is paired, in the same batch, with an
// audit_log entry — see src/utils/auditLog.ts. Group membership drives resolvedPermissions
// materialization (PermissionsService), but this service itself does not recompute anything;
// callers that change group membership are responsible for calling
// PermissionsService.recomputeResolvedPermissions for the affected member(s) afterward.

import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Group } from '../types/permissions';
import { writeAuditLog } from '../utils/auditLog';

const GROUPS_COLLECTION = 'groups';

/**
 * Reads every document in the `groups` collection. Does NOT catch/swallow a query failure into
 * `[]` — a failed read must surface as a rejected promise so callers can render an explicit
 * error state (project-wide rule: a failed read renders an error, never an empty state).
 */
export async function listGroups(): Promise<Group[]> {
  const snap = await getDocs(collection(db, GROUPS_COLLECTION));
  return snap.docs.map((d) => d.data() as Group);
}

/**
 * Creates or overwrites a group doc and writes an audit_log entry describing the change, in a
 * single atomic batch — so an audit trail entry can never exist without the write it describes.
 */
export async function saveGroup(
  group: Pick<Group, 'id' | 'name' | 'memberIds'>,
  actorMemberId: string
): Promise<void> {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const groupDoc: Group = {
    id: group.id,
    name: group.name,
    memberIds: group.memberIds,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(db, GROUPS_COLLECTION, group.id), groupDoc);
  writeAuditLog(batch, { actorMemberId, action: 'group.save', target: `${GROUPS_COLLECTION}/${group.id}` });
  await batch.commit();
}

/** Deletes a group doc and writes an audit_log entry describing the deletion, in one batch. */
export async function deleteGroup(groupId: string, actorMemberId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, GROUPS_COLLECTION, groupId));
  writeAuditLog(batch, { actorMemberId, action: 'group.delete', target: `${GROUPS_COLLECTION}/${groupId}` });
  await batch.commit();
}
