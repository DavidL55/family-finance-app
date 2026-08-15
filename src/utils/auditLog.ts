// Immutable audit trail for every write that goes through GroupsService/PermissionsService
// (D2/D9 area of the Stage 2 plan). Every mutation of `groups` or `permissions` must be
// traceable to who did it, what they did, and when — this is the single place that shape
// is defined and written from.

import { doc, type WriteBatch } from 'firebase/firestore';
import { db } from '../services/firebase';

export interface AuditEntry {
  actorMemberId: string;
  action: string; // e.g. 'permissions.update', 'group.save', 'group.delete'
  target: string; // e.g. 'permissions/member__omer-levy'
  at: string; // ISO timestamp
  details?: Record<string, unknown>;
}

const AUDIT_LOG_COLLECTION = 'audit_log';

let auditIdCounter = 0;

/**
 * Adds an immutable audit_log entry to an already-open batch. Does NOT commit — the caller's
 * batch (which also contains the triggering write) commits both atomically, so an audit entry
 * can never exist without the write it describes, or vice versa.
 */
export function writeAuditLog(batch: WriteBatch, entry: Omit<AuditEntry, 'at'>): void {
  auditIdCounter += 1;
  const id = `${Date.now()}-${auditIdCounter}`;
  const fullEntry: AuditEntry = { ...entry, at: new Date().toISOString() };
  batch.set(doc(db, AUDIT_LOG_COLLECTION, id), fullEntry);
}
