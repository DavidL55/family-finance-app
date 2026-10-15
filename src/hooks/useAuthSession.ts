// Spec C1 §4: role/memberId come from access/{uid} via a live listener, so a revoke reaches an
// open tab immediately. Token claims are NOT read — Firestore rules take identity from the same
// doc. A signed-in user with no (or partial/corrupt) access doc is `'unprovisioned'` — an
// explicit, user-visible state, never a silent guest fallback. A failed listener is `'error'`,
// not an empty session either (Boris's "failed read is an error state, never an empty one,"
// applied to auth).
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
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
  'החשבון שלך מחובר אך עדיין לא משויך לבן משפחה במערכת. אם קיבלת הזמנה — לחץ "יש לי הזמנה".';

const VALID_ROLES: readonly PermissionRole[] = ['super-admin', 'parent', 'member'] as const;

function isPermissionRole(value: unknown): value is PermissionRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

export function parseAccess(data: unknown): { role: PermissionRole; memberId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const { role, memberId } = data as { role?: unknown; memberId?: unknown };
  if (!isPermissionRole(role) || typeof memberId !== 'string' || memberId.length === 0) return null;
  return { role, memberId };
}

export function useAuthSession(): AuthSession {
  const [session, setSession] = useState<AuthSession>(INITIAL);

  // Stale-listener race guard. `generationRef` is bumped on every auth-state firing and on
  // unmount; each access listener captures the generation it was started under and checks it is
  // still current immediately before calling setSession, so a late snapshot from a previous user
  // (or after unmount) can never clobber the current session.
  const generationRef = useRef(0);

  useEffect(() => {
    let stopAccess: (() => void) | null = null;
    const detachAccess = () => {
      stopAccess?.();
      stopAccess = null;
    };

    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      const generation = ++generationRef.current;
      detachAccess();

      if (!user) {
        setSession({ status: 'signed-out', user: null, role: null, memberId: null, error: null });
        return;
      }

      setSession({ ...INITIAL, user });
      // includeMetadataChanges: with the persistent cache the first snapshot can be a cached
      // "missing"; we need the later fromCache:false event to learn the server's answer.
      stopAccess = onSnapshot(
        doc(db, 'access', user.uid),
        { includeMetadataChanges: true },
        (snap) => {
          if (generationRef.current !== generation) return;
          // exists() is a type guard, so read the metadata before narrowing.
          const { fromCache } = snap.metadata;
          const parsed = snap.exists() ? parseAccess(snap.data()) : null;
          // Cache says "missing" before the server answered: stay loading, no flash of
          // "לא משויך". The next server snapshot decides (Global Constraints, Review Focus 5).
          if (!snap.exists() && fromCache) return;

          setSession(
            parsed
              ? { status: 'ready', user, role: parsed.role, memberId: parsed.memberId, error: null }
              : { status: 'unprovisioned', user, role: null, memberId: null, error: UNPROVISIONED_MESSAGE },
          );
        },
        (err: unknown) => {
          if (generationRef.current !== generation) return;
          setSession({
            status: 'error',
            user,
            role: null,
            memberId: null,
            error: err instanceof Error ? err.message : 'שגיאה בטעינת הרשאות המשתמש',
          });
        },
      );
    });

    return () => {
      generationRef.current += 1;
      detachAccess();
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
