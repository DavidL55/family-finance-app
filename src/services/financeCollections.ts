// Shared CRUD for the Stage-3 "owned financial collections" — accounts, loans, insurances (and
// recurring's plain-CRUD half; RecurringService.ts adds the bespoke catch-up-posting logic on top
// of this same factory — see Task 5). Design decision D8. All share an identical contract: read
// every doc, upsert one doc (new-or-edit, preserving `createdAt` across edits), delete one doc,
// every mutation paired with an audit_log entry in the SAME batch.
//
// Unlike GroupsService.saveGroup's accepted Stage-2 simplification of always overwriting
// createdAt on every save, this factory does a fetch-then-merge specifically to PRESERVE it —
// "when was this account/loan/policy first added" is real, user-facing financial data here, not
// an internal bookkeeping detail.
//
// Does NOT catch/swallow read failures into `[]` (list) or write failures (save/remove) — a
// failed read renders an error, never an empty state; a failed write must never look like a
// silently-dropped edit (project-wide rule).

import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
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
  list(): Promise<T[]>;
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
   * Reads every document in the collection. Does NOT catch/swallow a query failure into `[]` —
   * a failed read must surface as a rejected promise so callers can render an explicit error
   * state (project-wide rule: a failed read renders an error, never an empty state).
   */
  async function list(): Promise<T[]> {
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map((d) => d.data() as T);
  }

  /**
   * Creates (no `input.id`, or an `input.id` not yet present in Firestore) or edits (an
   * `input.id` that already exists) one doc, and writes an audit_log entry — both in a single
   * atomic batch, so an audit trail entry can never exist without the write it describes.
   *
   * Fetch-then-merge: when `input.id` is provided, the existing doc is read first so its
   * `createdAt` can be PRESERVED on the merged record — "when was this first added" is
   * user-facing financial data, not bookkeeping to overwrite on every edit (D8). A brand-new
   * record (no id, or an id with no existing doc) gets `createdAt === updatedAt === now`.
   */
  async function save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T> {
    const now = new Date().toISOString();
    const id = input.id ?? doc(collection(db, collectionName)).id;

    let createdAt = now;
    if (input.id) {
      const existing = await getDoc(doc(db, collectionName, input.id));
      if (existing.exists()) {
        createdAt = (existing.data() as T).createdAt;
      }
    }

    const record = { ...input, id, createdAt, updatedAt: now } as T;
    const batch = writeBatch(db);
    batch.set(doc(db, collectionName, id), record);
    writeAuditLog(batch, { actorMemberId, action: `${auditPrefix}.save`, target: `${collectionName}/${id}` });
    await batch.commit();
    return record;
  }

  /**
   * Deletes one doc and writes an audit_log entry describing the deletion, in a single atomic
   * batch. Propagates a write failure rather than swallowing it — a failed delete must never
   * look like a silently-dropped edit.
   */
  async function remove(id: string, actorMemberId: string): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(db, collectionName, id));
    writeAuditLog(batch, { actorMemberId, action: `${auditPrefix}.delete`, target: `${collectionName}/${id}` });
    await batch.commit();
  }

  return { list, save, remove };
}
