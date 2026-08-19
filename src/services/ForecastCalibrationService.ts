// Stage 7 T6 — `forecast_calibration`, D28's month-open snapshot. WRITE PATH ONLY.
//
// There is no read here and no UI anywhere, and that is D28's ruling rather than an omission: A27
// cut the `forecasts` collection because its only consumer was a stage that does not exist yet, and
// what survives is a measurement Stage 8 reads. Stage 7 ships the write and the empty state
// (`CALIBRATION_NOT_ENOUGH_TIME_HE`); the number is structurally unavailable until a month has
// elapsed.
//
// ── WHY THIS IS NOT ON `createOwnedCollectionRepo` ────────────────────────────────────────────
//
// The owned-collection factory exists for records a MEMBER creates, edits and deletes: it stamps
// `ownerId`, it mints an id, and it writes an `audit_log` entry in the same transaction. A
// calibration snapshot has no owner (it is a fact about the family's forecast, not about a person),
// its id is the PERIOD rather than a minted one, and it is never edited or deleted. Putting it on
// the factory would give it an owner it does not have and an audit entry describing a user action
// that did not happen — a log line saying a member did something the app did by itself.
//
// ── CREATE-ONLY IS ENFORCED IN RULES, NOT HERE ────────────────────────────────────────────────
//
// `setDoc` on an existing document is an UPDATE in Firestore's eyes, and `firestore.rules` denies
// update and delete on this collection outright. So the "never overwritten" half of D28 survives a
// caller that skips `shouldWriteCalibration` — which is the point of putting a boundary in Rules
// rather than in a helper: this project's doctrine is that Rules are the enforced boundary, and a
// client-side check is the convenience in front of it.
import { doc, documentId, getDocs, collection, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { calibrationWriteDecision, type CalibrationSnapshot } from '../utils/forecastCalibration';
import type { ForecastLineItem } from '../utils/forecast';

/** The Firestore collection `firestore.rules`' `match /forecast_calibration/{docId}` governs. */
export const FORECAST_CALIBRATION_COLLECTION = 'forecast_calibration';

/**
 * How many document ids the decision is allowed to read.
 *
 * !! THIS READ USED TO BE UNBOUNDED, on EVERY forecast computation. One snapshot per month is slow
 * growth rather than a runaway, but a whole-collection scan on a render path is a cost that only
 * ever goes up and never gets looked at again.
 *
 * Two years, newest first. The decision needs exactly two facts — is this anchor already stored,
 * and what is the newest stored month — and the document ids are `YYYY-MM`, which sort
 * lexicographically in chronological order, so "newest first" is free. A computation whose anchor
 * is more than two years behind the newest stored month is refused by the ordering rule whether or
 * not its own document is in the page, so a shorter page cannot change an answer; the extra months
 * are headroom for stray ids written outside the app (Rules pin the pattern, the Admin SDK bypasses
 * Rules).
 */
export const CALIBRATION_READ_LIMIT = 24;

/** The most recent stored document ids, newest first. See `CALIBRATION_READ_LIMIT`. */
export async function listCalibrationPeriods(): Promise<string[]> {
  const snap = await getDocs(
    query(
      collection(db, FORECAST_CALIBRATION_COLLECTION),
      orderBy(documentId(), 'desc'),
      limit(CALIBRATION_READ_LIMIT)
    )
  );
  return snap.docs.map((d) => d.id);
}

export type CalibrationWriteResult =
  | { status: 'written'; snapshot: CalibrationSnapshot }
  | { status: 'already-recorded' }
  /** Nothing was projected for the anchor month. See `forecastCalibration.ts`'s header. */
  | { status: 'nothing-projected' }
  /** A malformed anchor. Returned, never thrown — this function sits on the forecast render path. */
  | { status: 'refused-malformed-anchor'; reason: string };

/**
 * D28's trigger, end to end: read the ids, decide, write at most one document.
 *
 * `computedAt` is a PARAMETER and not a `new Date()` inside this function. Every clock read in this
 * stage enters at the caller, because `forecast.ts`'s whole closure is guarded against reading one
 * (D37) and because a timestamp minted inside a service is a timestamp no test can pin. T7a passes
 * the same instant the computation used.
 */
export async function writeCalibrationSnapshotIfNew(input: {
  anchorPeriod: string;
  lineItems: ForecastLineItem[];
  horizonMonths: number;
  computedAt: string;
}): Promise<CalibrationWriteResult> {
  const existingPeriods = await listCalibrationPeriods();
  // EVERY decision is in `calibrationWriteDecision`, which is pure and tested directly. What is left
  // here is one read, one branch and one write — including the malformed-anchor answer, which used
  // to be a THROW with no `try` above it anywhere, i.e. a bad anchor taking down the whole forecast
  // render for the sake of a measurement that has no UI.
  const decision = calibrationWriteDecision({ ...input, existingPeriods });
  if (decision.status !== 'write') return decision;
  await setDoc(doc(db, FORECAST_CALIBRATION_COLLECTION, decision.snapshot.period), decision.snapshot);
  return { status: 'written', snapshot: decision.snapshot };
}
