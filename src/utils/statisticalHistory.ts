// src/utils/statisticalHistory.ts — Stage 7 T5. THE DOOR.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS MODULE EXISTS AT ALL
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T3 shipped two reads of `transaction_lines`: `listTransactionHistory`, which issues the query,
// and `loadStatisticalHistory`, which reads D21(d)'s completion marker FIRST and does not issue
// the query at all when the marker is absent. The refusal lives in the second one only.
//
// The T3 ledger recorded the hole in one sentence and addressed it to this task: *"history must be
// taken through `loadStatisticalHistory`, not `listTransactionHistory` — the refusal lives in the
// former, and NOTHING STRUCTURALLY FORCES THAT CHOICE YET."* It was a convention. A convention is
// what R6 needs in order to happen: a half-done backfill returns a plausible, non-empty, entirely
// wrong result set, and a moving average over a fraction of the corpus renders IDENTICALLY to one
// over all of it — same shape, same confidence, different number. Nothing downstream can see it.
//
// So the statistical layer does not take rows. It takes a `GatedStatisticalHistory`, and there is
// exactly one function in the codebase that can produce one.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE THREE MECHANISMS, AND WHY NO ONE OF THEM IS ENOUGH ALONE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   1. COMPILE TIME — the brand. `GATED_HISTORY_BRAND` is a module-private `unique symbol`: it is
//      declared here and never exported, so no other module can write that key. `buildStatistical
//      Layer(rowsFromListTransactionHistory)` is a TYPE ERROR, not a code review finding. This is
//      the mechanism that catches the accident — someone reaching for the read that is one import
//      shorter — which is how this defect actually arrives.
//
//      It does NOT catch a deliberate `as GatedStatisticalHistory`, because the two shapes overlap
//      enough for an assertion to be legal. Hence (3).
//
//   2. RUN TIME — `sealStatisticalHistory` THROWS unless `statisticalLayerGate` allows. Minting
//      gated history requires a marker that `parseBackfillMarker` accepted, which requires
//      `settings/migrationState` to hold a complete record. A caller who routes around the type
//      still has to produce seven marker fields, and the one that matters cannot be faked into
//      existence by an empty object.
//
//      It does NOT run at build time, so on its own it is a runtime crash on a screen rather than
//      a red test. Hence (3).
//
//   3. STRUCTURE — `statisticalHistoryDoor.test.ts` asserts over the AST that `sealStatisticalHistory`
//      has exactly ONE non-test call site, that it is inside `loadStatisticalHistory`, that no
//      module outside the allow-list asserts to the branded type, and that NO MODULE IMPORTS BOTH
//      `listTransactionHistory` AND a statistical-layer export. That last one is the actual defect
//      stated as a property: the wrong door and the room it opens onto, in one file.
//
// This module is PURE — no I/O, no clock, no Firebase. It sits inside `forecast.ts`'s import
// closure and `forecastPurity.test.ts` walks it.
import { statisticalLayerGate, type TransactionPeriodBackfillMarker } from './backfillMarker';

/**
 * The brand.
 *
 * A REAL `Symbol`, not a `declare const` ambient one, and the difference is the point. An ambient
 * brand exists only in the type system, so the seal below would need an `as` cast to construct one
 * — the very escape hatch this module is trying to close — and a forged object would be
 * indistinguishable at runtime. A real module-private symbol is BOTH: no other module can name the
 * key (so it cannot write the literal, and the compiler says so), and `isGatedStatisticalHistory`
 * can check for it at runtime (so an `as` cast is caught too, one layer down).
 *
 * NOT EXPORTED. That is the whole mechanism.
 */
const GATED_HISTORY_BRAND: unique symbol = Symbol('statisticalHistory.gated');

/**
 * A `transaction_lines` row as the statistical layer reads one.
 *
 * EVERY VALUE FIELD IS `unknown`, deliberately, and for the reason `readObservedAmount` and
 * `periodOfMonthYear` already state: these come off schemaless documents through a NON-STRICT
 * tsconfig, so `category: string` is a claim the compiler cannot keep. F-1 proved the point live —
 * a parent can strip `date`, `owner` and `amount` off a row entirely, and can write `date` as the
 * NUMBER 12345; the row still comes back from the query. Narrowing happens where the value is
 * read, not in a declaration that only looks like a guarantee.
 */
