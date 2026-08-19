// src/services/TransactionHistoryService.ts — Stage 7 T3 (D21a/b/c/d).
//
// The scope-aware read of `transaction_lines` the forecast's statistical layer needs, and the
// completion marker that decides whether that layer may run at all.
//
// ── WHY THERE IS EXACTLY ONE `in` CLAUSE, AND WHY A TEST HAS TO PIN IT ───────────────────────
//
// Firestore caps DISJUNCTIONS AFTER DNF EXPANSION at 30 — not values per clause. A query carrying
// `owner in [N] × period in [7]` expands to `7N` disjuncts, so the obvious two-`in` shape raises
// `invalid-argument` at **N ≥ 5 members**. v2's D21(b) computed `6N` and pinned N ≥ 6; T0 caught
// it, because A5's seventh `in` value (`'unknown'`) moves the threshold by a whole member. Three
// members exist today and this stage's own acceptance dataset is twenty, so the failure is not
// hypothetical — and it is SERVER-ENFORCED, which means a green emulator run against three rows
// proves nothing about it. The מי filter is therefore applied CLIENT-SIDE over returned rows.
// T0 also measured that this costs nothing: narrowing to one member does not shrink the payload,
// because the ceiling is family size × window regardless of who is selected.
//
// ── WHY THE 'own' SCOPE CONSTRAINS `ownerId` AND NOT `owner` ─────────────────────────────────
//
// `owner` is a DISPLAY NAME. Querying on it means a rename silently denies a member their own
// history, and D26 then renders that as the reassuring "not enough history yet". D21(a) widened
// `firestore.rules`' `expensesAllowed` to accept either — strictly additive — and this is the half
// that uses the new one. `transaction-history.rules.test.ts` proves on a live emulator that the
// unconstrained scan is DENIED for an `'own'` viewer while this shape is ACCEPTED; the mocked
// tests here prove the shape is the one being built. Neither is sufficient alone.
//
// ── NO `limit()` ─────────────────────────────────────────────────────────────────────────────
//
// D33 forbids it. Silently truncating a window is exactly the lie the stage exists to avoid: a
// moving average over half the rows renders identically to one over all of them. Above the stated
// ceiling the screen degrades EXPLICITLY (T7a), it does not quietly return less.
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { UNKNOWN_PERIOD } from '../utils/periodMath';
import {
  MIGRATION_STATE_DOC,
  parseBackfillMarker,
  statisticalLayerGate,
  type TransactionPeriodBackfillMarker,
} from '../utils/backfillMarker';
import {
  refuseStatisticalHistory,
  sealStatisticalHistory,
  type StatisticalHistoryHandle,
} from '../utils/statisticalHistory';

export const TRANSACTION_LINES_COLLECTION = 'transaction_lines';

/** Firestore's cap on disjuncts after DNF expansion. Not a values-per-clause cap — that was A4's error. */
export const DNF_DISJUNCTION_LIMIT = 30;

/** Six lookback periods plus `'unknown'`. The seventh value is A5's, and it moves the threshold. */
export const HISTORY_PERIOD_VALUE_COUNT = 7;

/**
 * D33's stated degradation threshold, from T0's measurement of a 20-member year (3,000–4,800 rows).
 *
 * !! RE-EXPORTED, NOT RESTATED (T5). This was a second literal `2000` sitting beside the real one,
 * free to drift from it — the exact defect `HISTORY_ROW_CEILING`'s own doc comment names ("a
 * threshold the generator restates locally is a second 2000 free to drift"), committed one module
 * over from the sentence warning about it. `demoCorpusConditions.ts` already imported the real one;
 * this file did not. T7c moved the constant from `utils/forecast.ts` to `utils/statisticalLayer.ts`
 * with the row-ceiling degradation it belongs to; this line follows it rather than restating it,
 * which is the whole point of the re-export.
 */
export { HISTORY_ROW_CEILING } from '../utils/statisticalLayer';

/**
 * The first member count at which a hypothetical TWO-`in` query (`owner in [N]` × `period in [7]`)
 * would raise `invalid-argument`. Computed, never written down: writing "6" is the mistake this
 * exists to make impossible to repeat silently.
 */
export function firstFailingMemberCountForTwoInClauses(): number {
  let n = 1;
  while (n * HISTORY_PERIOD_VALUE_COUNT <= DNF_DISJUNCTION_LIMIT) n += 1;
  return n;
}

export interface HistoryClause {
  field: string;
  op: string;
  value: unknown;
}

export interface TransactionHistoryRow extends Record<string, unknown> {
  id: string;
}

/**
 * The clauses the history query is built from, as plain data — so a test can assert the SHAPE
 * (D21b's "one disjunctive clause") without a live Firestore, and so the shape is reviewable in
 * one place rather than inferred from a chain of `query(...)` arguments.
 *
 * `periods` is the lookback window, at most six entries; `'unknown'` is appended here so no caller
 * can forget it and quietly stop seeing the unparseable rows A5's whole mechanism exists to keep
 * visible.
 */
