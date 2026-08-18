// src/utils/backfillPlan.ts — Stage 7 T3.
//
// EVERY DECISION THE BACKFILL MAKES ABOUT THE FAMILY'S ONLY LEDGER, WITH NO I/O IN SIGHT.
//
// `scripts/backfill-transaction-periods.ts` is the only task in this stage that writes to that
// ledger, and a script is the one place in this repo the test suites cannot reach: the root suite
// mocks Firestore, the rules suite runs Rules, and neither executes a `tsx` entrypoint. So the
// script keeps the parts that are genuinely I/O — read the collections, back them up, verify the
// backup, commit batches of 400, write the marker last — and every decision that could silently
// corrupt a row lives here instead, where it is ordinary tested code:
//
//   · which period a row lands in, and when that is `'unknown'`;
//   · whose row it is, and when that is `'unknown'`;
//   · WHETHER TO WRITE AT ALL — the idempotency comparison, which is what makes a second
//     `--apply` a no-op rather than a second pass of identical writes;
//   · which `audit_log` rows carry a Timestamp `at` and must become an ISO string;
//   · the counts, including the two the task is required to report separately.
//
// The `at` handling is deliberately structural rather than `instanceof Timestamp`: this module is
// imported by the app bundle as well as by the Admin-SDK script, and `firebase-admin` must never
// be reachable from `src/` (`forecastPurity.test.ts` bans it by name for the forecast closure, and
// the root bundle guard would notice). A Firestore Timestamp is recognised by its shape —
// `toDate()` — which is the same duck the client and admin SDKs both present.

import { periodOrUnknown, periodOrUnknownFromMonthYear, UNKNOWN_PERIOD } from './periodMath';
import { resolveOwnerId, UNKNOWN_OWNER_ID, type NamedMember } from './resolveOwnerId';

export interface RawDoc {
  id: string;
  data: Record<string, unknown>;
}

/**
 * A field the backfill could not read because it was the WRONG TYPE, with the document that
 * carries it (T3 review F1). Absence is not malformed — a row with no `date` has always been
 * `'unknown'` by design; a row whose `date` is the number 12345 is a row somebody wrote through a
 * hole in the rules, and the operator needs the id to go and look at it.
 */
export interface MalformedField {
  id: string;
  field: string;
  typeName: string;
}

export interface PlannedPatch {
  collection: 'transaction_lines' | 'incomes' | 'audit_log';
  id: string;
  patch: Record<string, unknown>;
  why: string;
}

export interface BackfillPlan {
  patches: PlannedPatch[];
  /** Every `transaction_lines` row, whether or not it needed a write — what the marker records. */
  transactionRows: number;
  transactionAlreadyCorrect: number;
  /** A5's hole, counted at the moment it is created. */
  rowsUnknownPeriod: number;
  /** A6's orphan set. REPORTED SEPARATELY, because an unreadable date and a renamed member are different problems. */
  rowsUnknownOwner: number;
  unknownPeriodRows: Array<{ id: string; date: unknown }>;
  /** Fields refused for their TYPE, by document id. Reported, never coerced (T3 review F1). */
  malformedFields: MalformedField[];
  unknownOwnerNames: Array<{ owner: string; count: number }>;
  incomeRows: number;
  incomeAlreadyCorrect: number;
  incomesUnknownPeriod: number;
  auditConverted: number;
  auditAlreadyIso: number;
  /** Neither a string nor a Timestamp — reported, never guessed at. */
  auditUnreadable: string[];
  /** The number the named threshold is compared against. */
  totalUnknown: number;
}

/** A Firestore Timestamp from either SDK, recognised by shape so neither SDK has to be imported. */
function asTimestampLike(value: unknown): { toDate(): Date } | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { toDate?: unknown };
  return typeof candidate.toDate === 'function' ? (value as { toDate(): Date }) : null;
}

/**
 * What the run would do, given what it read. Pure: same inputs, same plan, no clock, no Firestore.
 *
 * IDEMPOTENCY IS A VALUE COMPARISON, NOT A PRESENCE CHECK. A row already carrying exactly what
 * this run would write is skipped, so a second `--apply` commits nothing — but a row stamped by an
 * OLDER, WRONG `periodOf` (the `date.slice(0,7)` version, which turned `"9/3/2026"` into
 * `"9/3/202"`) has a `period` and still gets corrected. `if ('period' in data) continue` would
 * have entrenched exactly the values this stage exists to stop producing.
 */