export interface StatisticalHistoryRow {
  id?: string;
  period?: unknown;
  category?: unknown;
  amount?: unknown;
  isCredit?: unknown;
  paymentType?: unknown;
  recurringId?: unknown;
}

/** History the completion marker has cleared. Constructible ONLY by `sealStatisticalHistory`. */
export interface GatedStatisticalHistory {
  readonly [GATED_HISTORY_BRAND]: 'loadStatisticalHistory';
  status: 'ready';
  rows: StatisticalHistoryRow[];
  /** Provenance, carried so the screen can say WHICH backfill run the average rests on. */
  markerCompletedAt: string;
  markerSourceCommit: string;
}

/**
 * The other half of the handle: the marker was absent or malformed, so there is no history and
 * there is no query result in memory either.
 *
 * Deliberately NOT branded. Forging a refusal fails closed — it suppresses a figure that would
 * otherwise render — and a type that is hard to construct in the safe direction is a type people
 * route around. Only the permissive value is guarded.
 */
export interface RefusedStatisticalHistory {
  status: 'refused-backfill-incomplete';
  reasonHe: string;
}

/** STRING discriminant — the root tsconfig is not strict, so a boolean would get no narrowing. */
export type StatisticalHistoryHandle = GatedStatisticalHistory | RefusedStatisticalHistory;

/**
 * Mints gated history from a PARSED marker and the rows the query returned.
 *
 * THROWS on a marker the gate refuses. Returning a refusal here instead would put the decision
 * back in the caller's hands, and `periodMath`'s F-2 argument applies verbatim: on this codebase a
 * refusal a caller is free to ignore is not a refusal. There is exactly one legitimate call site
 * and it has already branched on the gate; reaching this line with a refused marker is a bug in
 * that call site, not a data outcome.
 *
 * `marker` must come from `parseBackfillMarker`, never from the raw document — `settings/{docId}`
 * has no validator, so an unparsed value is whatever the last writer claimed it was.
 */
export function sealStatisticalHistory(
  marker: TransactionPeriodBackfillMarker | null | undefined,
  rows: StatisticalHistoryRow[]
): GatedStatisticalHistory {
  // !! A KNOWN EQUIVALENT MUTANT, REPORTED RATHER THAN HIDDEN. `statisticalLayerGate`'s refusal
  // condition is exactly `!marker`, so replacing this with `if (!marker)` passes every test and no
  // input can distinguish the two. The gate call stays because the GATE is the authority on
  // whether the layer may run — the day it grows a second refusal reason, the bare null check
  // silently stops honouring it. `statisticalHistory.test.ts` pins the equivalence itself, so that
  // day turns a test red instead of passing in silence. The `|| !marker` conjunct is what narrows
  // `marker` for the field reads below.
  const gate = statisticalLayerGate(marker);
  if (gate.status !== 'allowed' || !marker) {
    throw new Error(
      '[sealStatisticalHistory] refusing to mint gated history without a complete backfill marker: ' +
        'a moving average over a half-stamped corpus renders identically to one over all of it.'
    );
  }
  return {
    [GATED_HISTORY_BRAND]: 'loadStatisticalHistory',
    status: 'ready',
    rows,
    markerCompletedAt: marker.completedAt,
    markerSourceCommit: marker.sourceCommit,
  };
}

/** The refusal handle. Carries the Hebrew the screen renders in place of the average. */
export function refuseStatisticalHistory(reasonHe: string): RefusedStatisticalHistory {
  return { status: 'refused-backfill-incomplete', reasonHe };
}

/**
 * Whether a handle really came through the door, checked at RUNTIME.
 *
 * This is the half that survives an `as GatedStatisticalHistory`. The brand symbol is private to
 * this module, so a hand-built object cannot carry it however it was typed — and the statistical
 * layer calls this before it reads a single row, so the cast that the compiler let through fails
 * one frame later with a message naming the door.
 */
export function isGatedStatisticalHistory(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (value as Record<symbol, unknown>)[GATED_HISTORY_BRAND] === 'loadStatisticalHistory';
}
