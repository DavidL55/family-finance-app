// CRUD (via the shared factory, Task 2) plus the bespoke catch-up-posting engine (spec §11 —
// "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן"). LOCAL-first, no Cloud Functions (spec §15) —
// postDueRecurringTransactions is called once per app session (App.tsx, Task 9) and posts every
// period every active recurring item missed since it was last posted, using computeDuePeriods
// (Task 4, pure) to decide what's due.
//
// Idempotency: each posted transaction_lines/incomes doc uses a DETERMINISTIC id
// (`${recurringId}__${period}`), not an auto-id. Combined with lastPostedPeriod advancing in the
// SAME batch, a period is posted at most once under normal operation — the deterministic id is
// defense-in-depth for the case of two concurrent sessions (e.g. two open tabs) racing the same
// catch-up before either commits: the second, redundant write overwrites identical data rather
// than creating a duplicate financial row.
//
// Owner-attribution bridge (Design decision D1): recurring.ownerId is a Member.id, matching every
// other Stage 3 collection. transaction_lines.owner, however, remains the pre-existing Stage 2
// convention — a Hebrew DISPLAY NAME. Posting an expense-kind item therefore resolves
// ownerId -> current display name via a fresh listMembers() call at posting time (never a
// denormalized/cached name, which could go stale on a rename). If the member no longer exists
// (deleted, or bad data), that item's posting is a FAILURE, not a silent skip or a post with an
// empty/placeholder owner: an expense with no attributable owner would corrupt Dashboard's
// per-owner settlement math (and every other transaction_lines.owner consumer) worse than simply
// not posting it. It surfaces in this function's `failed` list and is retried automatically on
// the next catch-up run once the ownerId resolves (or the item is fixed/reassigned).
//
// Posted-doc shape (consumed by the existing report screens, see src/utils/transactionFilters.ts
// and Dashboard/CentralExpenseReport): expense-kind rows get isCredit: false (so
// transactionFilters.isExpenseRow counts them), category defaulted the same way Dashboard already
// defaults a missing one ('שונות'), and expenseClassification: 'Fixed' — a recurring item IS, by
// definition, a fixed recurring charge, and CentralExpenseReport already defaults a missing
// expenseClassification to 'Unclassified' (see CentralExpenseReport.tsx), which would misbucket
// every auto-posted recurring expense. Setting it explicitly here is the correct classification,
// not a guess.
//
// Permission interaction (see Risks in the Stage 3 plan): posting a recurring EXPENSE only needs
// the actor's own edit access on 'expenses' + 'recurring'. Posting a recurring INCOME
// additionally needs FAMILY-level edit on 'income' specifically — 'income' remains one of the
// Stage 2 OWNERLESS_MODULES (D5), where 'own' is structurally denied — so a 'member'-role user
// with only 'own' access to income can define their own recurring income item, but their own
// session can never successfully post it; it posts once a parent/super-admin session (which
// bypasses the matrix) next opens the app. Intentional and documented, not silently swallowed — a
// denied posting attempt surfaces in this function's `failed` list.
//
// D7 dependency: the audit_log write below rides in the SAME batch as the posted doc + the
// lastPostedPeriod bump. Under Stage 2's original audit_log create rule
// (role in ['super-admin','parent']), a 'member'-role session's own catch-up batch would be
// denied entirely by Firestore Rules (Firestore batches are all-or-nothing) — D7 broadens that
// rule to include 'member' specifically so this path works for every role. This module's own
// unit tests mock Firestore, so they pass regardless; live member-role session posting is blocked
// until Task 7 lands the Rules change. Super-admin/parent sessions are unaffected either way.

import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { createOwnedCollectionRepo } from './financeCollections';
import { listMembers } from './MembersService';
import { writeAuditLog } from '../utils/auditLog';
import { computeDuePeriods } from '../utils/recurringCatchup';
import type { RecurringItem } from '../types/finance';

const RECURRING_COLLECTION = 'recurring';

const repo = createOwnedCollectionRepo<RecurringItem>(RECURRING_COLLECTION, 'recurring');
export const listRecurring = repo.list;
export const saveRecurring = repo.save;
export const deleteRecurring = repo.remove;

