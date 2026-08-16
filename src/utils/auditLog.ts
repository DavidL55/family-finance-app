// Immutable audit trail for every write that goes through GroupsService/PermissionsService
// (D2/D9 area of the Stage 2 plan), and — since Stage 3/5 — the owned-collection factory in
// financeCollections.ts. Every mutation of `groups`/`permissions`/an owned collection must be
// traceable to who did it, what they did, and when — this is the single place that shape is
// defined and written from.

import { collection, doc, type DocumentData, type DocumentReference } from 'firebase/firestore';
import { db } from '../services/firebase';

export interface AuditEntry {
  actorMemberId: string;
  action: string; // e.g. 'permissions.update', 'group.save', 'group.delete'
  target: string; // e.g. 'permissions/member__omer-levy'
  at: string; // ISO timestamp
  details?: Record<string, unknown>;
}

const AUDIT_LOG_COLLECTION = 'audit_log';

/**
 * Structural, not `WriteBatch`-specific — both `WriteBatch` and `Transaction` expose a
 * compatible `set(ref, data)`, so this one function backs both the existing batch-based callers
 * (GroupsService/PermissionsService/RecurringService's posting loop, unchanged) and
 * financeCollections.ts's transaction-based save/remove (D10), without a second near-duplicate
 * export.
 */
export interface AuditWriter {
  set(ref: DocumentReference, data: DocumentData): unknown;
}

/**
 * Adds an immutable audit_log entry via the caller's writer (a WriteBatch OR, since D10, a
 * Transaction — both structurally satisfy AuditWriter). Does NOT commit — the caller's own
 * batch/transaction (which also contains the triggering write) commits both atomically, so an
 * audit entry can never exist without the write it describes, or vice versa.
 *
 * D10: the id is crypto.randomUUID(), not a page-load counter (`${Date.now()}-${counter}`) — the
 * counter reset to 0 on every reload, so two devices' first saves in the same millisecond used to
 * collide and batch.set silently overwrote one audit entry with the other. Harmless until Stage 5
 * put two parents in front of the same record concurrently; fixed here.
 */
export function writeAuditLog(writer: AuditWriter, entry: Omit<AuditEntry, 'at'>): void {
  const id = crypto.randomUUID();
  const fullEntry: AuditEntry = { ...entry, at: new Date().toISOString() };
  writer.set(doc(collection(db, AUDIT_LOG_COLLECTION), id), fullEntry);
}
