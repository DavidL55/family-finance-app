// src/utils/forecastCalibration.ts — Stage 7 T6, D28. THE MONTH-OPEN SNAPSHOT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// A MEASUREMENT, NOT A FEATURE — AND IT NAMES THE MONTH v2 GOT WRONG
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// A27 CUT the `forecasts` collection: its only named consumer was Stage 8, the stage that knows
// what shape it needs, and building a collection, rules block, validator, audit action and restore
// mode for a consumer that does not exist is the bet B4 lost. What survives is one automatic
// snapshot with NO UI, NO RESTORE and NO USER CONTROL, whose only purpose is calibration.
//
// !! THE DOC ID IS THE ANCHOR MONTH, NOT THE MONTH JUST ENDED. v2 wrote "the month just ended" and
// there was nothing to write: D32(a) clamps `anchorPeriod = max(selectedPeriod, todayPeriod)`, so
// by the time the first computation of month M runs, M−1 is PAST and that computation produces NO
// LINE ITEMS FOR IT AT ALL. The snapshot would have been an empty document, and the defect would
// have surfaced in Stage 8 as a calibration screen with no rows.
//
// Read as: *the forecast made at the start of M, compared against what M actually was* — available
// once M has elapsed, i.e. in M+1.
//
// ── WHY `computedAt` AND `horizonMonths` ARE STORED ───────────────────────────────────────────
//
// If the app's first computation in M happens on the 20th, the snapshot is a ten-day-old projection
// of a thirty-day month. The number is only interpretable if that is on the record, so Stage 8 can
// tell an early-month projection from a late-month one instead of averaging the two.
//
// ── AND THE LIMITATION, STATED HERE RATHER THAN DISCOVERED IN T8 ──────────────────────────────
//
// `|projected − actual| / actual` needs a projection for a month that has since ELAPSED. The first
// snapshot is written at the first computation after this stage ships, and the first calibration
// number exists only once THAT month has ended. There is no month in Stage 7 for which both a
// projection and an actual exist, so CALIBRATION IS NOT A STAGE 7 ACCEPTANCE MEASURE and cannot be
// one — listing it would repeat the `unusableRowCount` defect the gate rejected. Stage 7 ships the
// write path and `CALIBRATION_NOT_ENOUGH_TIME_HE`; the number is a Stage 8 readout.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// !! AN EMPTY PROJECTION IS NOT SNAPSHOTTED. T6 review — the decision-level pass.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T6 wrote an EMPTY snapshot when the anchor month had no line items, and a test pinned that as
// correct. Both were written against the implementation rather than against the decision, and the
// measured corpus is what makes the difference matter: on day one this ledger holds THREE ROWS IN
// ONE MONTH, so the very first snapshot this app would ever write is
// `{expenseILS: 0, incomeILS: 0, categories: []}`. Stage 8 divides by the actual month and reads
// that as **100% ERROR FOR THE FAMILY'S FIRST MONTH** — a number nobody can derive, stored in a
// document, which is exactly the class the adjudication rejected.
//
// TWO OPTIONS WERE ON THE TABLE AND ONLY ONE SURVIVES THE CREATE-ONLY RULE.
//
//   · **Store it with an explicit "nothing was projected" discriminant.** Rejected. D28 is
//     create-only and Rules deny `update` outright, so that document is PERMANENT: the family's
//     first month would carry a "nothing projected" row forever, even though the app went on to
//     project that same month five minutes later once the data loaded. It also asks every future
//     reader to branch on a state that means "ignore me".
//   · **REFUSE TO SNAPSHOT.** Taken. A snapshot of nothing is not a measurement, and the absence of
//     a row is already a state Stage 8 must handle (a family that installed the app mid-month has
//     no row for that month either). And it SELF-HEALS in the only direction that is honest: the
//     next computation in the same month, once there is something to project, is still the first
//     stored projection for that month — and it is a real one.
//
// The refusal costs one property of the original ruling and the trade is stated rather than hidden:
// the stored document is no longer "the first computation of M" but "the first computation of M
// THAT PROJECTED ANYTHING". `computedAt` is stored precisely so Stage 8 can tell an early-month
// projection from a late-month one, so the property that was actually load-bearing survives.
//
// !! AND THE EMPTINESS TEST IS ONE CONDITION, NOT THREE. `categories.length === 0` if and only if no
// line item fell in the anchor month, because every line item creates exactly one entry. Writing it
// as `categories.length === 0 && expenseILS === 0 && incomeILS === 0` would be a conjunction with
// two halves that can never independently be false — a guard with one working part, which is this
// stage's most-counted defect. A ₪0 line item DOES produce an entry and IS snapshotted, and that is
// correct: "we projected ₪0 for groceries" is a projection, and it is one Stage 8 can be wrong
// about.
import { comparePeriod, isPeriod, laterPeriod } from './periodMath';
import { type ForecastLayer, type ForecastLineItem, layerOf } from './forecastBasis';