export interface PostingOutcome {
  posted: { recurringId: string; period: string }[];
  failed: { recurringId: string; error: string }[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Catch-up-posts every due period for every recurring item the signed-in actor's session can
 * currently read (per Firestore Rules — this issues normal client writes, no special privilege of
 * its own; whatever `listRecurring()` returns for this session — own items for a 'member' role,
 * every item for a 'parent'/'super-admin' role, per the ownedModuleAllowed() matrix, Task 7 — is
 * exactly what gets considered). One item's failure does NOT stop the rest from being attempted
 * (matches the `recomputeAllResolvedPermissions`/`recomputeMemberIds` convention elsewhere in
 * this codebase). Never throws; the caller inspects `failed` to decide whether/how to surface it.
 *
 * Batch/atomicity: one WriteBatch PER ITEM, covering every period that item has due (posted doc +
 * lastPostedPeriod bump + one audit_log entry per period, all in that single batch). A batch
 * either fully lands — every due doc posted, lastPostedPeriod advanced to the last due period,
 * every period audited — or nothing for that item does: Firestore's WriteBatch.commit() is
 * all-or-nothing, so there is no state where a doc posted but lastPostedPeriod didn't advance
 * (which would double-post that period next run, silently duplicating a financial transaction) or
 * the reverse (lastPostedPeriod advanced past a period whose doc never landed, silently losing
 * it). A synchronous failure while building one item's batch (e.g. an unresolvable owner) or an
 * async failure committing it aborts ONLY that item's batch — nothing in it was ever sent — and
 * processing continues with the next item; that item's `failed` entry means its periods remain
 * exactly as undone as before this run, so the next catch-up retries them from scratch (the
 * deterministic per-period doc id makes that retry idempotent even if some future logic error
 * ever posted a doc without advancing lastPostedPeriod).
 */
export async function postDueRecurringTransactions(
  actorMemberId: string,
  today: Date = new Date()
): Promise<PostingOutcome> {
  const posted: PostingOutcome['posted'] = [];
  const failed: PostingOutcome['failed'] = [];

  let items: RecurringItem[];
  let nameByMemberId: Map<string, string>;
  try {
    const [itemList, members] = await Promise.all([listRecurring(), listMembers()]);
    items = itemList;
    nameByMemberId = new Map(members.map((m) => [m.id, m.name]));
  } catch (err) {
    failed.push({ recurringId: '(all)', error: errorMessage(err) });
    return { posted, failed };
  }

  for (const item of items) {
    try {
      const duePeriods = computeDuePeriods(item, today);
      if (duePeriods.length === 0) continue;

      const batch = writeBatch(db);
      for (const period of duePeriods) {
        const postId = `${item.id}__${period}`;
        const [year, month] = period.split('-');
        const dateStr = `${year}-${month}-${String(item.chargeDay).padStart(2, '0')}`;

        if (item.kind === 'expense') {
          const ownerName = nameByMemberId.get(item.ownerId);
          if (!ownerName) {
            throw new Error(`owner ${item.ownerId} not found in members — cannot resolve transaction_lines.owner`);
          }
          batch.set(doc(db, 'transaction_lines', postId), {
            owner: ownerName,
            amount: item.amount,
            date: dateStr,
            category: item.category ?? 'שונות',
            description: item.description,
            isCredit: false,
            expenseClassification: 'Fixed',
            recurringId: item.id,
            recurringPeriod: period,
          });
        } else {
          batch.set(doc(db, 'incomes', postId), {
            name: item.description,
            amount: item.amount,
            date: dateStr,
            month,
            year,
            recurringId: item.id,
            recurringPeriod: period,
          });
        }

        writeAuditLog(batch, {
          actorMemberId,
          action: 'recurring.autopost',
          target: `${RECURRING_COLLECTION}/${item.id}`,
          details: { period, kind: item.kind, amount: item.amount },
        });
      }

      const lastPeriod = duePeriods[duePeriods.length - 1];
      batch.set(
        doc(db, RECURRING_COLLECTION, item.id),
        { lastPostedPeriod: lastPeriod, updatedAt: new Date().toISOString() },
        { merge: true }
      );

      await batch.commit();
      duePeriods.forEach((period) => posted.push({ recurringId: item.id, period }));
    } catch (err) {
      failed.push({ recurringId: item.id, error: errorMessage(err) });
    }
  }

  return { posted, failed };
}
