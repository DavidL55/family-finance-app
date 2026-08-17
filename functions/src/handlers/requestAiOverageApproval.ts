import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requestOverageApproval, quote } from '../costGate/costGate';
import type { PermissionRole } from '../shared/permissions';
import type { RequestAiOverageApprovalRequest, RequestAiOverageApprovalResponse } from './types';

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
    const { providerId, modelId, estimatedInputTokens, estimatedOutputTokens } = request.data;
    const q = quote(providerId, modelId, estimatedInputTokens, estimatedOutputTokens);
    return requestOverageApproval(memberId, 'super-admin', providerId, q);
  }
);
