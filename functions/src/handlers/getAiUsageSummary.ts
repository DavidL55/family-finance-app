import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { PROVIDER_REGISTRY } from '../providers/registry';
import { monthToDateILS, monthKey, monthCountersQuery } from '../costGate/costGate'; // third-lens M6 — imports Task 3's
// SAME Asia/Jerusalem-pinned monthKey rather than hand-duplicating a second copy that could
// silently disagree about which month a call near midnight belongs to.
import { resolveCeiling, readStoredAmountILS } from '../costGate/types'; // Task 8 review F1/F3 — ONE ceiling reader
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
  const month = monthKey();
  const [ceilingSnap, monthSnap, countersSnap] = await Promise.all([
    db.doc('settings/aiCostConfig').get(),
    db.collection('ai_usage').where('month', '==', month).get(),
    // Batch 6 (closing review M1) — the SAME derived counter query costGate.spend() enforces on,
    // so a provider that has left the registry cannot be visible to the gate and invisible on the
    // screen (or the reverse). Iterating Object.keys(PROVIDER_REGISTRY) alone was the display half
    // of M1: a retired provider's month-to-date spend simply stopped being shown.
    monthCountersQuery(month).get(),
  ]);

  // Batch 6 (closing review B1) — the ledger's stored amount goes through the shared reader, not
  // `Number(d.amountILS ?? 0)`. A corrupt entry used to make one byModel row NaN, which JSON
  // serialises to null on the wire and renders as "₪—" beside rows that look fine, with nothing
  // saying the figure is unreadable rather than small.
  let anyAmountUnreadable = false;
  // byModel — aggregated from this month's ai_usage ledger entries. Also gives us a correct
  // per-provider callCount for free below, rather than a hardcoded 0.
  const byModelMap = new Map<string, { modelId: string; providerId: string; usedThisMonthILS: number | null; callCount: number }>();
  monthSnap.forEach((doc) => {
    const d = doc.data() as { modelId: string; providerId: string; amountILS?: unknown };
    const entry = byModelMap.get(d.modelId) ?? { modelId: d.modelId, providerId: d.providerId, usedThisMonthILS: 0 as number | null, callCount: 0 };
    const stored = readStoredAmountILS(d.amountILS);
    if (stored.status === 'corrupt') {
      anyAmountUnreadable = true;
      entry.usedThisMonthILS = null; // one unreadable entry makes the whole row unknown, not smaller
    } else if (entry.usedThisMonthILS !== null) {
      entry.usedThisMonthILS = round4(entry.usedThisMonthILS + (stored.amountILS ?? 0));
    }
    entry.callCount += 1;
    byModelMap.set(d.modelId, entry);
  });
  const byModel = Array.from(byModelMap.values());

  // byProvider's usedThisMonthILS reads the SAME running counter costGate.spend()/reconcileSpend()
  // itself gates and corrects against (monthToDateILS) — the number shown here is exactly the
  // number the cost gate enforces, not an independently re-summed figure that could drift from it.
  //
  // The provider list is the registry UNIONED with every provider that actually has a counter this
  // month (M1). A registry provider with no counter still shows, at ₪0.00, so the breakdown does
  // not silently shrink; a retired provider with real spend shows too, because that spend is still
  // counted by the gate.
  const counterProviderIds = countersSnap.docs
    .map((doc) => doc.get('providerId'))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const providerIds = Array.from(new Set([...Object.keys(PROVIDER_REGISTRY), ...counterProviderIds]));
  const byProvider = await Promise.all(
    providerIds.map(async (providerId) => {
      const stored = await monthToDateILS(providerId);
      if (stored.status === 'corrupt') anyAmountUnreadable = true;
      return {
        providerId,
        // 'absent' (no spend on this provider this month) is a genuine ₪0; 'corrupt' is null, i.e.
        // "unreadable", and the two must not render the same way — a corrupt counter is the state
        // in which costGate.spend() refuses EVERY paid call (B1), and a reassuring ₪0.00 beside a
        // fully-closed gate is F1's pairing verbatim.
        usedThisMonthILS: stored.status === 'corrupt' ? null : (stored.amountILS ?? 0),
        callCount: byModel.filter((m) => m.providerId === providerId).reduce((n, m) => n + m.callCount, 0),
      };
    })
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
    // Batch 6 — null, not a partial sum, when ANY provider's counter is unreadable. A partial
    // total would be a smaller number presented in exactly the same shape as a true one, which is
    // the reassuring-figure failure this whole batch is about; the headline goes to "₪—" and
    // `usageStatus` says why.
    totalUsedThisMonthILS: byProvider.some((p) => p.usedThisMonthILS === null)
      ? null
      : round4(byProvider.reduce((sum, p) => sum + (p.usedThisMonthILS ?? 0), 0)),
    // Batch 6 (closing review B1) — the display half. costGate.spend() refuses every paid call
    // while a counter is corrupt, so the screen must be able to say so instead of printing a
    // plausible ₪0.00 (or, as it did before this batch, "NaN% מהתקרה").
    usageStatus: anyAmountUnreadable ? ('corrupt' as const) : ('ok' as const),
    byProvider,
    byModel,
    exchangeRate: { usdToILSRate: EXCHANGE_RATE.usdToILSRate, rateAsOf: EXCHANGE_RATE.rateAsOf }, // third-lens M5
  };
});