/** One category's projected spend for the anchor month, and which layer produced it. */
export interface CalibrationCategory {
  categoryId: string;
  layer: ForecastLayer;
  amountILS: number;
}

export interface CalibrationSnapshot {
  /** Always equal to the document id. Stored anyway, so a document read alone is self-describing. */
  period: string;
  /** The real timestamp of the computation, as an ISO string. See the header. */
  computedAt: string;
  horizonMonths: number;
  expenseILS: number;
  incomeILS: number;
  categories: CalibrationCategory[];
}

const AGOROT = 100;
function roundILS(amount: number): number {
  return Math.round(amount * AGOROT) / AGOROT;
}

/**
 * The snapshot for one computation, built from the SAME line items the screen drew.
 *
 * Per (category, layer) rather than per category, because D28's whole purpose is letting Stage 8
 * see WHERE an error came from: a certain-layer miss is a wrong contract or a missed charge, a
 * statistical miss is a moving average that did not hold. Collapsing the two into one figure per
 * category throws away the only diagnostic the snapshot exists to carry.
 *
 * REFUSES a malformed anchor. The anchor becomes a DOCUMENT ID, and a document id of `'0-NaN'` is a
 * calibration row nothing will ever match against an actual month — the same class as every period
 * refusal in `periodMath.ts`, one layer out.
 */
