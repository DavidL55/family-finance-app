import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type {
  CostQuote, SpendResult, ApprovalRefusalReason, ResolvedCeiling, CeilingStatus, StoredAmountILS,
} from './types';
import { ApprovalRequiredError, resolveCeiling, readStoredAmountILS, MAX_MONTHLY_CEILING_ILS } from './types';
import { findModelEntry, listProviderIds } from '../providers/registry';
import { EXCHANGE_RATE } from '../providers/exchangeRate';

export { ApprovalRequiredError, resolveCeiling, readStoredAmountILS, MAX_MONTHLY_CEILING_ILS };
export type { CostQuote, SpendResult, ApprovalRefusalReason, ResolvedCeiling, CeilingStatus, StoredAmountILS };

const db = () => getFirestore();

export const AI_USAGE_COUNTERS = 'ai_usage_counters';

/**
 * Batch 6 (closing review M1) — EVERY counter document for a month, derived from the data rather
 * than enumerated from the registry.
 *
 * `Object.keys(PROVIDER_REGISTRY)` is a hand-maintained list of the places money can be, and both
 * spend() and getAiUsageSummary used it as their whole read set. Retiring a provider therefore
 * hid its accumulated month-to-date total and handed that budget back (probed by the closing
 * review: ₪9.50 hidden, ₪9 admitted against a ₪10 ceiling) — while registry.ts's own comment
 * promised the opposite. That promise is TRUE for removing a provider's KEY (isConfigured() goes
 * false, the id stays in Object.keys) and FALSE for removing it from the registry.
 *
 * Retirement is a two-place edit today, not an accident: `PROVIDER_REGISTRY` is typed
 * `Record<ProviderId, …>` over a closed union, so deleting an entry does not compile until the
 * union is edited too. That makes the hazard deliberate rather than silent — it does not make it
 * safe. Money that was really spent at a real vendor must not become spendable again because we
 * stopped offering that vendor, and the invariant should not depend on whoever performs the
 * retirement also remembering this file.
 *
 * Derived, not enumerated, is the same technique this stage's mutation sweep prescribed for its
 * other survivors. The month field is what spend() and reconcileSpend() both stamp on every
 * counter they write.
 */
export function monthCountersQuery(month: string) {
  return db().collection(AI_USAGE_COUNTERS).where('month', '==', month);
}

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
  // findModelEntry, not getAdapterForModel: quote() prices a model, it does not choose an adapter
  // to CALL, and a price has no action axis. The action-tag check (Task 7 review, Important 1)
  // belongs at the point of dispatch — and by the time quote() runs, the handler has already
  // passed it.
  const found = findModelEntry(modelId);
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

/**
 * Batch 6 (closing review B1) — READER 1 OF 3 OF A STORED COUNTER TOTAL, and the one that feeds
 * the SCREEN. `Number(snap.data()?.totalILS ?? 0)` here is the same coercion B1 proved fails the
 * gate open at spend(); getAiUsageSummary inherits it, which is why the settings screen printed
 * "₪—" (and "NaN% מהתקרה") at the precise moment the gate was disabled. Same pair as F1: gate
 * off, screen not saying so.
 *
 * Returns the discriminated read rather than a number, so the display layer cannot quietly turn
 * an unreadable total into a plausible ₪0. What to DO about a corrupt counter is the caller's
 * decision and is made explicitly there.
 */
export async function monthToDateILS(providerId: string): Promise<StoredAmountILS> {
  const snap = await db().doc(`${AI_USAGE_COUNTERS}/${providerId}_${monthKey()}`).get();
  return readStoredAmountILS(snap.data()?.totalILS);
}

