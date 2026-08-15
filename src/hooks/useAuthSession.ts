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
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../services/firebase';
import type { PermissionRole } from '../types/permissions';

// Cross-user Drive credential keys (Task 7 review, Fix 2). These are read/written directly by
// SyncButton.tsx, InvestmentsImportModal.tsx and AssetCard.tsx (not yet migrated to import these
// constants — queued for a later stage); signOutCurrentUser must clear them so a second family
// member signing in on the same tab never inherits the previous user's live Google Drive OAuth
// token or folder selection, which lives outside Firestore rules entirely.
export const DRIVE_TOKEN_SESSION_KEY = 'drive_token';
export const DRIVE_FOLDER_ID_LOCAL_KEY = 'drive_folder_id';
export const DRIVE_FOLDER_NAME_LOCAL_KEY = 'drive_folder_name';

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

  // Stale-claims race guard (Task 7 review, Fix 1). Every onAuthStateChanged firing starts its
  // own getIdTokenResult(true) promise with no ordering guarantee — if an EARLIER firing's
  // promise resolves AFTER a LATER firing has already settled the session (or after unmount),
  // that stale .then()/.catch() must not clobber the current, correct state. `generationRef` is
  // bumped on every firing; each async callback captures the generation it was started under and
  // checks it's still current immediately before calling setSession.
  const generationRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      const generation = ++generationRef.current;

      if (!user) {
        if (generationRef.current !== generation) return;
        setSession({ status: 'signed-out', user: null, role: null, memberId: null, error: null });
        return;
      }

      user
        .getIdTokenResult(true)
        .then((tokenResult) => {
          if (generationRef.current !== generation) return;

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
          if (generationRef.current !== generation) return;
          setSession({
            status: 'error',
            user,
            role: null,
            memberId: null,
            error: err instanceof Error ? err.message : 'שגיאה בטעינת הרשאות המשתמש',
          });
        });
    });

    return () => {
      // Bump the generation on unmount too, so any promise already in flight is recognized as
      // stale and its resolution/rejection is a no-op instead of a post-unmount setSession.
      generationRef.current += 1;
      unsubscribe();
    };
  }, []);

  return session;
}

export async function signOutCurrentUser(): Promise<void> {
  // Clear cross-user Drive credentials before signing out of Firebase, so a second family
  // member signing in on this tab never inherits the previous user's live Google Drive OAuth
  // token or folder selection (see the constants above for the components that own these keys).
  sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY);
  localStorage.removeItem(DRIVE_FOLDER_ID_LOCAL_KEY);
  localStorage.removeItem(DRIVE_FOLDER_NAME_LOCAL_KEY);
  await signOut(auth);
}
