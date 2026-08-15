// Task 9: wires the Stage 3 recurring catch-up engine
// (RecurringService.postDueRecurringTransactions, Task 5) into app bootstrap (spec §11 —
// "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן"). Local-first, no Cloud Functions (spec §15),
// so "on app open" is the only trigger point — extracted from App.tsx into its own hook so it can
// be unit-tested (mocked service + NotificationContext) without dragging in Dashboard's heavy
// dependency tree (recharts/ai/firestore), the same way useAuthSession is its own testable hook.
//
// Runs for EVERY ready session, unlike MembersService.ensureSeeded's super-admin-only gate in
// App.tsx: a 'member'-role session can now catch-up-post their OWN recurring items (D7 unblocked
// member-role audit_log writes), and a parent/super-admin session catches up everyone's (Rules,
// not app code, do the owner-scoping — see RecurringService.ts's own header comment). Never runs
// for signed-out/loading/unprovisioned/error sessions.
//
// Never blocks first paint: fire-and-forget. postDueRecurringTransactions is documented to never
// throw (per-item failures are collected in `.failed`, not propagated) — a non-empty `.failed`
// surfaces as a console.error (same visibility convention as ensureSeeded's failure logging in
// App.tsx) PLUS a non-blocking Hebrew notice via NotificationContext, so a real failure is
// visible to the signed-in user, not just the console. The `.catch` below is defense-in-depth
// only, in case that "never throws" contract is ever violated by a future change — it must not be
// able to crash the app either.
//
// Double-run guard: React's StrictMode double-invokes every effect once in dev (mount -> cleanup
// -> mount), and onAuthStateChanged can refire for an already-ready session without changing
// `status`/`memberId` (e.g. a forced token refresh, see useAuthSession's own force-refresh
// comment). A ref keyed to the memberId this hook has already kicked off a run for prevents a
// second, wasted run for the SAME member within this hook instance's lifetime. The underlying
// engine is idempotent regardless (deterministic per-period doc ids, Task 5's report) — this
// guard exists purely to avoid redundant reads / duplicate audit_log writes / notification spam,
// not for correctness. A genuinely different member (memberId changes) always gets its own run.
// The guard is reset whenever the session leaves 'ready' (e.g. sign-out), so a same-user
// re-login in the same tab is treated as a fresh run, not a same-session refire.

import { useEffect, useRef } from 'react';
import type { AuthSession } from './useAuthSession';
import { postDueRecurringTransactions } from '../services/RecurringService';
import { useNotification } from '../contexts/NotificationContext';

const CATCHUP_FAILURE_MESSAGE =
  'עדכון תנועות קבועות נכשל עבור חלק מהפריטים. בדוק את היומן, ופנה לסופר-אדמין אם הבעיה נמשכת.';

export function useRecurringCatchup(session: Pick<AuthSession, 'status' | 'memberId'>): void {
  const { addNotification } = useNotification();
  const ranForMemberIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (session.status !== 'ready' || !session.memberId) {
      // Leaving 'ready' (e.g. sign-out) clears the guard so a same-user re-login in the
      // same tab (no page reload) gets its own catch-up run instead of being silently
      // skipped because the ref still matches their memberId from before.
      ranForMemberIdRef.current = null;
      return;
    }
    if (ranForMemberIdRef.current === session.memberId) return;
    ranForMemberIdRef.current = session.memberId;

    postDueRecurringTransactions(session.memberId)
      .then((outcome) => {
        if (outcome.failed.length > 0) {
          console.error('[App] recurring catch-up had failures:', outcome.failed);
          addNotification('error', CATCHUP_FAILURE_MESSAGE);
        }
      })
      .catch((err: unknown) => {
        // Defense-in-depth only — postDueRecurringTransactions is documented to never reject.
        console.error('[App] recurring catch-up threw unexpectedly:', err);
        addNotification('error', CATCHUP_FAILURE_MESSAGE);
      });
  }, [session.status, session.memberId, addNotification]);
}
