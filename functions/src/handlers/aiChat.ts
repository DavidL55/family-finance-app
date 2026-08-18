import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { buildFinancialContext } from '../context/buildFinancialContext';
import { buildSystemPrompt, wrapExternalData } from '../promptSafety';
import { getAdapterForModel } from '../providers/registry';
import { quote, spend, reconcileSpend, ApprovalRequiredError } from '../costGate/costGate';
import { toAiHttpsError } from '../providers/providerErrors';
import type { PermissionRole } from '../shared/permissions';
import type { AiFilterScope } from '../context/types';
import type { AiChatRequest, AiChatResponse, AiCostRefusalDetails } from './types';
import {
  badShape, readPayload, readNestedObject, readString, readNonEmptyString,
  readOptionalString, readObjectArray, readStringArray,
} from './requestShape';

const KNOWN_ROLES: PermissionRole[] = ['super-admin', 'parent', 'member'];

// Fix 1 (review follow-up, Important) — `history` was previously unconstrained: no protection on
// the always-free mock path (nothing there is gated behind the cost estimate), no guard against
// blowing the model's context window before the pre-call cost estimate would even see the
// problem, and no protection for the unbounded `arrayUnion` write into `chat_sessions` against
// Firestore's 1MB document ceiling. Same shape as D17's `MAX_DOCUMENT_BASE64_BYTES`
// (aiExtractDocument.ts) — a named constant, checked FIRST, before buildFinancialContext /
// quote() / spend() / any adapter call, so an oversized request never reaches a provider and
// never costs anything.
//
// TWO independent caps, because they guard two independent failure modes a single number can't
// both cover: many TINY turns inflate chat_sessions via per-message JSON-key overhead
// (role/text/at/providerId/modelId keys) even when the total conversational TEXT is small — the
// turn-count cap catches that. A few HUGE turns blow up the model's context window and the same
// Firestore document even when turn count is small — the byte cap catches that.
export const MAX_CHAT_HISTORY_TURNS = 60;
// Measured in UTF-8 BYTES, not JS string length — this app is Hebrew-first, and Hebrew
// characters are 2 bytes each in UTF-8, so a character-length cap would silently allow roughly
// double the real payload Firestore actually stores. ~200KB leaves >5x headroom under
// Firestore's 1MB document ceiling once JSON/metadata overhead and this turn's own
// message/response (which this cap does NOT bound — see the persistence try/catch below) are
// added.
export const MAX_CHAT_HISTORY_BYTES = 200 * 1024;

/**
 * Batch 8 (closing review B4) — the flat output-token guess quote() is sized with, NAMED.
 *
 * It was an inline `400` at the single quote() call site. It is now read twice — once to price the
 * call, once to tell a refused caller what to request an overage approval FOR — and two literals
 * that must agree is exactly how a token gets minted for an amount the retry then re-quotes past.
 */
export const CHAT_OUTPUT_TOKEN_ESTIMATE = 400;

const HISTORY_TOO_LONG_MESSAGE_HE =
  'היסטוריית השיחה ארוכה מדי להמשך בשיחה זו — התחל שיחה חדשה כדי להמשיך.';

/**
 * D16's filter slice. Validated rather than trusted because it is DISCLOSED TO THE MODEL
 * VERBATIM: memberIds.length and period.month/year are read straight into scopeDisclosure, so a
 * malformed scope becomes a false statement in the system prompt about what the answer covers.
 *
 * `memberIds: null` is the real "no filter" value, not an omission — the same convention every
 * owned-collection consumer in this app already uses — so it is accepted explicitly and an ABSENT
 * memberIds is refused.
 */
function readFilterScope(data: Record<string, unknown>): AiFilterScope {
  const scope = readNestedObject(data, 'filterScope');
  const memberIds = scope.memberIds === null ? null : readStringArray(scope, 'memberIds');
  const period = readNestedObject(scope, 'period');
  return {
    memberIds,
    period: { month: readNonEmptyString(period, 'month'), year: readNonEmptyString(period, 'year') },
  };
}

