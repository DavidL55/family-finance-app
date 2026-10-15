// Spec C1 §4.3 — invite redemption in the browser. The rules are the boundary (they bind the two
// writes together and check email/expiry/role); this service only gives the user a clear Hebrew
// reason before trying, and refreshes the token first so a just-verified email is visible to them.
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

export type RedeemFailure = 'no-email' | 'not-verified' | 'no-invite' | 'expired' | 'used' | 'failed';
export type RedeemOutcome = { ok: true } | { ok: false; reason: RedeemFailure; message: string };

export const REDEEM_MESSAGES: Record<RedeemFailure, string> = {
  'no-email': 'לחשבון הזה אין כתובת אימייל, ולכן אי אפשר לשייך אותו להזמנה.',
  'not-verified': 'צריך קודם לאמת את כתובת האימייל — בדוק את תיבת הדואר ולחץ על הקישור.',
  'no-invite': 'לא נמצאה הזמנה לכתובת הזו. בקש מדויד לשלוח הזמנה לאימייל שאיתו נכנסת.',
  expired: 'ההזמנה פגה. בקש מדויד הזמנה חדשה.',
  used: 'ההזמנה כבר נוצלה. אם זה לא אתה — פנה לדויד.',
  failed: 'הפעולה נכשלה. נסה שוב, ואם זה חוזר — פנה לדויד.',
};

const fail = (reason: RedeemFailure): RedeemOutcome => ({ ok: false, reason, message: REDEEM_MESSAGES[reason] });

export async function redeemMyInvite(user: User): Promise<RedeemOutcome> {
  try {
    await user.reload();
    if (!user.email) return fail('no-email');
    if (!user.emailVerified) return fail('not-verified');
    await user.getIdToken(true); // the rules read email_verified from the token (Review Focus 3)
    const email = user.email.toLowerCase();
    const inviteRef = doc(db, 'invites', email);
    const snap = await getDoc(inviteRef);
    if (!snap.exists()) return fail('no-invite');
    const inv = snap.data() as { memberId: string; role: string; expiresAt: { toMillis(): number }; usedBy?: string };
    if (inv.usedBy) return fail('used');
    if (inv.expiresAt.toMillis() <= Date.now()) return fail('expired');
    const batch = writeBatch(db);
    batch.update(inviteRef, { usedBy: user.uid, usedAt: serverTimestamp() });
    batch.set(doc(db, 'access', user.uid), {
      uid: user.uid, memberId: inv.memberId, role: inv.role, email,
      grantedAt: serverTimestamp(), grantedVia: email,
    });
    await batch.commit();
    return { ok: true };
  } catch (err) {
    console.error('[InvitesService] redeem failed:', err);
    return fail('failed');
  }
}
