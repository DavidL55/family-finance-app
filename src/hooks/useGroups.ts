// Identical shape to useFamilyMembers.ts, wrapping listGroups instead of listMembers — see that
// hook's doc comment for the shared-fetch (M2) and cancellation-guard rationale, which applies
// here unchanged.
import { useCallback, useEffect, useState } from 'react';
import { listGroups } from '../services/GroupsService';
import type { Group } from '../types/permissions';

export interface GroupsState {
  status: 'loading' | 'error' | 'ready';
  groups: Group[];
  error: string | null;
  reload: () => void;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה בטעינת קבוצות');

export function useGroups(): GroupsState {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    listGroups()
      .then((result) => {
        if (cancelled) return;
        setGroups(result);
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

  return { status, groups, error, reload };
}
