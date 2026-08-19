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
import { doc, getDocs, collection, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { calibrationSnapshotOf, shouldWriteCalibration, type CalibrationSnapshot } from '../utils/forecastCalibration';
import type { ForecastLineItem } from '../utils/forecast';

/** The Firestore collection `firestore.rules`' `match /forecast_calibration/{docId}` governs. */
export const FORECAST_CALIBRATION_COLLECTION = 'forecast_calibration';

/** The document ids already stored, i.e. the months a snapshot exists for. */
export async function listCalibrationPeriods(): Promise<string[]> {
  const snap = await getDocs(collection(db, FORECAST_CALIBRATION_COLLECTION));
  return snap.docs.map((d) => d.id);
}

export type CalibrationWriteResult =
  | { status: 'written'; snapshot: CalibrationSnapshot }
  | { status: 'already-recorded' };

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
  const existing = await listCalibrationPeriods();
  if (!shouldWriteCalibration(input.anchorPeriod, existing)) return { status: 'already-recorded' };
  const snapshot = calibrationSnapshotOf(input);
  await setDoc(doc(db, FORECAST_CALIBRATION_COLLECTION, snapshot.period), snapshot);
  return { status: 'written', snapshot };
}
