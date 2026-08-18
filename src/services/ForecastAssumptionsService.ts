// Stage 7 T2 — `forecast_assumptions`, on the Stage-3 owned-collection factory (D25).
//
// THIS IS THE ONLY MODULE THAT NAMES THE COLLECTION, and that is a tested property rather than a
// convention (`forecastAssumptions.test.ts`, over src/ AND scripts/). Two things depend on it:
//
//  · D20's total order ends `… → then id ascending`, and `createOwnedCollectionRepo.list` returns
//    `d.data()` WITHOUT `d.id` (finding 1.2.8). The tiebreak therefore reads `id` off the document
//    BODY, which only `save()` stamps (`financeCollections.ts`'s `merged.id = id`). A writer that
//    is not this repo produces documents with no `id` in the body, and the final tiebreak of a
//    total order silently degenerates into "whichever Firestore returned first" — non-deterministic
//    money on the headline number, with green tests.
//  · every mutation rides in the SAME transaction as its `audit_log` entry (D10). A bare
//    `setDoc` here would be a financial write with no audit trail, on the one collection whose
//    contents are a family member's explicit claim about the future.
//
// No bespoke logic belongs in this file. If T6/T7 need scope-filtered reads, they filter the
// repo's result — the repo's `list('own' | 'family', viewerMemberId)` already issues the query
// shape Firestore's list-time rule verification can accept for an 'own'-level viewer.
import { createOwnedCollectionRepo } from './financeCollections';
import type { ForecastAssumption } from '../types/finance';

/** The Firestore collection `firestore.rules`' `match /forecast_assumptions/{docId}` governs. */
export const FORECAST_ASSUMPTIONS_COLLECTION = 'forecast_assumptions';

/** The audit_log `action` prefix — `forecastAssumption.save` / `forecastAssumption.delete`. */
export const FORECAST_ASSUMPTION_AUDIT_PREFIX = 'forecastAssumption';

export const forecastAssumptionRepo = createOwnedCollectionRepo<ForecastAssumption>(
  FORECAST_ASSUMPTIONS_COLLECTION,
  FORECAST_ASSUMPTION_AUDIT_PREFIX
);

export const listForecastAssumptions = forecastAssumptionRepo.list;
export const saveForecastAssumption = forecastAssumptionRepo.save;
export const deleteForecastAssumption = forecastAssumptionRepo.remove;
