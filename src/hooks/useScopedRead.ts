// Stage 5 Task 5 — the READ half of useOwnedCollectionScreen (D13), factored out so a second,
// read-only consumer (useNetWorth, this same task) can reuse the identical fetch-effect/
// cancel-guard/four-state status machine instead of hand-reimplementing it — closing the exact
// "four identical copies" duplication D13 already fixed once for the CRUD screens, this time for
// the first read-only one. Owns: the fetch effect + its cancel guard, and the loading/ready/
// error/permission-denied split — a `scope === 'none'` short-circuits straight to
// `permission-denied` WITHOUT ever calling `list()` (see useOwnedCollectionScreen's own comment:
// a 'none' scope means "don't query at all," not "query and expect empty"). Also exposes
// `setItems` so a caller can apply a local, non-refetching mutation (useOwnedCollectionScreen's
// delete-without-a-full-reload) and `reload()` to force a genuine refetch.
//
// Deliberately does NOT own scope RESOLUTION (`resolveOwnedModuleScope`) or the מי-filter
// (`resolveMemberSelectionIds`):
//  - Scope resolution is a one-line pure function (its own test suite,
//    ownedModuleScope.test.ts), not the stateful machinery this extraction exists to
//    deduplicate. useOwnedCollectionScreen still resolves `viewScope`/`editScope` itself and
//    passes the resolved `viewScope` in; useNetWorth receives an ALREADY-RESOLVED `NetWorthScope`
//    ('own'|'family', never 'none') combined across two modules by ITS OWN caller (Dashboard/
//    NetWorthScreen, per D3) — routing that through a role+viewLevel-shaped API here would be the
//    wrong fit for a hook whose scope is handed to it pre-resolved.
//  - The מי-filter needs `useGlobalFilters()` (FilterContext). useNetWorth fetches accounts/loans
//    directly and lets the caller's own scope/targetMemberId resolution — not a post-hoc filter
//    over fetched items — express "a single member is selected" (D3's own text: a specific
//    member selection re-resolves scope/target, it does not filter a family-wide result down).
//    Keeping this hook FilterContext-free is what makes it mountable from both a
//    context-wrapped screen AND a bare `renderHook()` unit test with no providers at all (see
//    useNetWorth.test.ts, which never mounts FilterProvider).
import { useCallback, useEffect, useState } from 'react';
import type { OwnedRecord } from '../services/financeCollections';

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

export interface UseScopedReadConfig<T extends OwnedRecord> {
  list: (scope: 'own' | 'family', viewerMemberId: string) => Promise<T[]>;
  scope: 'own' | 'family' | 'none';
  viewerMemberId: string;
  loadErrorMessage: string;
}

export interface UseScopedReadResult<T extends OwnedRecord> {
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  errorMessage: string | null;
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  reload: () => void;
}

export function useScopedRead<T extends OwnedRecord>(config: UseScopedReadConfig<T>): UseScopedReadResult<T> {
  const { list, scope, viewerMemberId, loadErrorMessage } = config;

  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<UseScopedReadResult<T>['status']>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (scope === 'none') {
      // A 'none' scope means "don't query at all," not "query and expect empty" — a viewer with
      // no grant never issues a doomed read at all, and never renders permission-denied off a
      // query result (which would depend on the query having been attempted in the first place).
      setStatus('permission-denied');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    list(scope, viewerMemberId)
      .then((result) => {
        if (cancelled) return;
        setItems(result);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isPermissionDenied(err)) {
          setStatus('permission-denied');
          return;
        }
        setErrorMessage(loadErrorMessage);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, viewerMemberId, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { status, errorMessage, items, setItems, reload };
}
