// Shared CRUD for the Stage-3 "owned financial collections" — accounts, loans, insurances (and
// recurring's plain-CRUD half; RecurringService.ts adds the bespoke catch-up-posting logic on top
// of this same factory — see Task 5). Design decision D8. All share an identical contract:
// scope-aware read of every doc the caller may see (D1), upsert one doc (new-or-edit, preserving
// `createdAt` across edits), delete one doc, every mutation paired with an audit_log entry in the
// SAME transaction (D10).
//
// D1 — scope-aware list(): `list('family', viewerMemberId)` issues the same bare, unconstrained
// collection scan as before (also covers the super-admin/parent Rules bypass, which never depends
// on `resource.data`). `list('own', viewerMemberId)` adds `where('ownerId', '==', viewerMemberId)`
// — a query Firestore CAN statically verify against firestore.rules' `ownedModuleAllowed()`
// (`data.ownerId == memberId()` branch), because every possible result document is now provably
// constrained to satisfy it. This is NOT a Rules change — the rule already technically permitted
// 'own'-level per-document access; the bug was purely that the client never issued a query shape
// Firestore's list-time verification could accept, so it denied the whole list wholesale for any
// 'own'-level viewer (see ownedModuleScope.ts / RecurringService.ts / useRecurringCatchup.ts for
// how callers resolve which scope to pass).
//
// D10 — save()/remove() run inside runTransaction, not a plain getDoc-then-separate-batch. The
// old shape had no way to detect a concurrent change to the same doc between its read and its
// write: two parents editing the same account/loan/policy/recurring-item concurrently could
// silently clobber each other's fields, or a delete racing an edit could resurrect the "deleted"
// doc — both sessions seeing a success toast. runTransaction makes both operations detect and
// retry-or-fail on exactly that race, per Firestore's own optimistic-concurrency contract. The
// audit_log write rides inside the SAME transaction (via the structural AuditWriter interface,
// D10) as the record write/delete, so an audit entry can never exist without the write it
// describes, or vice versa — same atomicity guarantee the old batch-based version had, just via
// Transaction.set/.delete instead of WriteBatch.set/.delete.
//
// Unlike GroupsService.saveGroup's accepted Stage-2 simplification of always overwriting
// createdAt on every save, this factory does a fetch-then-merge specifically to PRESERVE it —
// "when was this account/loan/policy first added" is real, user-facing financial data here, not
// an internal bookkeeping detail.
//
// Does NOT catch/swallow read failures into `[]` (list) or write failures (save/remove) — a
// failed read renders an error, never an empty state; a failed write must never look like a
// silently-dropped edit (project-wide rule).

import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLog } from '../utils/auditLog';

export interface OwnedRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type OwnedRecordInput<T extends OwnedRecord> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export interface OwnedCollectionRepo<T extends OwnedRecord> {
  list(scope: 'own' | 'family', viewerMemberId: string): Promise<T[]>;
  save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T>;
  remove(id: string, actorMemberId: string): Promise<void>;
}

/**
 * Builds a list/save/remove repo for a single owned Firestore collection. Pure infrastructure —
 * no module-specific logic lives here; `collectionName` picks the Firestore collection and
 * `auditPrefix` picks the audit_log `action` prefix (e.g. `'loan'` → `'loan.save'`/`'loan.delete'`).
 */
export function createOwnedCollectionRepo<T extends OwnedRecord>(
  collectionName: string,
  auditPrefix: string
): OwnedCollectionRepo<T> {
  /**
   * Reads every document the caller's scope permits. Does NOT catch/swallow a query failure into
   * `[]` — a failed read must surface as a rejected promise so callers can render an explicit
   * error state (project-wide rule: a failed read renders an error, never an empty state).
   *
   * D1: `scope === 'family'` issues the same bare, unconstrained collection scan the caller had
   * before — correct for super-admin/parent (whose Rules bypass never depends on `resource.data`)
   * and for a 'member' session actually granted family-level access. `scope === 'own'` adds
   * `where('ownerId', '==', viewerMemberId)`, which Firestore's list-time rule verification CAN
   * statically prove satisfies `ownedModuleAllowed()`'s `data.ownerId == memberId()` branch —
   * unlike the bare scan, which it must deny wholesale for an 'own'-level viewer since it cannot
   * prove every possible result document would pass.
   */
  async function list(scope: 'own' | 'family', viewerMemberId: string): Promise<T[]> {
    const target =
      scope === 'own'
        ? query(collection(db, collectionName), where('ownerId', '==', viewerMemberId))
        : collection(db, collectionName);
    const snap = await getDocs(target);
    return snap.docs.map((d) => d.data() as T);
  }

  /**
   * Creates (no `input.id`, or an `input.id` not yet present in Firestore) or edits (an
   * `input.id` that already exists) one doc, and writes an audit_log entry — both inside a
   * single atomic transaction, so an audit trail entry can never exist without the write it
   * describes.
   *
   * Fetch-then-merge: when `input.id` is provided, the existing doc is read FIRST, INSIDE the
   * transaction (D10) — not before the transaction starts — so its `createdAt` can be PRESERVED
   * on the merged record ("when was this first added" is user-facing financial data, not
   * bookkeeping to overwrite on every edit, D8) AND so Firestore can detect a concurrent change
   * to the same doc between this read and the commit, retrying (or failing) the whole transaction
   * rather than silently letting a second concurrent editor's write land last and clobber the
   * first. A brand-new record (no id, or an id with no existing doc) gets
   * `createdAt === updatedAt === now`.
   */
  async function save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T> {
    const now = new Date().toISOString();
    const id = input.id ?? doc(collection(db, collectionName)).id;
    const ref = doc(db, collectionName, id);

    return runTransaction(db, async (tx) => {
      let createdAt = now;
      if (input.id) {
        const existing = await tx.get(ref);
        if (existing.exists()) {
          createdAt = (existing.data() as T).createdAt;
        }
      }
      const record = { ...input, id, createdAt, updatedAt: now } as T;
      tx.set(ref, record);
      writeAuditLog(tx, { actorMemberId, action: `${auditPrefix}.save`, target: `${collectionName}/${id}` });
      return record;
    });
  }

  /**
   * Deletes one doc and writes an audit_log entry describing the deletion, atomically inside one
   * transaction. Propagates a write failure rather than swallowing it — a failed delete must
   * never look like a silently-dropped edit.
   *
   * D10: reads the doc first, INSIDE the transaction, and no-ops (no delete, no audit) if it's
   * already gone — this is what stops a delete from racing a concurrent edit into resurrecting
   * the record: the old unconditional `batch.delete` had no way to know whether the doc it was
   * about to delete had just been re-`set` a moment earlier by another session's edit.
   */
  async function remove(id: string, actorMemberId: string): Promise<void> {
    const ref = doc(db, collectionName, id);
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if (!existing.exists()) return; // already gone — no-op, not an error, no audit noise
      tx.delete(ref);
      writeAuditLog(tx, { actorMemberId, action: `${auditPrefix}.delete`, target: `${collectionName}/${id}` });
    });
  }

  return { list, save, remove };
}
