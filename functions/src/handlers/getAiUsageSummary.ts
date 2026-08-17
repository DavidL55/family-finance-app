import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { PROVIDER_REGISTRY } from '../providers/registry';
import { monthToDateILS, monthKey } from '../costGate/costGate'; // third-lens M6 — imports Task 3's
// SAME Asia/Jerusalem-pinned monthKey rather than hand-duplicating a second copy that could
// silently disagree about which month a call near midnight belongs to.
import { resolveCeiling } from '../costGate/types'; // Task 8 review F1/F3 — ONE ceiling reader
import { EXCHANGE_RATE } from '../providers/exchangeRate'; // third-lens M5
import type { PermissionRole } from '../shared/permissions';
import type { AiUsageSummary } from './types';

function round4(n: number) { return Math.round(n * 10000) / 10000; }

/**
 * Super-admin only (D4). Server-computed, so the Function-only ai_usage/ai_usage_counters
 * collections (D4) never need a client-read relaxation — the client learns the numbers only
 * through this callable's return value.
 */
export const getAiUsageSummary = onCall<undefined, Promise<AiUsageSummary>>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
  const role = request.auth.token.role as PermissionRole | undefined;
  if (role !== 'super-admin') throw new HttpsError('permission-denied', 'סופר-אדמין בלבד');

  const db = getFirestore();
  const [ceilingSnap, monthSnap] = await Promise.all([
    db.doc('settings/aiCostConfig').get(),
    db.collection('ai_usage').where('month', '==', monthKey()).get(),
  ]);

  // byModel — aggregated from this month's ai_usage ledger entries. Also gives us a correct
  // per-provider callCount for free below, rather than a hardcoded 0.
  const byModelMap = new Map<string, { modelId: string; providerId: string; usedThisMonthILS: number; callCount: number }>();
  monthSnap.forEach((doc) => {
    const d = doc.data() as { modelId: string; providerId: string; amountILS?: number };
    const entry = byModelMap.get(d.modelId) ?? { modelId: d.modelId, providerId: d.providerId, usedThisMonthILS: 0, callCount: 0 };
    entry.usedThisMonthILS += Number(d.amountILS ?? 0);
    entry.callCount += 1;
    byModelMap.set(d.modelId, entry);
  });
  const byModel = Array.from(byModelMap.values());

  // byProvider's usedThisMonthILS reads the SAME running counter costGate.spend()/reconcileSpend()
  // itself gates and corrects against (monthToDateILS) — the number shown here is exactly the
  // number the cost gate enforces, not an independently re-summed figure that could drift from it.
  const byProvider = await Promise.all(
    Object.keys(PROVIDER_REGISTRY).map(async (providerId) => ({
      providerId,
      usedThisMonthILS: await monthToDateILS(providerId),
      callCount: byModel.filter((m) => m.providerId === providerId).reduce((n, m) => n + m.callCount, 0),
    }))
  );

  // Task 8 review F1/F3 — the SAME resolveCeiling costGate.spend() gates on, deliberately not a
  // second `Number(... ?? 0)` here. That collapse is what made the screen print "טרם הוגדרה תקרה
  // חודשית" for a corrupt stored value at the exact moment the gate was disabled by it, and made
  // a deliberate ₪0 indistinguishable from never having set one.
  const resolvedCeiling = resolveCeiling(ceilingSnap.data()?.monthlyCeilingILS);

  return {
    ceilingILS: resolvedCeiling.ceilingILS, // null when unset OR invalid — the status says which
    ceilingStatus: resolvedCeiling.status,
    // Task 8 review F2 — the family-wide total the ONE ceiling is enforced against. Summed from
    // the same per-provider counters byProvider displays, so the headline figure and the
    // breakdown rows can never disagree.
    totalUsedThisMonthILS: round4(byProvider.reduce((sum, p) => sum + p.usedThisMonthILS, 0)),
    byProvider,
    byModel,
    exchangeRate: { usdToILSRate: EXCHANGE_RATE.usdToILSRate, rateAsOf: EXCHANGE_RATE.rateAsOf }, // third-lens M5
  };
});
