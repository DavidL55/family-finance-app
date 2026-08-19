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
//   2. RUN TIME — `sealStatisticalHistory` THROWS unless `statisticalLayerGate` allows, and the
//      handle it returns is recorded BY IDENTITY in a module-private `WeakSet`. Minting gated
//      history requires a marker that `parseBackfillMarker` accepted, which requires
//      `settings/migrationState` to hold a complete record. A caller who routes around the type
//      still has to produce seven marker fields, and the one that matters cannot be faked into
//      existence by an empty object.
//
//      It does NOT run at build time, so on its own it is a runtime crash on a screen rather than
//      a red test. Hence (3).
//
//      !! THE T5 REVIEW FOUND THIS MECHANISM OPEN, FOUR WAYS, AND THE ROOT CAUSE IS ONE SENTENCE:
//      A PRIVATE SYMBOL STOPS YOU **WRITING** THE KEY, IT DOES NOT STOP YOU **COPYING** IT. Object
//      spread and `Object.assign` copy own enumerable SYMBOL properties, and `Object.create`
//      reaches the key through the prototype chain — so `{ ...handle, rows: forged }` carried a
//      real brand past a check that read the brand's VALUE, and `handle.rows = forged` did not
//      even need that much. Measured on the layer: three sealed ₪100 rows replaced by one ungated
//      ₪9999 row returned `status: 'ready'`, `rowsRead: 1`, `estimateILS: 9999`. See
//      `SEALED_HANDLES` below for why identity is the answer and a better field is not.
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
 * THE RUNTIME AUTHORITY ON PROVENANCE — every handle `sealStatisticalHistory` has ever minted,
 * held BY IDENTITY.
 *
 * ── WHY IDENTITY, AND WHY A BETTER FIELD WOULD NOT HAVE DONE ─────────────────────────────────
 *
 * "This handle came through the seal" is a fact about PROVENANCE, and the T5 review proved what
 * happens when provenance is encoded as DATA ON THE OBJECT: object spread, `Object.assign` and
 * `Object.create` all reproduced the brand, because reproducing data is exactly what those
 * operations are for. A longer key, a random nonce, a hash — every one of them is copied by the
 * same three lines. The strength of the secret is not the axis the attack runs along.
 *
 * The one thing no copy operation can reproduce is OBJECT IDENTITY. `{ ...x } !== x` is a
 * guarantee of the language rather than a property of how `x` was built, and `WeakSet.prototype.has`
 * does not walk the prototype chain, so an heir is a different object however much of its parent it
 * can read. A side table keyed by identity is therefore uncopyable BY CONSTRUCTION: a forger has to
 * obtain the real handle, and obtaining the real handle means going through the door.
 *
 * `WeakSet`, not `Set`: the entry must not keep a corpus of up to `HISTORY_ROW_CEILING` rows alive
 * after the screen that read them is gone.
 *
 * !! THE ONE FALSE NEGATIVE, NAMED. If this module is ever instantiated twice in one process (two
 * bundles, a worker, an SSR pass), a handle sealed by one instance is refused by the other. That is
 * the same failure the private symbol already had — `Symbol()` is not interned either — so it is
 * not a regression, and it fails CLOSED: a refusal, never an average over an unstamped corpus.
 */
const SEALED_HANDLES = new WeakSet<object>();

/**
 * A `transaction_lines` row as the statistical layer reads one.
 *
 * EVERY VALUE FIELD IS `unknown`, deliberately, and for the reason `readObservedAmount` and
 * `periodOfMonthYear` already state: these come off schemaless documents through a NON-STRICT
 * tsconfig, so `category: string` is a claim the compiler cannot keep. F-1 proved the point live —
 * a parent can strip `date`, `owner` and `amount` off a row entirely, and can write `date` as the
 * NUMBER 12345; the row still comes back from the query. Narrowing happens where the value is
 * read, not in a declaration that only looks like a guarantee.
 *
 * !! IT IS A TYPE ALIAS AND NOT AN INTERFACE, AND T7a-REVIEW F1 IS WHY. The instalment layer reads
 * `date`, `vendor`, `description`, `installmentNumber` and `totalInstallments` off these same rows,
 * and after F1 it reads them OFF THE SEALED HANDLE rather than off the ungated sibling array — so
 * it needs to reach a field this declaration does not name. TypeScript gives an object-literal TYPE
 * an implicit index signature and an INTERFACE none, so the alias is what lets a reader narrow
 * through `Record<string, unknown>` at the point of use.
 *
 * Naming those five fields here instead would say something false: the field set of a schemaless
 * document is not closed, and the members below are merely the ones the STATISTICAL layer consults.
 * `extends Record<string, unknown>` was the other candidate and it is worse — it would force every
 * producer of a row-shaped fixture in the tree to carry an index signature too, which is a
 * requirement about test types rather than about documents.
 */
