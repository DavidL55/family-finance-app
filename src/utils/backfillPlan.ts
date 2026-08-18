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

  for (const doc of transactionLines) {
    const period = periodOrUnknown(doc.data.date as string | undefined);
    const ownerName = doc.data.owner as string | undefined;
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
    const period = periodOrUnknownFromMonthYear(
      doc.data.month as string | number | undefined,
      doc.data.year as string | number | undefined
    );
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
