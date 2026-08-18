// src/utils/backfillMarker.ts — Stage 7 T3 (D21d).
//
// ── THE COMPLETION MARKER IS A HARD REFUSAL, NOT A CAVEAT ────────────────────────────────────
//
// A half-done backfill produces a moving average over an arbitrary fraction of the family's
// ledger, rendered at full confidence, and NOTHING DOWNSTREAM CAN SEE IT. That is not a risk
// assessment, it is a structural fact:
//
//   · `unusableRowCount` counts rows stamped `period: 'unknown'` — rows the backfill REACHED and
//     could not parse. It says nothing about rows it never reached.
//   · A row the backfill never reached has NO `period` FIELD AT ALL, and a
//     `where('period','in',[…])` query cannot return a document that lacks the field. So the
//     unstamped remainder is invisible to the very read that would average it.
//
// There is therefore no caveat that fixes a partial run. A caveat under a wrong average IS the
// defect this stage exists to remove — A3's "the glance position always holds a number" is about
// numbers we can stand behind, not about always having one. So the statistical layer REFUSES
// until the marker is set, and `loadStatisticalHistory` enforces that by not issuing the query at
// all rather than by labelling a result it already fetched.
//
// ── WHY THE MARKER IS PARSED RATHER THAN TRUSTED ─────────────────────────────────────────────
//
// `settings/{docId}` has no validator for any document but `aiCostConfig` (D24 records this), so
// anything a parent can write can land in `migrationState`. A truthy-check on the key would let
// `{ transactionPeriodBackfill: true }` — or a half-written record from an aborted run — open the
// gate. Every field is required and the counts must be numbers, because those four fields are the
// entire evidence that a run finished, and are what a human reads when the numbers look wrong.
//
// Pure: no Firebase, no clock, no I/O. `TransactionHistoryService` does the reading.

/** The `settings` document the marker lives in. T0 confirmed it does not exist on the corpus. */
export const MIGRATION_STATE_DOC = 'migrationState';

/** The one key T3 owns inside it. Other migrations may add siblings; none may share this key. */
export const TRANSACTION_PERIOD_BACKFILL_KEY = 'transactionPeriodBackfill';

/**
 * What a finished run records. `rowsUnknown` is A5's hole counted at the moment it was created;
 * `sourceCommit` is what lets a later reader tell WHICH version of `periodOf` stamped the corpus,
 * which matters precisely because the reason `periodOf` is not `date.slice(0, 7)` is that the
 * slice produced silently wrong periods nothing downstream could see.
 */
export interface TransactionPeriodBackfillMarker {
  completedAt: string;
  rowsStamped: number;
  rowsUnknown: number;
  sourceCommit: string;
}

/**
 * The gate's outcome. STRING discriminant — the root tsconfig is not strict, so a boolean
 * `allowed` narrows to `boolean` in `src/` and the refusal branch would get no compiler help.
 */
export interface StatisticalLayerGate {
  status: 'allowed' | 'refused-backfill-incomplete';
  reasonHe: string;
}

/**
 * The Hebrew the refusal renders. No second person (D34), and it states what is missing rather
 * than delivering a verdict — the reader is told what has not happened yet, not told off.
 */
export const BACKFILL_INCOMPLETE_REASON_HE =
  'החישוב הסטטיסטי ממתין להשלמת סימון החודשים על ההוצאות הקיימות. עד אז אין בסיס מלא לממוצע.';

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The marker held by `settings/migrationState`, or `null` when it is absent, incomplete or the
 * wrong shape. `null` is the only "not done" answer there is — deliberately no third "partially
 * done" state, because a partial run leaves behind no evidence that could populate one.
 */
export function parseBackfillMarker(
  migrationStateData: unknown
): TransactionPeriodBackfillMarker | null {
  if (typeof migrationStateData !== 'object' || migrationStateData === null) return null;
  const raw = (migrationStateData as Record<string, unknown>)[TRANSACTION_PERIOD_BACKFILL_KEY];
  if (typeof raw !== 'object' || raw === null) return null;

  const candidate = raw as Record<string, unknown>;
  if (!isNonEmptyString(candidate.completedAt)) return null;
  if (!isNonEmptyString(candidate.sourceCommit)) return null;
  // `rowsStamped: 0` is a REAL outcome — an empty collection is a legitimately finished backfill,
  // and rejecting zero would make the refusal permanent on a fresh install.
  if (!isFiniteNumber(candidate.rowsStamped)) return null;
  if (!isFiniteNumber(candidate.rowsUnknown)) return null;

  return {
    completedAt: candidate.completedAt as string,
    rowsStamped: candidate.rowsStamped as number,
    rowsUnknown: candidate.rowsUnknown as number,
    sourceCommit: candidate.sourceCommit as string,
  };
}

/**
 * Whether the statistical layer may compute at all. The ONLY input is whether a finished run was
 * recorded — deliberately not "how many rows came back", because a query over a half-stamped
 * corpus returns a plausible, non-empty and entirely wrong result set.
 */
export function statisticalLayerGate(
  marker: TransactionPeriodBackfillMarker | null | undefined
): StatisticalLayerGate {
  if (!marker) {
    return { status: 'refused-backfill-incomplete', reasonHe: BACKFILL_INCOMPLETE_REASON_HE };
  }
  return { status: 'allowed', reasonHe: '' };
}
