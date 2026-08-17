import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { CostQuote, SpendResult, ApprovalRefusalReason, ResolvedCeiling, CeilingStatus } from './types';
import { ApprovalRequiredError, resolveCeiling, MAX_MONTHLY_CEILING_ILS } from './types';
import { findModelEntry, listProviderIds } from '../providers/registry';
import { EXCHANGE_RATE } from '../providers/exchangeRate';

export { ApprovalRequiredError, resolveCeiling, MAX_MONTHLY_CEILING_ILS };
export type { CostQuote, SpendResult, ApprovalRefusalReason, ResolvedCeiling, CeilingStatus };

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

export async function monthToDateILS(providerId: string): Promise<number> {
  const snap = await db().doc(`ai_usage_counters/${providerId}_${monthKey()}`).get();
  return Number(snap.data()?.totalILS ?? 0);
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

  const month = monthKey();
  const counterRef = db().doc(`ai_usage_counters/${q.providerId}_${month}`);
  const ledgerRef = db().collection('ai_usage').doc(randomUUID());
  const ceilingRef = db().doc('settings/aiCostConfig');
  // Task 8 review F2 — EVERY provider's counter for this month, because the ceiling is one
  // family-wide number. `q.providerId` is unioned in defensively: a quote for a provider that has
  // since left the registry must still be counted, never quietly exempted.
  const allProviderIds = Array.from(new Set([...listProviderIds(), q.providerId]));
  const allCounterRefs = allProviderIds.map((id) => db().doc(`ai_usage_counters/${id}_${month}`));

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
    const [ceilingSnap, ...counterSnaps] = await tx.getAll(ceilingRef, ...allCounterRefs);

    // ONE reader for the stored value, shared with getAiUsageSummary (Task 8 review F1/F3) —
    // never `Number(raw ?? 0)`, which turned a string into NaN and a NaN into "no ceiling", and
    // then turned "no ceiling" into "spend anything" because every NaN comparison is false.
    const resolved = resolveCeiling(ceilingSnap.data()?.monthlyCeilingILS);
    // Family-wide, not this provider's own — the number the ceiling actually caps.
    const used = round4(counterSnaps.reduce((sum, snap) => sum + Number(snap.data()?.totalILS ?? 0), 0));

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
    const isFreeCall = !q.metered && q.estimatedILS <= 0;
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
): Promise<{ correctedAmountILS: number }> {
  const ledgerRef = db().collection('ai_usage').doc(ledgerId);

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (!snap.exists) return { correctedAmountILS: 0 }; // unknown id — no-op, never throws
    const data = snap.data()!;

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
      return { correctedAmountILS: Number(data.amountILS ?? data.estimatedILS ?? 0) };
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
      return { correctedAmountILS: Number(data.amountILS ?? data.estimatedILS ?? 0) };
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

    const prior = Number(data.estimatedILS ?? data.amountILS ?? 0);
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
    const rawTotal = counterSnap.data()?.totalILS;
    // Never `Number(raw ?? 0)` — the same coercion that turned a corrupt ceiling into NaN and NaN
    // into "spend anything" (Task 8 review F1). A non-numeric stored total reads as 0, not NaN.
    const priorTotal = typeof rawTotal === 'number' && Number.isFinite(rawTotal) ? rawTotal : 0;
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
