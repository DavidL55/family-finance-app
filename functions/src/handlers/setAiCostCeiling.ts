import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { PermissionRole } from '../shared/permissions';
import type { SetAiCostCeilingRequest } from './types';

/**
 * D4 — super-admin only, enforced here AND (the real boundary, since the Admin SDK bypasses
 * Rules entirely) in firestore.rules's `settings/{docId}` write branch. Writes
 * `settings/aiCostConfig.monthlyCeilingILS` and an `audit_log` entry in the SAME batch, mirroring
 * `PermissionsService.saveModulePermissions`'s same-batch-audit convention — an audit entry can
 * never exist without the write it describes, or vice versa.
 */
export const setAiCostCeiling = onCall<SetAiCostCeilingRequest, Promise<{ ok: true }>>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
  const role = request.auth.token.role as PermissionRole | undefined;
  if (role !== 'super-admin') throw new HttpsError('permission-denied', 'רק סופר-אדמין יכול לקבוע את תקרת ה-AI');
  // memberId comes from the VERIFIED token, never from request.data (same anti-spoof precedent as
  // requestAiOverageApproval.ts).
  const memberId = request.auth.token.memberId as string;

  const monthlyCeilingILS = Number(request.data?.monthlyCeilingILS);
  if (!Number.isFinite(monthlyCeilingILS) || monthlyCeilingILS < 0) {
    throw new HttpsError('invalid-argument', 'תקרה חייבת להיות מספר אי-שלילי');
  }

  const db = getFirestore();
  const batch = db.batch();
  batch.set(db.doc('settings/aiCostConfig'), {
    monthlyCeilingILS, updatedBy: memberId, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection('audit_log').doc(), {
    actorMemberId: memberId, action: 'aiCostConfig.setCeiling',
    target: 'settings/aiCostConfig', at: FieldValue.serverTimestamp(),
    details: { monthlyCeilingILS },
  });
  await batch.commit();

  return { ok: true };
});
