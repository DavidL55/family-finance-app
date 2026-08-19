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
import { comparePeriod, isPeriod, laterPeriod } from './periodMath';
import { layerOf, type ForecastLayer, type ForecastLineItem } from './forecast';

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
