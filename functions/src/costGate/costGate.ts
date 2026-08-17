import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { CostQuote, SpendResult } from './types';
import { ApprovalRequiredError } from './types';
import { getAdapterForModel } from '../providers/registry';
import { EXCHANGE_RATE } from '../providers/exchangeRate';

export { ApprovalRequiredError };
export type { CostQuote, SpendResult };

const db = () => getFirestore();

// Third-lens M6: pinned to Asia/Jerusalem. A Functions container's local time is UTC — plain
// `d.getFullYear()`/`d.getMonth()` getters would roll the monthly counter over 2-3 hours off
// Israel's real month boundary in BOTH directions (late-evening calls in Israel landing in next
// UTC-month's bucket; early-morning UTC calls landing in the wrong Israel month). Intl's
// timeZone-aware formatter sidesteps the container's own TZ entirely. Exported — Task 8's
// getAiUsageSummary imports this SAME function rather than hand-duplicating a second copy that
// could silently drift from this fix.
export function monthKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
}

// Third-lens M5: providers bill in USD; the ceiling is ₪. The registry (Task 2/4) stores each
// model's price in USD, sourced from the provider's own pricing page — quote() is the ONE place
// that converts, via a single shared, explicit, dated rate, so a stale rate is visible on every
// quote (exchangeRateAsOf) instead of silently baked into N independent per-model ILS numbers
// that could each drift differently.
export function quote(providerId: string, modelId: string, estIn: number, estOut: number): CostQuote {
  const found = getAdapterForModel(modelId);
  if (!found || found.model.providerId !== providerId) {
    return { providerId, modelId, metered: true, estimatedILS: 0, unknown: true, exchangeRateAsOf: EXCHANGE_RATE.rateAsOf };
  }
  if (found.adapter.id === 'mock') {
    return { providerId, modelId, metered: false, estimatedILS: 0, unknown: false, exchangeRateAsOf: EXCHANGE_RATE.rateAsOf };
  }
  const usdAmount = (estIn / 1000) * found.model.usdInputPer1kTokens + (estOut / 1000) * found.model.usdOutputPer1kTokens;
  const amount = round4(usdAmount * EXCHANGE_RATE.usdToILSRate);
  return { providerId, modelId, metered: true, estimatedILS: amount, unknown: false, exchangeRateAsOf: EXCHANGE_RATE.rateAsOf };
}

export async function monthToDateILS(providerId: string): Promise<number> {
  const snap = await db().doc(`ai_usage_counters/${providerId}_${monthKey()}`).get();
  return Number(snap.data()?.totalILS ?? 0);
}

export async function requestOverageApproval(
  actorMemberId: string,
  actorRole: 'super-admin',
  providerId: string,
  q: CostQuote
): Promise<{ token: string; expiresAt: number }> {
  // actorRole is trusted, not re-checked here — the SAME pattern financeCollections.ts's
  // scope-aware list() trusts its caller's `scope` param (Stage 5 D1). The real enforcement
  // point is the onCall wrapper (requestAiOverageApproval.ts), which sources it from the
  // VERIFIED request.auth.token.role before ever calling in here.
  void actorRole;
  if (!actorMemberId) throw new Error('רק מפעיל אנושי מזוהה יכול לאשר חריגה');
  const token = randomUUID();
  const expiresAt = Date.now() + 120_000; // 120s — long enough to read the confirm dialog, matches paid_calls.py's DEFAULT_TTL_SECONDS
  await db().doc(`ai_overage_approvals/${token}`).set({
    providerId, modelId: q.modelId, estimatedILS: q.estimatedILS,
    approvedByMemberId: actorMemberId, used: false, expiresAt, createdAt: FieldValue.serverTimestamp(),
  });
  return { token, expiresAt };
}

/**
 * D4/D14: gate atomically on the pre-call ESTIMATE inside a transaction — a Firestore
 * transaction cannot safely stay open across a multi-second provider call, so gating on real
 * token counts would REINTRODUCE the exact TOCTOU race D4 already closed (Sasha I6). The
 * ceiling read, the counter read, the decision, the ledger write, and the counter increment all
 * happen inside ONE runTransaction — tx.get() before tx.set(), never a bare .get() before the
 * transaction opens. Throws ApprovalRequiredError (never a silent charge) when the ceiling would
 * be exceeded and no valid token was supplied — callers in onCall handlers MUST catch this and
 * rethrow as HttpsError('resource-exhausted', ...), since a plain Error is redacted to 'internal'
 * by onCall's default error handling (D4 fix for Sasha's I4).
 */
