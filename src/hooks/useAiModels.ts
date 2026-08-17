// Task 6 (Stage 6) — fetch-once-and-cache hook over aiClient.listAiModels. Same
// loading/ready/error three-state shape this project's other data hooks already use
// (useFamilyMembers/useGroups precedent, Stage 4) — a failed read is an explicit 'error' status
// with the message surfaced, NEVER a silent fallback to an empty list. No 'permission-denied'
// state: listAiModels (D5) requires only isSignedIn, not a matrix grant, so there is nothing for
// this hook to distinguish that useFamilyMembers/useGroups' own permission-aware siblings do.
import { useCallback, useEffect, useState } from 'react';
import { listAiModels } from '../services/aiClient';
import type { AiModelInfo } from '../../functions/src/providers/types';

export interface AiModelsState {
  status: 'loading' | 'error' | 'ready';
  models: AiModelInfo[];
  error: string | null;
  reload: () => void;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה בטעינת רשימת המודלים');

export function useAiModels(action?: 'chat' | 'insight' | 'extraction'): AiModelsState {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    listAiModels(action)
      .then((result) => {
        if (cancelled) return;
        setModels(result);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModels([]);
        setStatus('error');
        setError(errMsg(err));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { status, models, error, reload };
}