export function planBackfill(
  transactionLines: RawDoc[],
  incomes: RawDoc[],
  auditLog: RawDoc[],
  members: ReadonlyArray<NamedMember>
): BackfillPlan {
  const patches: PlannedPatch[] = [];

  let transactionAlreadyCorrect = 0;
  let rowsUnknownPeriod = 0;
  let rowsUnknownOwner = 0;
  const unknownPeriodRows: Array<{ id: string; date: unknown }> = [];
  const unknownOwnerCounts = new Map<string, number>();
  const malformedFields: MalformedField[] = [];

  for (const doc of transactionLines) {
    // T3 review F1 — READ THE TYPE BEFORE READING THE VALUE. These two lines used to be
    // `doc.data.date as string` and `doc.data.owner as string`, and the very next calls were
    // `.includes` and `.trim`: a row whose `date` is a number, a Timestamp, a boolean or an object
    // threw `TypeError: dateStr.includes is not a function` WITH NO DOCUMENT ID, on the family's
    // only ledger, before the backup and before any write. It failed closed, so nothing corrupted
    // — but it contradicted this script's own contract ("a row whose `date` cannot be read gets
    // `'unknown'`") and left the operator with nothing to go and look at.
    if (doc.data.date !== undefined && readableString(doc.data.date) === undefined) {
      malformedFields.push({ id: doc.id, field: 'date', typeName: typeNameOf(doc.data.date) });
    }
    if (doc.data.owner !== undefined && readableString(doc.data.owner) === undefined) {
      malformedFields.push({ id: doc.id, field: 'owner', typeName: typeNameOf(doc.data.owner) });
    }
    const period = periodOrUnknown(readableString(doc.data.date));
    const ownerName = readableString(doc.data.owner);
    const ownerId = resolveOwnerId(ownerName, members) ?? UNKNOWN_OWNER_ID;

    if (period === UNKNOWN_PERIOD) {
      rowsUnknownPeriod += 1;
      unknownPeriodRows.push({ id: doc.id, date: doc.data.date });
    }
    if (ownerId === UNKNOWN_OWNER_ID) {
      rowsUnknownOwner += 1;
      const key = ownerName === undefined || ownerName === null ? '(absent)' : String(ownerName);
      unknownOwnerCounts.set(key, (unknownOwnerCounts.get(key) ?? 0) + 1);
    }

    if (doc.data.period === period && doc.data.ownerId === ownerId) {
      transactionAlreadyCorrect += 1;
      continue;
    }
    patches.push({
      collection: 'transaction_lines',
      id: doc.id,
      patch: { period, ownerId },
      why: `transaction_lines/${doc.id}: period=${period} ownerId=${ownerId}`,
    });
  }

  // D23(b) — `incomes` period from `month`/`year`, NEVER from `date`. `Dashboard.handleSaveIncomes`
  // writes month/year from the UI's SELECTED FILTER while `date` is free text, and
  // `CentralExpenseReport` already queries on that pair; re-deriving from `date` would move rows
  // out from under a live query. T0 measured the divergence at 0 OF 0 — the collection is empty and
  // does not exist — so on the real corpus this branch is a no-op and its evidence is synthetic.
  let incomeAlreadyCorrect = 0;
  let incomesUnknownPeriod = 0;
  for (const doc of incomes) {
    // `periodOfMonthYear` is itself total on a non-(string|number) since T3 review F9, so this
    // pass needs no cast at all — the raw values go in and `'unknown'` comes out.
    const period = periodOrUnknownFromMonthYear(doc.data.month, doc.data.year);
    if (period === UNKNOWN_PERIOD) incomesUnknownPeriod += 1;
    if (doc.data.period === period) {
      incomeAlreadyCorrect += 1;
      continue;
    }
    patches.push({
      collection: 'incomes',
      id: doc.id,
      patch: { period },
      why: `incomes/${doc.id}: period=${period}`,
    });
  }

  // The two-row `audit_log.at` fix, inherited from the T2 review. `at` held TWO TYPES: a string
  // from every client writer and a Timestamp from `costGate.ts`/`setAiCostCeiling.ts`. T2 fixed the
  // writers; the rows already written are still Timestamps, and `new Date(entry.at)` is
  // `Invalid Date` for them — on the collection whose entire job is being readable afterwards.
  let auditConverted = 0;
  let auditAlreadyIso = 0;
  const auditUnreadable: string[] = [];
  for (const doc of auditLog) {
    const at = doc.data.at;
    if (typeof at === 'string') {
      auditAlreadyIso += 1;
      continue;
    }
    const timestamp = asTimestampLike(at);
    if (timestamp !== null) {
      auditConverted += 1;
      patches.push({
        collection: 'audit_log',
        id: doc.id,
        patch: { at: timestamp.toDate().toISOString() },
        why: `audit_log/${doc.id}: at Timestamp -> ISO string`,
      });
      continue;
    }
    // Reported, never guessed. Inventing a date on an audit entry is worse than leaving one
    // unreadable, because it would look correct.
    auditUnreadable.push(doc.id);
  }

  return {
    patches,
    transactionRows: transactionLines.length,
    transactionAlreadyCorrect,
    rowsUnknownPeriod,
    rowsUnknownOwner,
    unknownPeriodRows,
    malformedFields,
    unknownOwnerNames: [...unknownOwnerCounts].map(([owner, count]) => ({ owner, count })),
    incomeRows: incomes.length,
    incomeAlreadyCorrect,
    incomesUnknownPeriod,
    auditConverted,
    auditAlreadyIso,
    auditUnreadable,
    totalUnknown: rowsUnknownPeriod + rowsUnknownOwner + incomesUnknownPeriod,
  };
}