export function calibrationSnapshotOf(input: {
  anchorPeriod: string;
  lineItems: ForecastLineItem[];
  horizonMonths: number;
  computedAt: string;
}): CalibrationSnapshot {
  if (!isPeriod(input.anchorPeriod)) {
    throw new Error(
      `calibrationSnapshotOf: anchorPeriod must be a zero-padded 'YYYY-MM' period, got ` +
        `${JSON.stringify(input.anchorPeriod)}. It becomes the document id, and a malformed id is a ` +
        'calibration row no month can ever be compared against.'
    );
  }

  const byKey = new Map<string, CalibrationCategory>();
  let expenseILS = 0;
  let incomeILS = 0;
  for (const item of input.lineItems) {
    if (item.period !== input.anchorPeriod) continue;
    const layer = layerOf(item.basis);
    if (item.direction === 'income') incomeILS = roundILS(incomeILS + item.amountILS);
    else expenseILS = roundILS(expenseILS + item.amountILS);
    // Income and expense in one category would net if they shared a key — the same defect T1 found
    // in D19's bucket key and fixed by adding `direction`. Same fix, same reason.
    const key = `${item.direction}|${layer}|${item.categoryId}`;
    const existing = byKey.get(key);
    if (existing) existing.amountILS = roundILS(existing.amountILS + item.amountILS);
    else byKey.set(key, { categoryId: item.categoryId, layer, amountILS: roundILS(item.amountILS) });
  }

  return {
    period: input.anchorPeriod,
    computedAt: input.computedAt,
    horizonMonths: input.horizonMonths,
    expenseILS,
    incomeILS,
    // Sorted, so two computations of the same month produce byte-comparable documents and a Stage 8
    // diff is about the numbers rather than about Firestore's iteration order.
    categories: [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
  };
}

/**
 * Whether this snapshot measured anything at all.
 *
 * ONE condition. See the header for why it is not a conjunction, and for why the answer to "nothing
 * was projected" is to store no document rather than to store an empty one.
 */
export function snapshotHasProjection(snapshot: CalibrationSnapshot): boolean {
  return snapshot.categories.length > 0;
}

/**
 * Whether this computation should write a snapshot.
 *
 * TWO conditions, and neither subsumes the other:
 *
 *   · **no document exists for the anchor month.** Create-only, idempotent by doc id, so a second
 *     computation later in the month cannot quietly replace an early-month projection with a
 *     late-month one — which would silently change what the stored number MEANS.
 *   · **the anchor is not older than the newest snapshot already stored.** A computation whose
 *     anchor has fallen behind (a clock skew, a replayed session) would otherwise back-fill a month
 *     that has already elapsed, and store it as "the forecast made at the start of" a month it was
 *     not made at the start of. That document would be indistinguishable from a real one.
 *
 * The first condition alone lets the second case through; the second alone lets a same-month
 * rewrite through. Both are tested independently, because a conjunction whose second half is never
 * false is a guard with one working half.
 */
export function shouldWriteCalibration(anchorPeriod: string, existingPeriods: string[]): boolean {
  if (!isPeriod(anchorPeriod)) {
    throw new Error(
      `shouldWriteCalibration: anchorPeriod must be a zero-padded 'YYYY-MM' period, got ${JSON.stringify(anchorPeriod)}`
    );
  }
  const known = existingPeriods.filter(isPeriod);
  // !! THIS CHECK IS SUBSUMED BY THE ONE BELOW TODAY, AND IT IS KEPT DELIBERATELY. Dropping it
  // SURVIVED the sweep, and the reason is arithmetic rather than luck: if the anchor is already
  // stored then it cannot be later than the newest stored month, so the ordering comparison
  // refuses it anyway. It stays because it is the one that states the RULE — create-only,
  // idempotent by doc id — while the other states a different rule that happens to imply it, and
  // `forecastCalibration.test.ts` pins the subsumption so the day the ordering rule changes the
  // pin fails instead of this line silently becoming load-bearing without anyone noticing.
  if (known.includes(anchorPeriod)) return false;
  if (known.length === 0) return true;
  const newest = known.reduce(laterPeriod);
  return comparePeriod(anchorPeriod, newest) > 0;
}


// ─────────────────────────────────────────────────────────────────────────────────────────────
// !! THE WHOLE WRITE DECISION, PURE — T6 review, the decision-level pass
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type CalibrationDecision =
  | { status: 'refused-malformed-anchor'; reason: string }
  | { status: 'already-recorded' }
  | { status: 'nothing-projected' }
  | { status: 'write'; snapshot: CalibrationSnapshot };

/**
 * Everything `writeCalibrationSnapshotIfNew` decides, with no Firestore in it.
 *
 * ── WHY THIS EXISTS RATHER THAN THREE CHECKS INSIDE THE SERVICE ───────────────────────────────
 *
 * This project's doctrine is pure logic in `src/utils/`, I/O in the service that calls it
 * (`seedFromBudgetConfig.ts` states it). Two of the three answers below were previously unreachable
 * by any test because they lived inside an `async` function that reads Firestore first.
 *
 * ── AND THE ONE THAT WAS A DEFECT ─────────────────────────────────────────────────────────────
 *
 * !! `shouldWriteCalibration` THROWS on a malformed anchor and there was no `try` above it, so a bad
 * anchor took down THE WHOLE FORECAST RENDER — the screen the family came for, killed by a
 * measurement that has no UI and that nobody is waiting for. The pure refusals stay loud (they are
 * the guarantee for a direct caller, and both are still tested by `toThrow`); this function is the
 * boundary that turns them into an ANSWER for the one caller that sits on a render path. It is a
 * stated precondition check, not a swallowed exception: `isPeriod` is asked FIRST, and there is no
 * other guard here for it to shadow.
 */
export function calibrationWriteDecision(input: {
  anchorPeriod: string;
  existingPeriods: string[];
  lineItems: ForecastLineItem[];
  horizonMonths: number;
  computedAt: string;
}): CalibrationDecision {
  if (!isPeriod(input.anchorPeriod)) {
    return {
      status: 'refused-malformed-anchor',
      reason:
        `anchorPeriod must be a zero-padded 'YYYY-MM' period, got ${JSON.stringify(input.anchorPeriod)}. ` +
        'No snapshot is written and the forecast render is unaffected.',
    };
  }
  if (!shouldWriteCalibration(input.anchorPeriod, input.existingPeriods)) return { status: 'already-recorded' };
  const snapshot = calibrationSnapshotOf(input);
  // See the header: an empty projection is not a measurement, and D28's create-only rule would make
  // it permanent. Refusing lets the next computation of the same month store a real one.
  if (!snapshotHasProjection(snapshot)) return { status: 'nothing-projected' };
  return { status: 'write', snapshot };
}
