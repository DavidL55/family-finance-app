// Spec C1 §4.3 — a signed-in user with no access/{uid}. Verified → "יש לי הזמנה" (redeem);
// unverified → resend + "אימתתי" (reload). On success nothing navigates: useAuthSession's access
// listener sees the new doc and App re-renders past this screen.
import { useState } from 'react';
import { sendEmailVerification, type User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { redeemMyInvite } from '../services/InvitesService';
import { signOutCurrentUser } from '../hooks/useAuthSession';

export default function UnassignedScreen({ user, message }: { user: User; message: string | null }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0); // user.reload() mutates `user` in place — re-render to read it

  const redeem = async () => {
    setBusy(true); setNotice(null);
    const outcome = await redeemMyInvite(user);
    if (outcome.ok === false) setNotice(outcome.message);
    setBusy(false);
  };
  const resend = async () => {
    setBusy(true);
    try { await sendEmailVerification(user); setNotice(`שלחנו מייל אימות ל-${user.email}.`); }
    catch { setNotice('שליחת המייל נכשלה. נסה שוב בעוד דקה.'); }
    setBusy(false);
  };
  const recheck = async () => {
    setBusy(true); setNotice(null);
    try {
      await user.reload();
      setTick((t) => t + 1);
      if (!user.emailVerified) setNotice('האימייל עדיין לא אומת. לחץ על הקישור במייל שקיבלת ואז נסה שוב.');
    } catch { setNotice('הבדיקה נכשלה. בדוק את החיבור לרשת ונסה שוב.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm text-center space-y-4">
        <p className="text-slate-700">{message}</p>
        <p className="text-xs text-slate-500" dir="ltr">{user.email}</p>
        {user.emailVerified ? (
          <button onClick={redeem} disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 font-medium disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'יש לי הזמנה'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-amber-700">כדי לקבל גישה צריך לאמת את כתובת האימייל.</p>
            <button onClick={resend} disabled={busy} className="w-full border border-slate-300 rounded-xl py-2 text-sm">שלח שוב מייל אימות</button>
            <button onClick={recheck} disabled={busy} className="w-full bg-blue-600 text-white rounded-xl py-2 text-sm">אימתתי</button>
          </div>
        )}
        {notice && <p className="text-sm text-red-600" role="status">{notice}</p>}
        <button onClick={() => signOutCurrentUser()} className="text-sm text-slate-500 underline hover:text-slate-700">התנתק</button>
      </div>
    </div>
  );
}
