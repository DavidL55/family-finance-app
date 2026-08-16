// Resolves the CURRENT session's own materialized permissions (PermissionsService, D2) for
// nav-gating purposes (moduleRegistry's isModuleVisible). Mirrors useFamilyMembers.ts's
// status/cancellation-guard shape (see that file's doc comment for the full rationale), keyed
// on `session.status`/`session.memberId` instead of a constant dependency array — a session that
// isn't `'ready'` yet has no memberId to resolve permissions for, so the fetch simply never runs
// and status stays `'idle'` (distinct from `'loading'`, which would wrongly imply a fetch is
// in flight).
//
// `resolvedPermissions: undefined` on the fetched member (not yet materialized by
// PermissionsService for this member) still reaches `status: 'ready'`, with resolvedPermissions
// defaulted to `{}` — a real, successfully-fetched "no grants yet" outcome. `null` is reserved
// for the distinct "we don't know, the read itself failed" error case — `isModuleVisible` fails
// closed identically on `{}` and `null` for a 'member' role, but keeping the two apart here keeps
// the type honest about what was actually fetched, and lets a future caller (or this hook's own
// error banner) tell "confirmed no access" apart from "couldn't check."
import { useCallback, useEffect, useState } from 'react';
import { getMember } from '../services/MembersService';
import type { ModulePermissionMap } from '../types/permissions';
import type { AuthSession } from './useAuthSession';

export interface ResolvedPermissionsState {
  status: 'idle' | 'loading' | 'error' | 'ready';
  resolvedPermissions: ModulePermissionMap | null;
  error: string | null;
  retry: () => void;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה בטעינת הרשאות');

export function useResolvedPermissions(session: AuthSession): ResolvedPermissionsState {
  const [status, setStatus] = useState<ResolvedPermissionsState['status']>('idle');
  const [resolvedPermissions, setResolvedPermissions] = useState<ModulePermissionMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (session.status !== 'ready' || !session.memberId) {
      setStatus('idle');
      setResolvedPermissions(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    getMember(session.memberId)
      .then((member) => {
        if (cancelled) return;
        setResolvedPermissions(member?.resolvedPermissions ?? {});
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setResolvedPermissions(null);
        setError(errMsg(err));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, session.memberId, retryToken]);

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  return { status, resolvedPermissions, error, retry };
}
