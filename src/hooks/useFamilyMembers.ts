// Shared members-load hook (M2). Task 4 lifts this call site into `FilterProvider` so
// `FilterBar` and `Dashboard` share ONE `listMembers()` fetch instead of each mounting its own —
// see task-2-report.md for exactly what that lift needs to do. The hook itself doesn't change
// when that lift happens; only who calls it does.
//
// A failed read is an explicit `'error'` status with the message surfaced, and NEVER resets
// `members` to `[]` — the last known-good list (if any) stays visible, project-wide "a failed
// read renders an error, never a silent empty state" rule (see MembersService.listMembers'
// own doc comment for the same principle one layer down).
//
// `reloadToken` drives `reload()`; the effect's cleanup sets `cancelled = true`, which guards
// both an unmounted component and a superseded (re-triggered) fetch from ever calling
// setState after they're no longer the current in-flight request — same "don't let a stale
// async resolution win" spirit as useAuthSession's generation guard, simplified because there's
// only ever one fetch in flight at a time here (no cross-firing ordering race to worry about).
import { useCallback, useEffect, useState } from 'react';
import { listMembers } from '../services/MembersService';
import type { Member } from '../utils/seedFromBudgetConfig';

export interface FamilyMembersState {
  status: 'loading' | 'error' | 'ready';
  members: Member[];
  error: string | null;
  reload: () => void;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה בטעינת בני המשפחה');

export function useFamilyMembers(): FamilyMembersState {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    listMembers()
      .then((result) => {
        if (cancelled) return;
        setMembers(result);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(errMsg(err));
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { status, members, error, reload };
}