// Review of 9ca9eea, F-E — `monthToDateAllProvidersILS()` used to live here, documented as
// existing "purely so the settings screen can display the same total the gate enforces". It had
// ZERO callers, and getAiUsageSummary derives that same total by reducing over the very
// `byProvider` array it is about to return. Deleted rather than wired up, because the inline
// reduce protects the equality BETTER than this function could: it sums exactly the numbers the
// screen renders, so the headline figure and the breakdown rows are one computation and cannot
// disagree. Calling a second, independently-read sum here would have re-introduced precisely the
// two-sources-of-truth drift the F2 fix rejected a global counter doc to avoid — and would have
// doubled the counter reads to do it. The equality itself stays pinned by a test in
// getAiUsageSummary.test.ts.

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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // CLOSING REVIEW (cheap item) — AUTHORISING SPEND PAST THE FAMILY BUDGET NOW LEAVES A RECORD.
  //
  // This wrote only the token doc, while its sibling setAiCostCeiling.ts:46 writes an audit entry
  // in the SAME batch, and batch 9 closed this same class for the extraction import commit. A
  // super-admin approving an overage is the most sensitive AI action in the stage — it is the one
  // that moves money past a limit the family agreed on — and it left nothing reviewable behind
  // (spec §14.5).
  //
  // SAME BATCH, for setAiCostCeiling's own stated reason: an audit entry can never exist without
  // the write it describes, or vice versa. Unlike batch 9's extraction.commit — which deviated
  // deliberately because that path issues N independent writes with a query interleaved — this is
  // two writes and no reason to deviate, so it follows the ordinary convention.
  //
  // THE TOKEN ITSELF IS NOT LOGGED. The approval doc's id IS the bearer credential that authorises
  // the spend, so writing it into a second collection would copy a live secret somewhere it is not
  // needed. Everything a reviewer actually needs — who approved, when, for how much, on which
  // model — is here without it.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const batch = db().batch();
  batch.set(db().doc(`ai_overage_approvals/${token}`), {
    providerId, modelId: q.modelId, estimatedILS: q.estimatedILS,
    approvedByMemberId: actorMemberId, used: false, expiresAt, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db().collection('audit_log').doc(), {
    actorMemberId, action: 'aiOverage.approve',
    target: 'ai_overage_approvals', at: FieldValue.serverTimestamp(),
    details: { providerId, modelId: q.modelId, approvedAmountILS: q.estimatedILS, expiresAt },
  });
  await batch.commit();

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

  const month = monthKey();
  const counterRef = db().doc(`${AI_USAGE_COUNTERS}/${q.providerId}_${month}`);
  const ledgerRef = db().collection('ai_usage').doc(randomUUID());
  const ceilingRef = db().doc('settings/aiCostConfig');
  // Task 8 review F2 — EVERY provider's counter for this month, because the ceiling is one
  // family-wide number. `q.providerId` is unioned in defensively: a quote for a provider that has
  // since left the registry must still be counted, never quietly exempted.
  const allProviderIds = Array.from(new Set([...listProviderIds(), q.providerId]));
  const allCounterRefs = allProviderIds.map((id) => db().doc(`${AI_USAGE_COUNTERS}/${id}_${month}`));
  const countersQuery = monthCountersQuery(month);

  return db().runTransaction(async (tx) => {
    // Ceiling + counters read INSIDE the transaction (D4 fix, Sasha I6) — a bare .get() before
    // runTransaction opens is exactly the TOCTOU race that let two concurrent calls both read
    // "under ceiling" and jointly overrun it. Widening the read from one counter to all of them
    // (F2) does not weaken that: they are still all read in the same transaction, before any
    // write, so Firestore's own conflict detection covers every document the decision depends on.
    //
    // Review of 9ca9eea, F-G — ONE tx.getAll() rather than Promise.all of N tx.get()s. getAll is
    // the Admin SDK's documented primitive for exactly this (a single BatchGetDocuments RPC), so
    // the round-trip count stops scaling with the number of registered providers: adding a fifth
    // provider used to add a sixth RPC to every single spend. Snapshot order is guaranteed to
    // match the argument order, which is what lets the ceiling stay destructured off the front.
    // The atomicity property is unchanged and deliberately so: every document the admission
    // decision reads is still read here, before any write, inside this same transaction.
    //
    // That read set deliberately INCLUDES settings/aiCostConfig, which means a super-admin saving
    // a new ceiling can cause an in-flight spend's transaction to retry. Judged acceptable, and
    // the alternative is worse: reading the ceiling outside the transaction is the literal TOCTOU
    // shape D4/I6 closed (read ₪100, super-admin lowers it to ₪10, spend admitted against the
    // stale ₪100). Ceiling writes are one human editing a settings screen, months apart; spends
    // are the frequent operation, and the Admin SDK retries a contended transaction on its own.
    // Correctness over a rare retry.
    // Batch 6 (closing review M1) — TWO reads, deliberately, and they cover different blind spots.
    //
    // The getAll below is unchanged and still reads the ceiling plus every REGISTRY provider's
    // counter by document id, so a counter doc that somehow lacks its `month` field is still in
    // the read set. The query reads every counter that EXISTS for this month whether or not its
    // provider is still in the registry, which is the M1 hole: a retired provider's accumulated
    // spend used to drop out of `used` entirely and hand that budget back.
    //
    // Neither read alone is sufficient — the doc-id read is blind to off-registry providers and
    // the query is blind to an unstamped doc — so both run, INSIDE the transaction, BEFORE any
    // write, and the results are deduplicated by document id below. F-G's property is preserved:
    // this is two RPCs regardless of how many providers the registry holds, so the round-trip
    // count still does not scale with the catalog. The query also widens Firestore's conflict
    // detection to the whole month's counter range, which is strictly MORE atomic than the
    // previous fixed doc set, not less.
    const [batched, countersSnap] = await Promise.all([
      tx.getAll(ceilingRef, ...allCounterRefs),
      tx.get(countersQuery),
    ]);
    const [ceilingSnap, ...counterSnaps] = batched;

    // ONE reader for the stored value, shared with getAiUsageSummary (Task 8 review F1/F3) —
    // never `Number(raw ?? 0)`, which turned a string into NaN and a NaN into "no ceiling", and
    // then turned "no ceiling" into "spend anything" because every NaN comparison is false.
    const resolved = resolveCeiling(ceilingSnap.data()?.monthlyCeilingILS);

    // Batch 6 (closing review B1) — READER 2 OF 3, THE ONE THAT FAILS THE GATE OPEN.
    //
    // This line was `sum + Number(snap.data()?.totalILS ?? 0)`. A single counter holding a
    // non-numeric total made `used` NaN, `used + q.estimatedILS > resolved.ceilingILS` false, and
    // the gate admitted anything: the closing review charged ₪33.75 against a ₪1 ceiling on the
    // real emulator and watched it succeed. It is F1's defect exactly, moved from the ceiling doc
    // to the counter doc — and batch 4 applied this very guard to reconcileSpend and to neither
    // of the two readers that decide whether money may be spent.
    //
    // Deduplicated by document id because the two reads above overlap on registry counters;
    // double-counting a provider would be a different, quieter wrongness.
    const totalsByCounterId = new Map<string, StoredAmountILS>();
    for (const snap of counterSnaps) {
      totalsByCounterId.set(snap.id, readStoredAmountILS(snap.data()?.totalILS));
    }
    for (const doc of countersSnap.docs) {
      totalsByCounterId.set(doc.id, readStoredAmountILS(doc.data()?.totalILS));
    }
    // 'absent' is a genuine zero (no spend on that provider this month). 'corrupt' is NOT — it is
    // an unknown, and it is collected rather than summed so the decision below can refuse instead
    // of pretending the money is not there.
    const corruptCounterIds: string[] = [];
    let usedRaw = 0;
    for (const [counterId, stored] of totalsByCounterId) {
      if (stored.status === 'corrupt') corruptCounterIds.push(counterId);
      else if (stored.status === 'ok') usedRaw += stored.amountILS;
    }
    // Family-wide, not this provider's own — the number the ceiling actually caps.
    const used = round4(usedRaw);

    // Review fix 2: a genuinely free call (metered:false AND estimatedILS<=0 — today only the
    // mock adapter, see quote() above) never touches the ceiling at all, configured or not.
    // `metered` is NOT a caller-supplied flag callers can set at will — quote() is the only
    // producer of a CostQuote, and it derives `metered` itself from the model registry (false
    // only on the literal 'mock' adapter branch, which is the SAME branch that pins
    // estimatedILS to 0). Requiring BOTH conditions here — not just `!q.metered` — closes the
    // one remaining hole even if some future caller hand-builds a CostQuote instead of calling
    // quote(): a spoofed `metered:false` with a nonzero estimatedILS still falls through to the
    // real ceiling check below, because what actually gets admitted onto the ledger/counter is
    // q.estimatedILS itself — if that's genuinely 0, exempting it moves no real money regardless
    // of who set the flag.
    //
    // This stays the FIRST condition (evaluated before anything about the ceiling) so the
    // free-call exemption survives every ceiling state — unset, invalid, or a deliberate ₪0.
    // Batch 6 (closing review M4, generalised) — the estimate must be a usable number BEFORE any
    // branch reads it. Every check below is a comparison against q.estimatedILS, and every
    // comparison with NaN is false, so a hand-built quote carrying NaN would skip the free-call
    // branch, pass the ceiling, and then be written onto the ledger and incremented into the
    // counter — creating the very corrupt counter the guard above refuses on. A negative estimate
    // is rejected for the same reason the counter has a non-negative floor: it mints budget.
    const estimateIsUsable = Number.isFinite(q.estimatedILS) && q.estimatedILS >= 0;

    const isFreeCall = estimateIsUsable && !q.metered && q.estimatedILS <= 0;

    if (!isFreeCall && !estimateIsUsable) {
      throw new ApprovalRequiredError(q, used, resolved.ceilingILS ?? 0, 'quote-invalid');
    }

    // Batch 6 (closing review B1) — A CORRUPT COUNTER REFUSES UNCONDITIONALLY, AND AN OVERAGE
    // TOKEN CANNOT OVERRIDE IT.
    //
    // Checked here, on its own, rather than folded into `wouldExceed` below, because `wouldExceed`
    // is the thing a super-admin's token is allowed to authorise — and a token cannot meaningfully
    // authorise a spend against an unknown balance. Approving "₪5 over the ceiling" presupposes
    // knowing what has been spent; when a counter is unreadable, nobody (including the approver)
    // knows that, so the approval would be consent to an amount no one can state. Refusing both
    // with and without a token is the only version that fails closed.
    //
    // It sits AFTER the free-call exemption for the reason that exemption is documented with: a
    // genuinely zero-cost mock call moves no money, so no counter state — unset, invalid, ₪0
    // ceiling, or corrupt — has any bearing on it.
    //
    // `used` is reported as the sum of the counters that WERE readable — a genuine lower bound,
    // not a claim about the month's real total. Reporting 0 here would be F1's reassuring lie in
    // miniature ("nothing has been spent") at the moment we are refusing because we cannot tell.
    if (!isFreeCall && corruptCounterIds.length > 0) {
      throw new ApprovalRequiredError(q, used, resolved.ceilingILS ?? 0, 'counter-corrupt');
    }

    // FAIL CLOSED (Task 8 review F1): 'unset' and 'invalid' both refuse. A ceiling of 0 is
    // 'configured' and refuses through the ordinary arithmetic below, as an over-ceiling spend —
    // which is what it genuinely is.
    const wouldExceed = !isFreeCall && (
      q.unknown
      || resolved.status !== 'configured'
      || used + q.estimatedILS > resolved.ceilingILS
    );

    if (wouldExceed && !approved) {
      // Distinguishable refusal reasons (review fix 2, extended by Task 8 review F1) — each maps
      // to a DIFFERENT operator action: unknown-model is a registry/config bug; unconfigured
      // means nobody has ever set a ceiling; invalid means a corrupt value is stored and must be
      // re-saved; over-ceiling is a genuine spend decision an overage token can authorise.
      const reason: ApprovalRefusalReason =
        q.unknown ? 'unknown-model'
          : resolved.status === 'unset' ? 'ceiling-unconfigured'
            : resolved.status === 'invalid' ? 'ceiling-invalid'
              : 'over-ceiling';
      // ceilingILS is reported as the stored ceiling when there is one, and 0 when there is not —
      // callers already treat this as a display figure only, never as an authorisation input.
      throw new ApprovalRequiredError(q, used, resolved.ceilingILS ?? 0, reason);
    }

    tx.set(ledgerRef, {
      providerId: q.providerId, modelId: q.modelId, action, actorMemberId, month,
      amountILS: q.estimatedILS, estimatedILS: q.estimatedILS, reconciled: false,
      approvalUsed: Boolean(approvalToken), at: FieldValue.serverTimestamp(),
    });
    // Still PER-PROVIDER (F2 keeps the breakdown intact) — only the ENFORCEMENT went global. The
    // enforced total is derived by summing exactly these counters, so the number the gate uses and
    // the numbers the screen shows cannot drift apart the way a separate global counter doc could.
    tx.set(counterRef, {
      providerId: q.providerId, month,
      totalILS: FieldValue.increment(q.estimatedILS), callCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      spent: true, amountILS: q.estimatedILS, ceilingILS: resolved.ceilingILS ?? 0,
      usedThisMonthILS: round4(used + q.estimatedILS),
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
): Promise<{ correctedAmountILS: number | null }> {
  const ledgerRef = db().collection('ai_usage').doc(ledgerId);

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (!snap.exists) return { correctedAmountILS: 0 }; // unknown id — no-op, never throws
    const data = snap.data()!;

    // Batch 6 (closing review B1) — READER 3 AND 4 OF THE LEDGER'S OWN STORED AMOUNTS. Both were
    // `Number(data.amountILS ?? data.estimatedILS ?? 0)`, i.e. B1's coercion on the money the
    // caller reports back to the client as `costILS`. `null` is returned rather than 0 for an
    // unreadable amount because 0 tells the client a paid call was free — the exact wrongness the
    // F-A note refuses two paragraphs down. The callers fall back to their own pre-call estimate,
    // which is always a real number and always the documented safe direction.
    const storedAmount = readStoredAmountILS(data.amountILS);
    const storedEstimate = readStoredAmountILS(data.estimatedILS);
    const ledgerAmountILS = storedAmount.status === 'ok' ? storedAmount.amountILS
      : storedEstimate.status === 'ok' ? storedEstimate.amountILS
        // Both absent is a genuine zero on an entry that recorded no money; either being CORRUPT
        // is an unknown, and the two must not collapse.
        : (storedAmount.status === 'absent' && storedEstimate.status === 'absent') ? 0
          : null;

    // Idempotency guard (review fix 1, D14's named retry gap) — mirrors consumeApproval's
    // `!data.used` pattern below. Guarding on the `reconciled` flag alone is SAFE here, unlike a
    // naive "check a flag, then act" pattern elsewhere, because the flag write and the counter's
    // FieldValue.increment(delta) commit inside this SAME runTransaction call: Firestore commits
    // a transaction's writes atomically or not at all, so there is no state where `reconciled`
    // reads true but the counter never moved — a crash or conflict before commit leaves BOTH the
    // flag and the counter untouched, and a retry safely redoes the full work from scratch. That
    // rules out the "first reconcile partially failed" case the brief asks about: partial is not
    // a reachable outcome of a single transaction, only all-or-nothing is. A separately-stored
    // applied-delta field would add no additional correctness guarantee on top of that atomicity
    // — so it's kept here purely as an audit trail (appliedDeltaILS below), not as the guard.
    if (data.reconciled === true) {
      return { correctedAmountILS: ledgerAmountILS };
    }

    // Task 8 review F7 — the counter ref is built from the month the spend was STAMPED with, read
    // off the ledger entry itself, NOT from monthKey() at reconcile time. A call started before
    // the Asia/Jerusalem month rollover and reconciled after it used to apply its correction to
    // the NEXT month's counter while the ledger entry stayed in the previous one, so byProvider
    // (counter) and byModel (ledger) disagreed permanently in BOTH months, side by side on the
    // settings screen with nothing flagging it.
    //
    // Review of 9ca9eea, F-A — the `|| monthKey()` fallback that used to sit here is DELETED, not
    // defended. An entry with no stamped month is now a no-op: the ledger keeps its estimate and
    // nothing is written. Reasoning, in order:
    //   1. The branch was genuinely dead. `git log -S"month: monthKey()"` shows spend() has
    //      stamped `month` on every ai_usage entry since the collection's first commit (2fefeb5),
    //      and ai_usage is `allow read, write: if false`, so no client can create an unstamped one.
    //   2. It was nonetheless the only entrance to a state the ceiling cannot defend. Reproduced
    //      before this fix: the fallback + set(merge) CREATED `ai_usage_counters/anthropic_<now>`
    //      holding totalILS -5.6216, the settings screen then showed a negative spend, and the
    //      next spend() summed that negative into `used` and admitted ₪6 against a ₪1 ceiling.
    //   3. Guessing is strictly worse than doing nothing. We cannot know which month an unstamped
    //      entry belongs to, so the fallback's "correct" behaviour was undefined — it landed the
    //      correction in whatever month happened to be current while the entry's real month kept
    //      the full estimate forever, i.e. the exact byProvider/byModel divergence F7 exists to
    //      fix, merely relocated.
    //   4. Doing nothing is the failure direction this module already documents: an unreconciled
    //      entry keeps the pre-call ESTIMATE, which over-states spend more often than it
    //      under-states it, so the ceiling stays at least as protective, never less.
    // The stored amount is still returned so the caller's `costILS` reports what the ledger
    // actually holds rather than a 0 that would tell the client a paid call was free.
    const stampedMonth = typeof data.month === 'string' && data.month ? data.month : null;
    if (stampedMonth === null) {
      return { correctedAmountILS: ledgerAmountILS };
    }

    // Review of 9ca9eea, F-B — the PROVIDER half of the same path, which F7 fixed only for the
    // month. This used to read `model.providerId`, i.e. the CALLER's argument, so a future
    // model-fallback or retry that reconciled under a different provider than it spent under
    // would subtract this entry's estimate from provider B's counter while provider A kept it —
    // putting F-A's negative phantom on a live path. Both components of the counter's identity
    // now come off the ledger entry that created the counter in the first place; the argument
    // survives only as a fallback for an entry that somehow lacks the field.
    const stampedProviderId = typeof data.providerId === 'string' && data.providerId
      ? data.providerId
      : model.providerId;
    const counterRef = db().doc(`ai_usage_counters/${stampedProviderId}_${stampedMonth}`);

    // Batch 5 — F-B'S OWN ARGUMENT, APPLIED TO THE PRICING AXIS. F-B moved the counter's IDENTITY
    // off the entry but left the PRICE behind: quote() ran above this transaction, off the
    // caller's argument, and its result became both the entry's corrected amountILS and the
    // counter's delta. That is worse than a misprice. quote() returns `unknown: true,
    // estimatedILS: 0` for any provider/model pair the registry does not hold TOGETHER, so a
    // mismatched reconcile corrected a real paid call to ZERO and handed the entry's whole
    // estimate back to the counter as headroom the ceiling would then spend.
    //
    // The quote now happens HERE, inside the transaction, from the pair the entry was actually
    // stamped with — the same pair spend() priced and wrote. The caller's argument survives only
    // as a fallback for an entry that lacks the field, exactly as with the provider above.
    //
    // This read-then-quote ordering is safe for the F-G read-before-write discipline: quote() is
    // pure arithmetic over the in-memory registry and touches no document.
    const stampedModelId = typeof data.modelId === 'string' && data.modelId
      ? data.modelId
      : model.modelId;
    const q = quote(stampedProviderId, stampedModelId, actualInputTokens, actualOutputTokens);

    // Batch 6 (closing review I2) — AN UNPRICEABLE RECONCILE LEAVES THE ESTIMATE. IT NEVER ZEROES.
    //
    // Batch 5 moved the quote inside the transaction and off the entry's own stamped pair, which
    // closed the CALLER-ARGUMENT entrance to `unknown`. The registry-removal entrance stayed open,
    // and it reaches the identical outcome: quote() returns `unknown: true, estimatedILS: 0` for
    // any pair the registry no longer holds together, so retiring a model between a spend and its
    // reconcile corrected a real ₪1.35 call to ZERO, drove its counter to 0, and handed the whole
    // estimate back as headroom the ceiling would then spend again. Proven by the closing review.
    //
    // The fix is this module's own F-A reasoning applied one level up: when we cannot price
    // something, doing nothing beats guessing, and 0 is the single worst guess available because
    // it is indistinguishable from "this call was free". The entry keeps its estimate, stays
    // unreconciled, the counter is untouched — the documented safe failure direction, which
    // over-states spend rather than under-stating it. `ledgerAmountILS` (not 0, not q.estimatedILS)
    // is returned so the caller's costILS reports what the ledger actually holds.
    if (q.unknown) {
      return { correctedAmountILS: ledgerAmountILS };
    }

    // Batch 6 (closing review B1) — READER 5, AND THE ONE THAT MANUFACTURES B1'S OWN INPUT.
    //
    // This was `Number(data.estimatedILS ?? data.amountILS ?? 0)`. A corrupt stored estimate made
    // `prior` NaN, therefore `delta` NaN, therefore `Math.max(0, priorTotal + NaN)` NaN — and
    // Firestore stores NaN as a real double, so this function WROTE the unreadable counter total
    // that spend() then fails open on. reconcileSpend defended itself against a corrupt counter
    // (batch 4, `priorTotal` below) while remaining able to create one. That is why "fix all the
    // symmetric readers as a set" is the rule and not a preference.
    //
    // Unreadable prior means the delta is undefined, so this is a no-op on the same F-A grounds as
    // the unpriceable case above. The freshly computed cost IS returned, because unlike that case
    // we genuinely know what this call cost — we just cannot say how much of the counter is
    // already attributable to it.
    const priorRead = readStoredAmountILS(data.estimatedILS ?? data.amountILS);
    if (priorRead.status === 'corrupt') {
      return { correctedAmountILS: q.estimatedILS };
    }
    const prior = priorRead.amountILS ?? 0;
    const delta = round4(q.estimatedILS - prior); // "estimatedILS" from quote() here IS the actual cost — same formula, real token counts

    // Review of 9ca9eea, F-A (second half) — a monthly counter is a cumulative spend total, so a
    // NEGATIVE value is not merely odd, it is budget the ceiling then hands out: spend() sums the
    // per-provider counters into `used`, so a counter at -5.62 is ₪5.62 of phantom headroom above
    // whatever ceiling is configured. FieldValue.increment cannot be clamped, so the correction is
    // applied as a transactional read-modify-write instead: this tx.get sits BEFORE every write in
    // this transaction (the same discipline spend() follows), and Firestore's conflict detection on
    // the read makes the computed write exactly as atomic as an increment would have been — a
    // concurrent reconcile of the same counter conflicts and retries against fresh state.
    //
    // Deleting the F-A fallback above already closes the only reachable entrance, and F-B closes
    // the future one. This floor is deliberate defence in depth on the invariant itself, so the
    // undefendable state stays unreachable no matter which entrance a later change opens: an
    // out-of-band counter deletion, a restored backup, or an ai_usage writer that is not spend().
    // It bites only in states that are already inconsistent — when the counter genuinely contains
    // this entry's own estimate, `priorTotal + delta` cannot go below that entry's real cost.
    const counterSnap = await tx.get(counterRef);
    // Never `Number(raw ?? 0)` — the same coercion that turned a corrupt ceiling into NaN and NaN
    // into "spend anything" (Task 8 review F1). This is the shared readStoredAmountILS, so the
    // four other readers cannot drift from it.
    const counterRead = readStoredAmountILS(counterSnap.data()?.totalILS);

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // CLOSING REVIEW B-iii — A CORRUPT COUNTER IS LEFT ALONE. HEALING IT DISCARDED REAL SPEND.
    //
    // Batch 6 recorded this branch as "corrupt reads as 0, floored — defence in depth on the
    // non-negative invariant, not a load-bearing decision". It was load-bearing, and in the wrong
    // direction. Reproduced by the closing review: counter at ₪60 of admitted spend, corrupted
    // out of band, spend() correctly refusing every paid call with `counter-corrupt` — and then
    // this line read the unknown balance as an EMPTY one and wrote ₪0.0012 back. ~₪60 of real
    // spend handed to the budget, and the next call admitted against a ₪100 ceiling with `used`
    // reading ₪0.0799. No signal anywhere: the loud fail-CLOSED state became a quiet fail-OPEN one.
    //
    // This module already argues the correct answer twice — at F-A above, and at I2 fifteen lines
    // up: when a value cannot be stated, DOING NOTHING BEATS GUESSING, and 0 is the single worst
    // guess available because it is indistinguishable from "there was nothing here". Both of the
    // branches immediately above (unpriceable pair, unreadable stored estimate) already return
    // without touching anything. This is their sibling and should always have been written as one.
    //
    // ABSENT is NOT corrupt and deliberately still falls through to `priorTotal = 0`: a counter
    // that does not exist genuinely holds nothing, and the tx.set/merge below is what creates it
    // on the first-of-the-month rollover path F7's second half exists for.
    //
    // The freshly computed cost IS returned, exactly as in the corrupt-estimate case above: we
    // know what this call cost, we just cannot say how much of the counter already reflects it.
    // The entry stays unreconciled and keeps its estimate — over-stating spend, never under-.
    // ─────────────────────────────────────────────────────────────────────────────────────────
    if (counterRead.status === 'corrupt') {
      return { correctedAmountILS: q.estimatedILS };
    }

    const priorTotal = counterRead.amountILS ?? 0;
    const nextTotal = round4(Math.max(0, priorTotal + delta));

    tx.update(ledgerRef, {
      amountILS: q.estimatedILS, actualILS: q.estimatedILS, reconciled: true,
      appliedDeltaILS: delta, // audit trail only — see comment above; NOT what the guard checks
      reconciledAt: FieldValue.serverTimestamp(),
    });
    // tx.set/merge, NOT tx.update — the second-order half of Task 8 review F7. Firestore's
    // tx.update FAILS on a document that does not exist, so pointing the correction at the
    // stamped month would abort the entire reconcile whenever that month's counter was never
    // created (a first-of-the-month spend reconciled after rollover, or any counter deleted
    // between spend and reconcile), leaving the ledger entry permanently unreconciled and the
    // paid call's real cost never recorded. set/merge creates-or-updates instead, and the
    // correction stays atomic either way — see the read-modify-write note above for why writing
    // the computed `nextTotal` is as atomic here as FieldValue.increment was.
    //
    // Idempotency is UNAFFECTED by that change: the `reconciled` guard above and this write
    // commit inside the SAME runTransaction, so a retry either sees reconciled:true and returns
    // without touching the counter, or sees the untouched pre-commit state and redoes the whole
    // correction from scratch. There is no state where the flag is set but the counter never
    // moved, and none where the counter moved twice.
    tx.set(counterRef, {
      providerId: stampedProviderId, month: stampedMonth,
      totalILS: nextTotal, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { correctedAmountILS: q.estimatedILS };
  });
}

/**
 * Batch 6 (closing review M2) — AN APPROVAL TOKEN IS NOW BOUND TO WHAT WAS APPROVED.
 *
 * This matched only providerId + TTL + unused. requestOverageApproval writes `estimatedILS` and
 * `modelId` onto the token document and NOTHING read either of them, so a super-admin who
 * approved ₪1 on Claude Sonnet had in fact authorised any amount, on any Anthropic model, for the
 * next 120 seconds. A stored field that is written and never read is not an approval record, it
 * is a comment — the same shape as the guards this stage's mutation sweep found comment-satisfiable.
 *
 * The closing review marked this inert because the redemption path (B4) is structurally dead. It
 * is closed FIRST rather than alongside that path, because the alternative is shipping the two
 * halves of the feature in an order where the authorising half is briefly meaningless — and
 * "inert today" is how the F4 role-gate hole was allowed to exist too.
 *
 * `<=`, not `===`: a token authorises UP TO the approved amount. Equality would be brittle
 * against a re-quote between approval and redemption (a user editing their message re-estimates
 * the input tokens), and would fail in the SAFE direction only half the time — a cheaper call
 * being refused is an annoyance, but the exact-match rule gives no headroom in either direction
 * and would push callers toward retry loops. A ceiling on the token is the property that matters.
 *
 * modelId is matched for the identical reason the amount is: it is stored, it describes what was
 * approved, and models within one provider differ in price by 5x in this very registry.
 */
async function consumeApproval(token: string, q: CostQuote): Promise<boolean> {
  const ref = db().doc(`ai_overage_approvals/${token}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data()!;
    // The approved amount goes through the same reader as every other stored ₪ figure (B1): a
    // corrupt `estimatedILS` on the token must NOT coerce to NaN, because `q.estimatedILS <= NaN`
    // is false — which happens to fail closed here, but only by accident of which way the
    // comparison points, and that is exactly how B1 came to exist.
    const approvedAmount = readStoredAmountILS(data.estimatedILS);
    const withinApprovedAmount =
      approvedAmount.status === 'ok'
      && Number.isFinite(q.estimatedILS)
      && q.estimatedILS <= approvedAmount.amountILS;
    const ok = !data.used
      && data.providerId === q.providerId
      && data.modelId === q.modelId
      && withinApprovedAmount
      && data.expiresAt > Date.now();
    tx.update(ref, { used: true }); // single-use regardless of match outcome — mirrors paid_calls.py's approve()
    return ok;
  });
}

function round4(n: number) { return Math.round(n * 10000) / 10000; }
