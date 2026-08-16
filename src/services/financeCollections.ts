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
//
// ── save()'s undefined/null contract (ship-blocker fix, post-Stage-5) ─────────────────────────
// `save()` used to do a bare `tx.set(ref, record)` of whatever `input` it was given — a full
// overwrite. That left every screen with two ways to express "this optional field has no value",
// and both were broken: setting a key to `undefined` made the Firestore JS SDK reject the WHOLE
// write (`ignoreUndefinedProperties` is not set in `src/services/firebase.ts`, deliberately —
// see below), and omitting a key silently dropped whatever was already stored there on every
// edit (e.g. InsurancesScreen's form never carrying `documentId` would have wiped it on save).
//
// One contract now, enforced HERE so no screen author can get it wrong differently per module:
//   - `undefined` on an optional field means "not managed by this form; leave unchanged." Such
//     keys are stripped before writing and never appear in the merged record — whatever the
//     stored doc already had for that key survives untouched.
//   - `null` on an optional field means "explicitly clear this field." It is omitted from the
//     merged record before the write, which — because the write below is a FULL `tx.set()`
//     overwrite of the merged record, not a partial update — deletes it from the stored doc just
//     as surely as Firestore's `deleteField()` sentinel would inside a partial `tx.update()`,
//     with one fewer moving part (no branching between `tx.set()` for create and `tx.update()`
//     for edit — every save is still exactly one `tx.set()`, per D10 above).
//   - Every OTHER value overwrites the stored field, same as before.
// `OwnedRecordInput<T>` encodes this at the type level: an optional property of `T` (one whose
// own type already includes `undefined`) additionally accepts `null` in the input; a required
// property does not — a screen can never "leave unchanged" or "clear" a field the record schema
// says must always have a value.
// To make this hold, `save()` fetches the existing stored doc (already required, to preserve
// `createdAt`) and merges the input over it: keys not present in `input` (or explicitly
// `undefined`) keep the existing stored value; `null` keys are deleted; everything else is set.
// This also means any field present in the stored doc but NOT declared on `T` (legacy data, a
// field an older screen version wrote) survives an edit made through a newer screen that doesn't
// know about it — the merge is over the RAW stored document, not over a `T`-shaped subset of it.
// `ignoreUndefinedProperties` is intentionally still NOT set on `db` (`src/services/firebase.ts`)
// — that global escape hatch would silently swallow `undefined` in fields OUTSIDE this factory's
// reach too (nested objects/arrays a screen builds by hand, e.g. Coverage rows), which is exactly
// the kind of silent behavior this fix is replacing with an explicit, documented contract.

import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLog } from '../utils/auditLog';

export interface OwnedRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// Homomorphic over its own `T` (see the mapped-type form `{[K in keyof T]: ...}` below) — this is
// what makes it preserve each property's optional/required modifier from whatever concrete type
// it's instantiated with (here, `Omit<OriginalT, 'id' | 'createdAt' | 'updatedAt'>`), the same way
// `Partial<T>`/`Readonly<T>` do. A property that's REQUIRED on the record type stays required and
// non-nullable here — a screen must always provide it, with no "leave unchanged"/"clear" escape
// hatch. A property that's OPTIONAL on the record type (its own type already includes
// `undefined`) additionally accepts `null` here — see the save()-contract comment in this file's
// header: `undefined` = "not managed by this form, leave the stored value unchanged"; `null` =
// "explicitly clear this field"; any other value overwrites it. A screen author adding a new
// optional field must decide, per form, whether that form ever lets the user clear it — if so, it
// must send `null` when the user does, never `undefined` (which would silently do nothing).
type OptionalToNullable<T> = { [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K] };

export type OwnedRecordInput<T extends OwnedRecord> = OptionalToNullable<Omit<T, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: string;
};

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
   *
   * The SAME fetch also backs the undefined/null contract (see this file's header): the existing
   * RAW stored document (not narrowed to `T`) is the merge base, `input`'s `undefined` keys are
   * stripped (leaving the stored value in place), and `input`'s `null` keys are omitted from the
   * merged record before the write — deleting them, since the write is a full-document overwrite.
   * A brand-new doc has no existing data to merge over, so the merge base is just `{}`; a `null`
   * on a field that never existed is already a no-op either way.
   */
  async function save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T> {
    const now = new Date().toISOString();
    const id = input.id ?? doc(collection(db, collectionName)).id;
    const ref = doc(db, collectionName, id);

    return runTransaction(db, async (tx) => {
      let createdAt = now;
      let existingData: Record<string, unknown> | null = null;
      if (input.id) {
        const existing = await tx.get(ref);
        if (existing.exists()) {
          existingData = existing.data() as Record<string, unknown>;
          createdAt = existingData.createdAt as string;
        }
      }

      const { id: _inputId, ...rest } = input as OwnedRecordInput<T> & Record<string, unknown>;
      const merged: Record<string, unknown> = { ...existingData };
      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue; // not managed by this form — leave unchanged
        if (value === null) {
          delete merged[key]; // explicit clear — omitted from the full-overwrite below
          continue;
        }
        merged[key] = value;
      }
      merged.id = id;
      merged.createdAt = createdAt;
      merged.updatedAt = now;

      const record = merged as T;
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
