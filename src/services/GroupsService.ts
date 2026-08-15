// `groups` collection CRUD (Stage 2). Every write is paired, in the same batch, with an
// audit_log entry — see src/utils/auditLog.ts. Group membership drives resolvedPermissions
// materialization (PermissionsService), but this service itself does not recompute anything;
// callers that change group membership are responsible for calling
// PermissionsService.recomputeResolvedPermissions for the affected member(s) afterward.
//
// members/{id}.groups sync (closes the Stage-1 ledger item: `Member.groups` was defined —
// "empty for now, Stage 2 fills" per seedFromBudgetConfig.ts — but nothing wrote to it before
// Task 8). `PermissionsService.recomputeResolvedPermissions` resolves effective permissions from
// `member.groups` directly, NOT by querying `groups.memberIds` — so `groups/{id}.memberIds` and
// each affected member's own `.groups` array must be kept in sync, or a group-membership change
// would silently never reach resolvedPermissions no matter how many times recompute runs
// afterward. `saveGroup`/`deleteGroup` take the group's PREVIOUS memberIds (the caller already
// has this — it's exactly what Task 8's union-of-before/after-memberIds recompute needs too) and
// write `arrayUnion`/`arrayRemove` on every added/removed member's `.groups` field in the SAME
// batch as the group doc write, so there is never a window where the two disagree.

import { arrayRemove, arrayUnion, collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Group } from '../types/permissions';
import { writeAuditLog } from '../utils/auditLog';

const GROUPS_COLLECTION = 'groups';
const MEMBERS_COLLECTION = 'members';

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
 * Creates or overwrites a group doc, syncs `members/{id}.groups` for every member whose
 * membership changed (added/removed relative to `previousMemberIds`), and writes an audit_log
 * entry — all in a single atomic batch, so an audit trail entry can never exist without the write
 * it describes, and a member's `.groups` array can never disagree with this group's `memberIds`.
 *
 * `previousMemberIds` defaults to `[]` (a brand-new group: every member in `group.memberIds` is
 * "added"). Callers editing an EXISTING group must pass the group's memberIds as they were before
 * this edit — the caller (Task 8's admin screen) already has this, since it's the same value its
 * own union-of-before/after recompute needs.
 */
export async function saveGroup(
  group: Pick<Group, 'id' | 'name' | 'memberIds'>,
  actorMemberId: string,
  previousMemberIds: readonly string[] = []
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

  const before = new Set(previousMemberIds);
  const after = new Set(group.memberIds);
  for (const memberId of group.memberIds) {
    if (!before.has(memberId)) {
      batch.update(doc(db, MEMBERS_COLLECTION, memberId), { groups: arrayUnion(group.id) });
    }
  }
  for (const memberId of previousMemberIds) {
    if (!after.has(memberId)) {
      batch.update(doc(db, MEMBERS_COLLECTION, memberId), { groups: arrayRemove(group.id) });
    }
  }

  writeAuditLog(batch, { actorMemberId, action: 'group.save', target: `${GROUPS_COLLECTION}/${group.id}` });
  await batch.commit();
}

/**
 * Deletes a group doc, strips this group's id from every listed member's `.groups` array (same
 * batch), and writes an audit_log entry describing the deletion. `memberIds` should be the
 * group's `memberIds` as they were immediately before deletion (the caller already has this).
 */
export async function deleteGroup(
  groupId: string,
  actorMemberId: string,
  memberIds: readonly string[] = []
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, GROUPS_COLLECTION, groupId));
  for (const memberId of memberIds) {
    batch.update(doc(db, MEMBERS_COLLECTION, memberId), { groups: arrayRemove(groupId) });
  }
  writeAuditLog(batch, { actorMemberId, action: 'group.delete', target: `${GROUPS_COLLECTION}/${groupId}` });
  await batch.commit();
}
