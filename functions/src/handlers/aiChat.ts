import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { buildFinancialContext } from '../context/buildFinancialContext';
import { buildSystemPrompt, wrapExternalData } from '../promptSafety';
import { getAdapterForModel } from '../providers/registry';
import { quote, spend, reconcileSpend, ApprovalRequiredError } from '../costGate/costGate';
import { toAiHttpsError } from '../providers/providerErrors';
import type { PermissionRole } from '../shared/permissions';
import type { AiChatRequest, AiChatResponse } from './types';

const KNOWN_ROLES: PermissionRole[] = ['super-admin', 'parent', 'member'];

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
  const { sessionId, message, modelId, history, filterScope } = request.data;

  const found = getAdapterForModel(modelId);
  if (!found) throw new HttpsError('invalid-argument', 'מודל לא מוכר');

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
  const q = quote(found.model.providerId, modelId, estIn, 400);
  let spendResult;
  try {
    spendResult = await spend(memberId, 'chat', q);
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      // Rethrown as a real HttpsError (D4 fix, Sasha I4) — a plain Error thrown from an onCall
      // handler is redacted to a generic 'internal' by the Functions runtime, which would have
      // silently swallowed the Hebrew "נדרש אישור"/"טרם הוגדרה תקרה" refusal the Done Criteria
      // require the client to actually see. `err.reason` (Task 3 fix) keeps "no ceiling
      // configured yet" and "over budget" as genuinely DIFFERENT messages here — err.message
      // already encodes that distinction (ApprovalRequiredError's own constructor), so it is
      // propagated verbatim rather than collapsed into one generic string.
      throw new HttpsError('resource-exhausted', err.message, {
        quote: err.quote, usedThisMonthILS: err.usedThisMonthILS, ceilingILS: err.ceilingILS, reason: err.reason,
      });
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
    throw toAiHttpsError(err, 'chat');
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
    costILS = reconciled.correctedAmountILS;
  }

  // Keyed by the VERIFIED caller's memberId in the document PATH, not merely a field on a
  // client-supplied sessionId doc (Sun W9 fix) — a future history-browsing UI's "list my own
  // sessions" is then a structurally-guaranteed subcollection query, not a convention a client
  // could ever be trusted to enforce itself.
  await getFirestore().doc(`chat_sessions/${memberId}/sessions/${sessionId}`).set({
    memberId, updatedAt: FieldValue.serverTimestamp(),
    messages: FieldValue.arrayUnion(
      { role: 'user', text: message, at: new Date().toISOString() },
      { role: 'model', text: result.text, providerId: found.model.providerId, modelId, at: new Date().toISOString() },
    ),
  }, { merge: true });

  return { text: result.text, providerId: found.model.providerId, modelId, costILS };
});
