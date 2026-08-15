// Task 7: claims-driven session state. Anonymous auth is gone (Stage 2's Firestore Rules deny
// any claims-less token everywhere — see firestore.rules `hasRole()`), so the ONLY source of
// truth for "who is this and what can they do" is a signed-in Firebase Auth user's ID token
// custom claims (`role`, `memberId`), set exclusively by `scripts/provision-auth-users.ts` via
// the Admin SDK (Design decision D1/D6 — never derived from a Firestore document a client can
// edit).
//
// Every `onAuthStateChanged` firing force-refreshes the token (`getIdTokenResult(true)`) rather
// than trusting a cached one, so a super-admin re-running the provisioning script mid-session
// (or a browser tab left open across a role change) picks up the new claims on the very next
// auth-state event instead of silently running on stale authorization — the same "don't bind to
// a default/stale value" principle applies to claims as it does to tenant resolution.
//
// A signed-in user with no (or partial/corrupt) claims is `'unprovisioned'` — an explicit,
// user-visible state — never a silent fallback to some guest/anonymous-shaped session. A failed
// claims fetch is `'error'`, not an empty session either (Boris's "failed read is an error state,
// never an empty one," applied to auth).
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../services/firebase';
import type { PermissionRole } from '../types/permissions';

export type AuthStatus = 'loading' | 'signed-out' | 'unprovisioned' | 'ready' | 'error';

export interface AuthSession {
  status: AuthStatus;
  user: User | null;
  role: PermissionRole | null;
  memberId: string | null;
  error: string | null;
}

const INITIAL: AuthSession = { status: 'loading', user: null, role: null, memberId: null, error: null };

const UNPROVISIONED_MESSAGE =
  'החשבון שלך מחובר אך לא משויך לאף בן משפחה במערכת. פנה לסופר-אדמין (דויד) כדי לקשר את החשבון.';

const VALID_ROLES: readonly PermissionRole[] = ['super-admin', 'parent', 'member'] as const;

function isPermissionRole(value: unknown): value is PermissionRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

export function useAuthSession(): AuthSession {
  const [session, setSession] = useState<AuthSession>(INITIAL);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      if (!user) {
        setSession({ status: 'signed-out', user: null, role: null, memberId: null, error: null });
        return;
      }

      user
        .getIdTokenResult(true)
        .then((tokenResult) => {
          const rawRole = tokenResult.claims.role;
          const rawMemberId = tokenResult.claims.memberId;
          const role = isPermissionRole(rawRole) ? rawRole : null;
          const memberId = typeof rawMemberId === 'string' && rawMemberId.length > 0 ? rawMemberId : null;

          if (!role || !memberId) {
            setSession({ status: 'unprovisioned', user, role: null, memberId: null, error: UNPROVISIONED_MESSAGE });
            return;
          }

          setSession({ status: 'ready', user, role, memberId, error: null });
        })
        .catch((err: unknown) => {
          setSession({
            status: 'error',
            user,
            role: null,
            memberId: null,
            error: err instanceof Error ? err.message : 'שגיאה בטעינת הרשאות המשתמש',
          });
        });
    });

    return unsubscribe;
  }, []);

  return session;
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut(auth);
}
