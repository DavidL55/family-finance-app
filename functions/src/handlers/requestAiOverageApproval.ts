import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requestOverageApproval, quote } from '../costGate/costGate';
import type { PermissionRole } from '../shared/permissions';
import type { RequestAiOverageApprovalRequest, RequestAiOverageApprovalResponse } from './types';
import { readPayload, readNonEmptyString, readTokenCount } from './requestShape';

/**
 * ACCEPTANCE RE-MEASURE — the third callable that destructured request.data unchecked, and the
 * one where the gap DEFEATED THE GUARD DIRECTLY BELOW IT rather than merely crashing.
 *
 * The `q.unknown` refusal in the handler exists because you cannot mint an approval for an amount
 * nobody can state. A non-numeric token count never trips it: quote() is pricing a pair the
 * registry DOES hold together, so `unknown` is false, and only the arithmetic goes wrong —
 * estimatedILS becomes NaN and a real single-use token is minted bound to it. consumeApproval's
 * `amount <= NaN` is false, so the result is a token that looks granted, cannot be redeemed, and
 * is consumed on first use anyway: the precise outcome bd97326 and that refusal were written to
 * make unreachable.
 *
 * Validated BEFORE quote(), so nothing is priced on numbers that cannot be priced.
 */
function readOverageApprovalRequest(data: unknown): RequestAiOverageApprovalRequest {
  const d = readPayload(data);
  return {
    providerId: readNonEmptyString(d, 'providerId'),
    modelId: readNonEmptyString(d, 'modelId'),
    estimatedInputTokens: readTokenCount(d, 'estimatedInputTokens'),
    estimatedOutputTokens: readTokenCount(d, 'estimatedOutputTokens'),
  };
}

// Sasha I7 — the callable that was missing entirely from the pre-review draft: requestOverageApproval
// was designed inside costGate.ts but no task ever exposed it, so once the ceiling was hit there
// was no path to approve an overage at all, even with a super-admin standing right there. This
// onCall wrapper checks role from the VERIFIED token custom claim, never from request.data (D4's
// automated-callers-can-never-self-approve rule), and sources the approving member id the same
// verified way — an approval minted for someone other than the actual caller would defeat the
// whole point of the guard.
export const requestAiOverageApproval = onCall<RequestAiOverageApprovalRequest, Promise<RequestAiOverageApprovalResponse>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
    const role = request.auth.token.role as PermissionRole | undefined;
    if (role !== 'super-admin') throw new HttpsError('permission-denied', 'רק סופר-אדמין יכול לאשר חריגה מהתקרה');
    // memberId comes from the VERIFIED token, never from request.data.
    const memberId = request.auth.token.memberId as string;
    const { providerId, modelId, estimatedInputTokens, estimatedOutputTokens } =
      readOverageApprovalRequest(request.data);
    const q = quote(providerId, modelId, estimatedInputTokens, estimatedOutputTokens);
    // Batch 8 (closing review B4) — REFUSE TO MINT AN APPROVAL FOR AN AMOUNT WE CANNOT STATE.
    //
    // quote() returns `unknown: true, estimatedILS: 0` for any provider/model pair the registry
    // does not hold together. Minting on that would write a token whose stored estimatedILS is 0,
    // and consumeApproval's `<=` check would then authorise only a ₪0 call — a token that looks
    // granted, cannot be redeemed, and is consumed on first use anyway. Worse, it is the same
    // shape bd97326 refused for a corrupt counter: you cannot authorise an amount nobody can
    // state. Fail here, with copy that names the actual problem.
    if (q.unknown) {
      throw new HttpsError('invalid-argument', 'לא ניתן לתמחר את הקריאה הזו — הספק או המודל אינם מוכרים למערכת, ולכן אי אפשר לאשר חריגה עבורה.');
    }
    const { token, expiresAt } = await requestOverageApproval(memberId, 'super-admin', providerId, q);
    // The amount the token was ACTUALLY minted for, so the approving screen states the figure the
    // server agreed to rather than the one it happened to be showing a moment earlier. The client
    // never sends a ₪ amount — it echoes the token counts the refusal handed it, and this is the
    // server's own re-derivation of what that costs.
    return { token, expiresAt, approvedAmountILS: q.estimatedILS };
  }
);