/**
 * THE NAMED THRESHOLD. Zero, because T0 measured the real corpus at 3/3 dates parsed and 3/3
 * owners resolved: on this ledger any unknown is a regression rather than a fact of life. Raised
 * deliberately with `--max-unknown=N` for a corpus where unparseable rows are expected — T4's
 * generator emits them on purpose — which keeps the default honest instead of pre-weakened.
 */
export const DEFAULT_MAX_UNKNOWN = 0;

/**
 * Whether the run may proceed. Checked BEFORE the dry-run/apply branch, so the number is learned
 * without writing anything. String discriminant: the root tsconfig is not strict.
 */
export function backfillThresholdCheck(
  plan: BackfillPlan,
  maxUnknown: number
): { status: 'ok' | 'refused'; message: string } {
  if (plan.totalUnknown > maxUnknown) {
    return {
      status: 'refused',
      message:
        `REFUSING: ${plan.totalUnknown} row(s) would be stamped '${UNKNOWN_PERIOD}'/'${UNKNOWN_OWNER_ID}', ` +
        `above the threshold of ${maxUnknown}. T0 measured this corpus at 3/3 dates parsed and 3/3 ` +
        `owners resolved, so on this ledger any unknown is a regression, not a fact of life. ` +
        `Re-run with --max-unknown=${plan.totalUnknown} to accept them deliberately.`,
    };
  }
  return { status: 'ok', message: '' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE BATCH SIZE (T3 review F8) — A DECISION, NOT A LITERAL IN A FILE NO SUITE EXECUTES
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `BATCH_SIZE = 400` used to live as a `const` inside `scripts/backfill-transaction-periods.ts`,
// which is the one file in this repo no suite runs. It was held by NOTHING: set to 600, the run
// SUCCEEDS locally and in CI, because the Firestore emulator does not enforce the 500-operation
// batch limit. The first real-Firestore run then aborts partway — after the backup, after some
// batches have committed, before the marker — which is fail-closed but is also the exact
// half-done state D21(d)'s marker exists to make visible rather than to produce.
//
// So it lives here, beside every other decision the script defers to this module, and
// `chunkPatches` REFUSES a size above the hard limit instead of building a batch that cannot
// commit. Green-locally-red-in-production becomes red-here.

/** Firestore's hard per-batch operation limit. Not ours to choose — hence a separate constant. */
export const FIRESTORE_BATCH_LIMIT = 500;

/** Ours, with headroom under the limit. `migrate-transactions.ts:38` set the precedent. */
export const BACKFILL_BATCH_SIZE = 400;

/**
 * `patches` split into commit-sized runs, in order, losing and duplicating nothing.
 *
 * THROWS on a size the limit forbids, rather than returning chunks a commit would reject. A
 * migration that cannot commit its batches should refuse before it writes its first one, not
 * discover it on the third.
 */
export function chunkPatches(patches: PlannedPatch[], size: number): PlannedPatch[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Batch size must be a positive integer; got ${size}.`);
  }
  if (size > FIRESTORE_BATCH_LIMIT) {
    throw new Error(
      `Batch size ${size} exceeds Firestore's hard limit of ${FIRESTORE_BATCH_LIMIT} operations ` +
        `per batch. The emulator does not enforce this, so a run at this size passes locally and ` +
        `aborts partway through on the first real-Firestore run.`
    );
  }
  const chunks: PlannedPatch[][] = [];
  for (let i = 0; i < patches.length; i += size) chunks.push(patches.slice(i, i + size));
  return chunks;
}

/**
 * A Firestore field value read as a string, or `undefined` when it is not one (T3 review F1).
 *
 * THE ONE PLACE THIS MODULE DECIDES WHAT "UNREADABLE" MEANS. Everything here reads untrusted
 * document data through a non-strict tsconfig, so `doc.data.date as string` compiles and a NUMBER
 * arrives at runtime — and `firestore.rules` does not stop it (a parent's `update` bypasses the
 * `date is string` re-validation; `owner` had no type check on create at all, both proven live).
 *
 * Deliberately NOT `String(value)`: coercing `12345` into `'12345'` would turn an unreadable field
 * into a plausible-looking one, which is the silent-wrongness class this whole stage exists to
 * remove. An empty string is passed through unchanged — empty is a value, and the readers below
 * already decide what it means.
 */
export function readableString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** What `readableString` refused, named the way an operator reading the log needs it named. */
function typeNameOf(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}
