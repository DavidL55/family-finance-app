import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { PermissionRole } from '../shared/permissions';
import { MAX_MONTHLY_CEILING_ILS, resolveCeiling } from '../costGate/types';
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

  // Task 8 review F3 — deliberately NOT `Number(...)`. Coercion turned null/''/'   '/[]/false
  // into 0, and 0 was read as "no ceiling configured" downstream, so clearing the input silently
  // disabled paid AI while telling the operator no ceiling had ever been set. Typed `unknown`
  // because the declared request type describes what a well-behaved client sends, not what an
  // arbitrary callable invocation can actually put on the wire.
  //
  // resolveCeiling is the SAME validator costGate uses when READING the doc back (and the same
  // bounds firestore.rules's isValidAiCostConfig enforces on the write itself, which is the real
  // boundary since the Admin SDK bypasses Rules). One definition, four layers, no drift.
  const raw: unknown = request.data?.monthlyCeilingILS;
  const resolved = resolveCeiling(raw);
  if (resolved.status !== 'configured') {
    throw new HttpsError(
      'invalid-argument',
      `תקרה חייבת להיות מספר בין 0 ל-${MAX_MONTHLY_CEILING_ILS} (0 חוסם קריאות AI בתשלום)`,
    );
  }
  const monthlyCeilingILS = resolved.ceilingILS;

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