export async function spend(
  actorMemberId: string,
  action: 'chat' | 'insight' | 'extraction',
  q: CostQuote,
  approvalToken?: string
): Promise<SpendResult> {
  // Token consumption is its OWN transaction (single-use redemption, independent of this spend's
  // own ceiling read-then-write) — deliberately outside the transaction below, so one caller's
  // failed ceiling check never blocks a concurrent caller's legitimate token redemption on the
  // same document.
  const approved = approvalToken ? await consumeApproval(approvalToken, q) : false;

  const counterRef = db().doc(`ai_usage_counters/${q.providerId}_${monthKey()}`);
  const ledgerRef = db().collection('ai_usage').doc(randomUUID());
  const ceilingRef = db().doc('settings/aiCostConfig');

  return db().runTransaction(async (tx) => {
    // Ceiling + counter read INSIDE the transaction (D4 fix, Sasha I6) — a bare .get() before
    // runTransaction opens is exactly the TOCTOU race that let two concurrent calls both read
    // "under ceiling" and jointly overrun it.
    const [ceilingSnap, counterSnap] = await Promise.all([tx.get(ceilingRef), tx.get(counterRef)]);
    const ceiling = Number(ceilingSnap.data()?.monthlyCeilingILS ?? 0);
    const used = Number(counterSnap.data()?.totalILS ?? 0);
    const wouldExceed = q.unknown || ceiling <= 0 || used + q.estimatedILS > ceiling;

    if (wouldExceed && !approved) {
      throw new ApprovalRequiredError(q, used, ceiling);
    }

    tx.set(ledgerRef, {
      providerId: q.providerId, modelId: q.modelId, action, actorMemberId, month: monthKey(),
      amountILS: q.estimatedILS, estimatedILS: q.estimatedILS, reconciled: false,
      approvalUsed: Boolean(approvalToken), at: FieldValue.serverTimestamp(),
    });
    tx.set(counterRef, {
      providerId: q.providerId, month: monthKey(),
      totalILS: FieldValue.increment(q.estimatedILS), callCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      spent: true, amountILS: q.estimatedILS, ceilingILS: ceiling, usedThisMonthILS: used + q.estimatedILS,
      ledgerId: ledgerRef.id, // third-lens M2 — the caller passes this to reconcileSpend once the adapter returns
    };
  });
}

/**
 * Third-lens M2 fix. `spend()` above gates and writes off an ESTIMATE (chars/4 input, a flat
 * 400-token output guess). Once the adapter returns REAL token counts, the caller
 * (aiChat.ts / aiExtractDocument.ts, both after Task 4's error-wrapped adapter call succeeds)
 * calls this to correct the ledger entry and the monthly counter by the delta — so the number
 * the cost gate and Task 8's usage screen show is the ACTUAL spend, not the estimate, without
 * reopening the ceiling-admission decision (which already happened, atomically, at spend() time).
 * If this is never reached (a crash between spend() and the adapter's return, or a failed call —
 * see Task 4's providerErrors.ts), the ledger keeps the ESTIMATE forever — the safe direction to
 * fail in, since the estimate over-states spend more often than it under-states it, so the
 * ceiling stays at least as protective as before, never less.
 */
export async function reconcileSpend(
  ledgerId: string,
  actualInputTokens: number,
  actualOutputTokens: number,
  model: { providerId: string; modelId: string }
): Promise<{ correctedAmountILS: number }> {
  const q = quote(model.providerId, model.modelId, actualInputTokens, actualOutputTokens);
  const ledgerRef = db().collection('ai_usage').doc(ledgerId);
  const counterRef = db().doc(`ai_usage_counters/${model.providerId}_${monthKey()}`);

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (!snap.exists) return { correctedAmountILS: 0 }; // already-reconciled or unknown id — no-op, never throws
    const prior = Number(snap.data()!.estimatedILS ?? snap.data()!.amountILS ?? 0);
    const delta = round4(q.estimatedILS - prior); // "estimatedILS" from quote() here IS the actual cost — same formula, real token counts

    tx.update(ledgerRef, { amountILS: q.estimatedILS, actualILS: q.estimatedILS, reconciled: true, reconciledAt: FieldValue.serverTimestamp() });
    tx.update(counterRef, { totalILS: FieldValue.increment(delta) });

    return { correctedAmountILS: q.estimatedILS };
  });
}

async function consumeApproval(token: string, q: CostQuote): Promise<boolean> {
  const ref = db().doc(`ai_overage_approvals/${token}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data()!;
    const ok = !data.used && data.providerId === q.providerId && data.expiresAt > Date.now();
    tx.update(ref, { used: true }); // single-use regardless of match outcome — mirrors paid_calls.py's approve()
    return ok;
  });
}

function round4(n: number) { return Math.round(n * 10000) / 10000; }