export function readChatRequest(data: unknown): AiChatRequest {
  const d = readPayload(data);
  return {
    // sessionId is a Firestore document path segment (chat_sessions/<id>); '' or '   ' is not one.
    sessionId: readNonEmptyString(d, 'sessionId'),
    // message may legitimately be '' — the handler has never refused an empty question, and this
    // guard exists to stop crashes, not to quietly tighten a contract it was not asked to change.
    message: readString(d, 'message'),
    modelId: readNonEmptyString(d, 'modelId'),
    // ACCEPTANCE RE-MEASURE — the shape guard `history.reduce(...)` never had.
    //
    // Written INLINE as a `.map()` callback over a `history` receiver rather than extracted to a
    // named helper, and that is a real constraint rather than a style choice: the D2/D8
    // regression guard (src/__tests__/aiPermissionsContract.test.ts) refuses every `.role` read
    // in functions/src that is not on a verified token, and its single structural carve-out is
    // exactly this shape — the access on the direct parameter of a `.map()` whose receiver names
    // messages/history, i.e. a conversation turn, which has nothing to do with PermissionRole.
    // A named `readChatTurn(v: unknown)` helper trips that guard, and the two ways out of it were
    // to weaken the guard or to launder the read through something it cannot follow. Both are
    // worse than writing the read in the shape the guard already recognises.
    //
    // `role` is checked against the literal union because the adapters BRANCH on it; `text`
    // because the byte cap below used to read `String(m?.text ?? '')` — a coercion under which a
    // turn carrying no text measured as zero bytes, cleared the cap, and reached the model as the
    // string "undefined". Both caps are only as honest as the shape they measure.
    history: readObjectArray(d, 'history').map((turn) => {
      const speaker = turn.role;
      if (speaker !== 'user' && speaker !== 'model') throw badShape('history');
      if (typeof turn.text !== 'string') throw badShape('history');
      return { role: speaker, text: turn.text };
    }),
    filterScope: readFilterScope(d),
    approvalToken: readOptionalString(d, 'approvalToken'),
  };
}

/**
 * D8 — the first real consumer of buildFinancialContext, and the one that proves the context
 * builder only ever sees what the requesting member's own VERIFIED role (the custom-claim token,
 * never the member document's family-relationship field) allows. `role` below is read exactly
 * once, off `request.auth.token.role`, and threaded straight through — never re-derived.
 */
