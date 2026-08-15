// Task 7: real email+password login against the Auth emulator (D7 — accounts are admin-
// provisioned via `scripts/provision-auth-users.ts`, not self-service). Rendered by App.tsx
// whenever `useAuthSession().status === 'signed-out'`. One primary action, an explicit
// loading state on the submit button, and a Hebrew error message on failure — never a blank
// screen (matches the "failed read is an error state, never an empty one" rule extended to
// auth).
import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2, LogIn } from 'lucide-react';
import { auth } from '../services/firebase';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'אימייל או סיסמה שגויים.',
  'auth/invalid-email': 'כתובת האימייל אינה תקינה.',
  'auth/user-not-found': 'לא נמצא משתמש עם האימייל הזה.',
  'auth/wrong-password': 'סיסמה שגויה.',
  'auth/user-disabled': 'החשבון הזה הושבת. פנה לסופר-אדמין.',
  'auth/too-many-requests': 'יותר מדי ניסיונות — נסה שוב בעוד כמה דקות.',
};

const GENERIC_ERROR = 'ההתחברות נכשלה. נסה שוב.';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // On success, App.tsx's useAuthSession picks up the new signed-in user via
      // onAuthStateChanged and re-renders past this screen — no local navigation needed here.
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      setError(ERROR_MESSAGES[code] ?? GENERIC_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir="rtl">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm space-y-4"
      >
        <div className="text-center mb-2">
          <div className="w-12 h-12 mx-auto bg-blue-600 rounded-xl flex items-center justify-center text-white text-2xl font-bold mb-3 shadow-sm">
            ₪
          </div>
          <h1 className="text-lg font-bold text-slate-800">תקציב משפחתי</h1>
          <p className="text-sm text-slate-500">התחברות</p>
        </div>

        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">
            אימייל
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            dir="ltr"
            autoComplete="username"
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">
            סיסמה
          </label>
          <input
            id="login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            dir="ltr"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          התחבר
        </button>
      </form>
    </div>
  );
}