export function buildHistoryClauses(
  scope: 'own' | 'family',
  viewerMemberId: string,
  periods: string[]
): HistoryClause[] {
  const window = periods.filter((p) => p !== UNKNOWN_PERIOD);
  if (window.length === 0) {
    throw new Error(
      '[listTransactionHistory] refusing to query with an empty period window: an `in` clause with ' +
        'no values matches nothing and renders identically to "no history yet".'
    );
  }
  if (window.length > HISTORY_PERIOD_VALUE_COUNT - 1) {
    throw new Error(
      `[listTransactionHistory] refusing to query ${window.length} periods: the single \`in\` clause ` +
        `carries at most ${HISTORY_PERIOD_VALUE_COUNT - 1} periods plus '${UNKNOWN_PERIOD}'. ` +
        'Silently truncating the window would shorten the lookback without saying so.'
    );
  }
  if (scope === 'own' && !viewerMemberId) {
    throw new Error(
      "[listTransactionHistory] refusing an 'own' read with no viewer memberId — an unscoped query " +
        'is denied by Rules and, worse, would be a family-wide read if it were not.'
    );
  }

  const clauses: HistoryClause[] = [];
  if (scope === 'own') clauses.push({ field: 'ownerId', op: '==', value: viewerMemberId });
  clauses.push({ field: 'period', op: 'in', value: [...window, UNKNOWN_PERIOD] });
  return clauses;
}

/**
 * Every `transaction_lines` row in the window the caller's scope permits, WITH its document id.
 *
 * The id is carried deliberately: `createOwnedCollectionRepo.list` drops `d.id` (finding 1.2.8)
 * and D20's tiebreak had to pay for it. A history row's identity is what makes D36's drill-down
 * followable at all.
 *
 * Does NOT swallow a failed read into `[]` — a failed read renders an error, never an empty state.
 */
export async function listTransactionHistory(
  scope: 'own' | 'family',
  viewerMemberId: string,
  periods: string[]
): Promise<TransactionHistoryRow[]> {
  const clauses = buildHistoryClauses(scope, viewerMemberId, periods);
  const target = query(
    collection(db, TRANSACTION_LINES_COLLECTION),
    ...clauses.map((c) => where(c.field, c.op as '==' | 'in', c.value))
  );
  const snap = await getDocs(target);
  return snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
}

/** The T3 completion marker, or `null`. Does not swallow a failed read. */
export async function readTransactionBackfillMarker(): Promise<TransactionPeriodBackfillMarker | null> {
  const snap = await getDoc(doc(db, 'settings', MIGRATION_STATE_DOC));
  if (!snap.exists()) return null;
  return parseBackfillMarker(snap.data());
}

export interface StatisticalHistoryResult {
  status: 'ready' | 'refused-backfill-incomplete';
  rows: TransactionHistoryRow[];
  reasonHe: string;
  marker: TransactionPeriodBackfillMarker | null;
  /**
   * !! THE HANDLE THE STATISTICAL LAYER ACTUALLY TAKES — T5's structural half of D21(d).
   *
   * `buildStatisticalLayer` will not accept `rows`. It takes this, and the `'ready'` member is
   * branded with a symbol private to `statisticalHistory.ts`, so the ONE line below is the only
   * place in the codebase that can produce one. `rows` stays on this result for the callers that
   * legitimately want the raw list (D36's drill-down, `unusableRowCount`), but they are not the
   * ones computing an average.
   */
  history: StatisticalHistoryHandle;
}

/**
 * !! THE ONLY WAY THE STATISTICAL LAYER GETS HISTORY, and the refusal is STRUCTURAL.
 *
 * When the marker is absent or malformed this returns without issuing the history query AT ALL.
 * That is the difference between a refusal and a label: there is no partially-stamped result set
 * in memory for a caller to average by accident, and no branch where "we fetched it anyway, we
 * just said so" can be taken. D21(d) requires a refusal; a caveat under a wrong average is the
 * defect, not the fix.
 *
 * A FAILED MARKER READ IS AN ERROR AND PROPAGATES. A denied or broken `settings/migrationState`
 * read must not be indistinguishable from "the backfill has not run" — both suppress the layer,
 * but only one of them is a data problem somebody has to go and fix.
 */
export async function loadStatisticalHistory(
  scope: 'own' | 'family',
  viewerMemberId: string,
  periods: string[]
): Promise<StatisticalHistoryResult> {
  const marker = await readTransactionBackfillMarker();
  const gate = statisticalLayerGate(marker);
  if (gate.status === 'refused-backfill-incomplete') {
    return {
      status: 'refused-backfill-incomplete',
      rows: [],
      reasonHe: gate.reasonHe,
      marker: null,
      history: refuseStatisticalHistory(gate.reasonHe),
    };
  }
  const rows = await listTransactionHistory(scope, viewerMemberId, periods);
  // !! THE ONLY CALL SITE OF `sealStatisticalHistory` IN THE CODEBASE, and
  // `statisticalHistoryDoor.test.ts` asserts over the AST that it stays that way — that this call
  // is inside THIS function, that nothing else asserts to the branded type, and that no module
  // imports both `listTransactionHistory` and a statistical-layer export. Moving this line one
  // function up would put the seal on the far side of the marker check, which is the whole hole.
  return { status: 'ready', rows, reasonHe: '', marker, history: sealStatisticalHistory(marker, rows) };
}