export const aiChat = onCall<AiChatRequest, Promise<AiChatResponse>>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
  const role = request.auth.token.role as PermissionRole | undefined;
  if (!role || !KNOWN_ROLES.includes(role)) {
    // An account with no provisioned role claim yet must not be able to spend shared AI budget
    // (Sasha W10) — auth != null alone is not a sufficient guard.
    throw new HttpsError('permission-denied', 'החשבון עדיין לא שויך לתפקיד — פנה לסופר-אדמין');
  }
  const memberId = request.auth.token.memberId as string;
  // Validated BEFORE getAdapterForModel / buildFinancialContext / quote() / spend(), for the same
  // reason D17's size guard is first in aiExtractDocument: a request that cannot succeed must not
  // read the family's finances or cost anything on its way to being refused.
  const { sessionId, message, modelId, history, filterScope, approvalToken } =
    readChatRequest(request.data);

  // Task 7 review, Important 1 — the action tag is verified SERVER-SIDE, before the context read
  // and before quote()/spend(). Same gap, same fix, same required-`action` argument as
  // aiExtractDocument.ts; see getAdapterForModel's own header for why the check lives in the
  // registry rather than being duplicated in each handler.
  const found = getAdapterForModel(modelId, 'chat');
  if (!found.ok) throw new HttpsError('invalid-argument', found.messageHe, { reason: found.reason });

  // Fix 1 — checked before ANY cost-gate or adapter work, unconditionally (including on the
  // always-free mock model — see the constants' own comments above for why two independent caps).
  // `m.text`, not `String(m?.text ?? '')`: readChatRequest has already PROVEN every turn carries a
  // string, so the coercion is no longer load-bearing — and leaving it would keep implying the cap
  // can measure a shape it never could.
  const historyBytes = history.reduce((n, m) => n + Buffer.byteLength(m.text, 'utf8'), 0);
  if (history.length > MAX_CHAT_HISTORY_TURNS || historyBytes > MAX_CHAT_HISTORY_BYTES) {
    throw new HttpsError('invalid-argument', HISTORY_TOO_LONG_MESSAGE_HE);
  }

  // role is the VERIFIED token claim above — buildFinancialContext never re-derives it (D8 fix,
  // the critical defect both review lenses found in the pre-review draft). filterScope is the
  // resolved global מי/מתי filter (D16, third-lens M3) — threaded straight through, not re-derived.
  const ctx = await buildFinancialContext(memberId, role, filterScope);

  // D16 — states the covered scope to the model EXPLICITLY, including the honest disclosure that
  // this stage's recurring-based facts don't vary by the period axis yet (see the plan's D16
  // discussion for why: there is no per-month recurring-actuals collection to filter by).
  const memberScopeLabel = ctx.filterScope.memberIds === null
    ? 'כל בני המשפחה (ללא סינון)'
    : `בני משפחה נבחרים (${ctx.filterScope.memberIds.length})`;
  const scopeDisclosure =
    `היקף הסינון שהמשתמש בחר במסך: בני משפחה — ${memberScopeLabel}; תקופה — ${ctx.filterScope.period.month}/${ctx.filterScope.period.year}. ` +
    'שים לב: הסכומים החודשיים המוצגים (הוצאות והכנסות קבועות) משקפים פריטים חוזרים הפעילים כרגע, ' +
    'ולא נתונים היסטוריים מסוננים לפי התקופה שנבחרה. אם המשתמש שואל על נתון היסטורי לתקופה ספציפית, ' +
    'ציין זאת במפורש במקום להניח שהמספר שסופק תואם לתקופה.';

  const baseSystem = ctx.scope === 'none'
    ? 'אתה עוזר פיננסי למשפחה. למשתמש הזה אין הרשאה לראות נתונים פיננסיים — סרב בנימוס לכל שאלה על כסף, מבלי לחשוף מספרים.'
    : `אתה עוזר פיננסי למשפחה. ${scopeDisclosure}\nהנתונים הזמינים לך (בהיקף ${ctx.scope === 'family' ? 'משפחתי' : 'אישי'}):\n` +
      // ONLY the server-assembled context is external_data (D6 scoping fix, Sasha I5) — it is a
      // database read the user did not write. The user's own message/history below is never
      // wrapped; wrapping it would falsely tell the model the user's own question "was not
      // written by the user."
      wrapExternalData(JSON.stringify(ctx));
  const systemPrompt = buildSystemPrompt(baseSystem);

  // Full conversation, oldest first, ending with this turn — plain text, unwrapped. `history` is
  // what THIS aiChat handler itself persisted on prior turns, not third-party content, so trusting
  // it as ordinary conversation is correct, not a new injection surface.
  const messages = [...history, { role: 'user' as const, text: message }];

  const estIn = Math.ceil((systemPrompt.length + messages.reduce((n, m) => n + m.text.length, 0)) / 4);
  const q = quote(found.model.providerId, modelId, estIn, CHAT_OUTPUT_TOKEN_ESTIMATE);
  let spendResult;
  try {
    // Batch 8 (closing review B4) — spec §8's redemption half, which shipped with only its refusal
    // half: once the ceiling was hit, paid AI was blocked permanently with no path forward. The
    // token is forwarded VERBATIM and interpreted nowhere but costGate.consumeApproval, which
    // binds it to providerId, modelId, an amount ceiling and a 120s TTL, and consumes it exactly
    // once (bd97326). Nothing here decides whether it is valid — this handler must not become a
    // second, weaker copy of that decision.
    spendResult = await spend(memberId, 'chat', q, approvalToken);
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      // Rethrown as a real HttpsError (D4 fix, Sasha I4) — a plain Error thrown from an onCall
      // handler is redacted to a generic 'internal' by the Functions runtime, which would have
      // silently swallowed the Hebrew "נדרש אישור"/"טרם הוגדרה תקרה" refusal the Done Criteria
      // require the client to actually see. `err.reason` (Task 3 fix) keeps "no ceiling
      // configured yet" and "over budget" as genuinely DIFFERENT messages here — err.message
      // already encodes that distinction (ApprovalRequiredError's own constructor), so it is
      // propagated verbatim rather than collapsed into one generic string.
      // Batch 8 (closing review B4) — the estimate INPUTS travel with the refusal, not just the ₪
      // figure they produced. A client that has been refused with 'over-ceiling' needs to mint an
      // approval sized for THIS call, and it cannot recompute `estIn`: that number covers the
      // system prompt and the server-assembled financial context, neither of which the client can
      // see. A client-side guess would mint a token for less than the retry re-quotes, and
      // consumeApproval's `<=` amount ceiling would refuse the redemption while still burning the
      // single-use token. Echoing these back to requestAiOverageApproval keeps the SERVER the only
      // thing that ever turns tokens into money — the client passes counts, never a ₪ amount.
      const details: AiCostRefusalDetails = {
        quote: err.quote, usedThisMonthILS: err.usedThisMonthILS, ceilingILS: err.ceilingILS, reason: err.reason,
        estimatedInputTokens: estIn, estimatedOutputTokens: CHAT_OUTPUT_TOKEN_ESTIMATE,
      };
      throw new HttpsError('resource-exhausted', err.message, details);
    }
    throw err;
  }

  // The adapter call is the one genuinely unpredictable network hop in this handler (third-lens
  // M2/D14) — wrapped so a 429/timeout/context-overflow/decommissioned-model/non-JSON response
  // reaches the client as an actionable Hebrew HttpsError instead of onCall's generic 'internal'
  // redaction, and so a failed call is provably distinguishable from a successful one for the
  // reconcileSpend decision right below it.
  let result;
  try {
    result = await found.adapter.generateText({ systemPrompt, messages, modelId });
  } catch (err) {
    // Deliberately does NOT call reconcileSpend here — the pre-call ESTIMATE stands for a failed
    // call (D14: over-states spend rather than under-states it, so the ceiling stays at least as
    // protective as before, never less).
    throw toAiHttpsError(err, 'chat', role);
  }

  // Corrects the ledger entry spend() already wrote, using the adapter's REAL token counts —
  // never re-runs the ceiling admission decision, only the accuracy of the record (D14). The
  // corrected amount is also what's returned to the client below, so the "cost of this answer"
  // badge reflects the real spend rather than the pre-call estimate the ceiling was gated on.
  let costILS = q.estimatedILS;
  if (spendResult.ledgerId) {
    const reconciled = await reconcileSpend(spendResult.ledgerId, result.inputTokens, result.outputTokens, {
      providerId: found.model.providerId, modelId,
    });
    // Batch 6 (closing review I2/B1) — reconcileSpend returns null when it cannot state the cost:
    // an unpriceable pair (the stamped model has left the registry) or an unreadable stored amount.
    // Falling back to the pre-call estimate reports a real number instead of a 0 that would tell
    // the client a paid call was free — the same safe direction the module documents for a ledger
    // entry that never gets reconciled at all.
    costILS = reconciled.correctedAmountILS ?? q.estimatedILS;
  }

  // Keyed by the VERIFIED caller's memberId in the document PATH, not merely a field on a
  // client-supplied sessionId doc (Sun W9 fix) — a future history-browsing UI's "list my own
  // sessions" is then a structurally-guaranteed subcollection query, not a convention a client
  // could ever be trusted to enforce itself.
  try {
    await getFirestore().doc(`chat_sessions/${memberId}/sessions/${sessionId}`).set({
      memberId, updatedAt: FieldValue.serverTimestamp(),
      messages: FieldValue.arrayUnion(
        { role: 'user', text: message, at: new Date().toISOString() },
        { role: 'model', text: result.text, providerId: found.model.providerId, modelId, at: new Date().toISOString() },
      ),
    }, { merge: true });
  } catch (err) {
    // Fix 1 — the history cap above bounds PRIOR turns, but not this turn's own `message` /
    // `result.text`, so chat_sessions' Firestore document can still, in a residual edge case,
    // exceed the 1MB ceiling. By this point spend() has already been reconciled to the REAL
    // cost — the user has genuinely paid for and received a valid answer. Losing that answer
    // because a SIDE EFFECT (persisting it for a not-yet-built history-browsing UI) failed
    // would be strictly worse than losing the persistence: log it and still return the answer,
    // rather than letting onCall redact this to a generic 'internal' error that discards a
    // successful, already-billed response.
    console.error('aiChat: failed to persist chat_sessions turn', { memberId, sessionId, err });
  }

  return { text: result.text, providerId: found.model.providerId, modelId, costILS };
});