export type StatisticalHistoryRow = {
  id?: string;
  period?: unknown;
  category?: unknown;
  amount?: unknown;
  isCredit?: unknown;
  paymentType?: unknown;
  recurringId?: unknown;
};

/**
 * History the completion marker has cleared. Constructible ONLY by `sealStatisticalHistory`.
 *
 * !! `rows` IS `readonly` IN BOTH DIRECTIONS, AND THAT IS T5-REVIEW F1's HEADLINE. `handle.rows =
 * otherRows` used to typecheck, run, and pass all three layers — the brand key was marked
 * `readonly` and the corpus beside it was not. `readonly rows` makes the swap `TS2540` and
 * `readonly StatisticalHistoryRow[]` makes `handle.rows.push(…)` `TS2339`; the seal freezes both
 * objects so neither is merely a compile-time promise.
 */
export interface GatedStatisticalHistory {
  readonly [GATED_HISTORY_BRAND]: 'loadStatisticalHistory';
  readonly status: 'ready';
  readonly rows: readonly StatisticalHistoryRow[];
  /** Provenance, carried so the screen can say WHICH backfill run the average rests on. */
  readonly markerCompletedAt: string;
  readonly markerSourceCommit: string;
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
  rows: readonly StatisticalHistoryRow[]
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
  // THE CORPUS IS COPIED, THEN FROZEN, THEN THE HANDLE IS FROZEN, THEN THE HANDLE IS RECORDED.
  //   · copied — otherwise the caller who handed the rows in still holds a live reference to the
  //     array the average will read, and the guarantee is only as good as that call site's
  //     discipline;
  //   · frozen — `readonly` is erased at runtime, so on its own it leaves F1's headline bypass
  //     live in any path that skipped `tsc`, and that bypass keeps the handle's IDENTITY, which is
  //     the one thing `SEALED_HANDLES` cannot see;
  //   · recorded last, so nothing half-built is ever in the set.
  const handle: GatedStatisticalHistory = {
    [GATED_HISTORY_BRAND]: 'loadStatisticalHistory',
    status: 'ready',
    rows: Object.freeze([...rows]),
    markerCompletedAt: marker.completedAt,
    markerSourceCommit: marker.sourceCommit,
  };
  const sealed = Object.freeze(handle);
  SEALED_HANDLES.add(sealed);
  return sealed;
}

/** The refusal handle. Carries the Hebrew the screen renders in place of the average. */
export function refuseStatisticalHistory(reasonHe: string): RefusedStatisticalHistory {
  return { status: 'refused-backfill-incomplete', reasonHe };
}

/**
 * Whether a handle really came through the door, checked at RUNTIME.
 *
 * This is the half that survives an `as GatedStatisticalHistory`. The statistical layer calls it
 * before it reads a single row, so the cast that the compiler let through fails one frame later
 * with a message naming the door.
 *
 * !! IT ASKS `SEALED_HANDLES`, NOT THE OBJECT. The brand's VALUE is deliberately not consulted, and
 * the T5 review is why: reading it accepted an object spread, an `Object.assign` and an
 * `Object.create` heir, all three carrying a genuine brand. Nothing this function could read OFF
 * the object would have refused them, because everything readable is copyable. Asking a table
 * keyed by identity is the whole of the fix, and adding a belt-and-braces brand read beside it
 * would only invite a later reader to think the brand is what is doing the work.
 */
export function isGatedStatisticalHistory(value: unknown): boolean {
  // !! A SECOND KNOWN EQUIVALENT MUTANT, REPORTED RATHER THAN HIDDEN — and this file already
  // carries one, so the convention is set. This guard is a TYPE necessity, not a runtime one:
  // `WeakSet.prototype.has` needs an `object`, and `unknown` has to be narrowed to reach it.
  // Replacing the whole line with `SEALED_HANDLES.has(Object(value))` SURVIVES every test, twice,
  // and is genuinely equivalent — `Object(primitive)` mints a FRESH wrapper that was never sealed,
  // so every primitive still answers `false`. It stays because narrowing is what `tsc` asks for,
  // and because "a primitive is not a handle" is clearer read as a guard than as a boxing trick.
  // The behaviour it looks like it is protecting is pinned below by the `null`/`undefined`/string/
  // array cases, which are real assertions rather than a description of this line.
  if (typeof value !== 'object' || value === null) return false;
  return SEALED_HANDLES.has(value);
}
