// Task 9: wires the Stage 3 recurring catch-up engine
// (RecurringService.postDueRecurringTransactions, Task 5) into app bootstrap (spec §11 —
// "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן"). Local-first, no Cloud Functions (spec §15),
// so "on app open" is the only trigger point — extracted from App.tsx into its own hook so it can
// be unit-tested (mocked service + NotificationContext) without dragging in Dashboard's heavy
// dependency tree (recharts/ai/firestore), the same way useAuthSession is its own testable hook.
//
// Runs for EVERY ready session, unlike MembersService.ensureSeeded's super-admin-only gate in
// App.tsx: a 'member'-role session can now catch-up-post their OWN recurring items (D7 unblocked
// member-role audit_log writes), and a parent/super-admin session catches up everyone's.
//
// D1 (this stage's fix for a live, already-shipped bug): `recurringViewLevel` is resolved into a
// scope via `resolveOwnedModuleScope` before the underlying service is ever called.
// `postDueRecurringTransactions` used to always issue an unconstrained list query regardless of
// the caller's actual grant — Firestore denies that wholesale for an 'own'-level viewer (it
// cannot statically prove every possible result document satisfies `ownedModuleAllowed()`'s
// `resource.data`-dependent condition), so a 'member' session with only 'own' access to
// `recurring` got a failed catch-up, surfaced only as a generic error toast, on every single app
// open. Threading the resolved scope through fixes that. A scope of 'none' means the viewer has
// no grant on `recurring` at all: this is NOT an error state — "you have no grant" is not
// "something went wrong" — so the hook skips the call entirely (no query issued, no failure
// notice), rather than attempting a read that would only ever come back denied.
//
// Never blocks first paint: fire-and-forget. postDueRecurringTransactions is documented to never
// throw (per-item failures are collected in `.failed`, not propagated) — a non-empty `.failed`
// surfaces as a console.error (same visibility convention as ensureSeeded's failure logging in
// App.tsx) PLUS a non-blocking Hebrew notice via NotificationContext, so a real failure is
// visible to the signed-in user, not just the console. The `.catch` below is defense-in-depth
// only, in case that "never throws" contract is ever violated by a future change — it must not be
// able to crash the app either.
//
// D10: returns the last resolved PostingOutcome (was `void`) so a future consumer (Task 7's
// RecurringScreen) can thread per-item failures into a row-level badge instead of only a
// fire-and-forget app-boot toast that nothing downstream could ever inspect again.
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

import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from './useAuthSession';
import { postDueRecurringTransactions, type PostingOutcome } from '../services/RecurringService';
import { useNotification } from '../contexts/NotificationContext';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
import type { PermissionLevel } from '../types/permissions';

const CATCHUP_FAILURE_MESSAGE =
  'עדכון תנועות קבועות נכשל עבור חלק מהפריטים. בדוק את היומן, ופנה לסופר-אדמין אם הבעיה נמשכת.';

export function useRecurringCatchup(
  session: Pick<AuthSession, 'status' | 'memberId' | 'role'>,
  recurringViewLevel: PermissionLevel | undefined
): PostingOutcome | null {
  const { addNotification } = useNotification();
  const ranForMemberIdRef = useRef<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<PostingOutcome | null>(null);

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

    const scope = resolveOwnedModuleScope(session.role!, recurringViewLevel);
    if (scope === 'none') return; // no grant at all — not an error, nothing due to even ask about

    postDueRecurringTransactions(session.memberId, scope)
      .then((outcome) => {
        setLastOutcome(outcome);
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
  }, [session.status, session.memberId, session.role, recurringViewLevel, addNotification]);

  return lastOutcome;
}
