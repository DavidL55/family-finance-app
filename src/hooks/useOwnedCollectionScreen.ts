// D13 (Sun's architecture ruling, Stage 5 Task 3) — the shared shell every owned-collection
// screen (Accounts here; Loans/Insurances/Recurring in Tasks 4/6/7) builds on, extracted BEFORE
// AccountsScreen could become the four-times-cloned template the original plan's first draft
// would have produced. Owns: scope resolution (own/family/none), the fetch effect and its
// four-way status split (loading/ready/error/permission-denied — the project-wide S2 rule that a
// permission refusal is a calm access state, never the red error banner, and a failed read is
// never a fabricated empty list), the מי-filter (via D6's corrected resolveMemberSelectionIds),
// create/edit/delete plumbing (calling the screen's own list/save/remove — never reaching into
// Firestore directly), and the I4 dirty-form leave-guard registration on NavigationContext.
//
// A screen supplies only its own service functions, copy strings, and field config/row
// rendering/totals math — never re-derives any of the above. NetWorthScreen (Task 5), which is
// read-only over a different shape of data (a computed aggregate across two collections plus a
// legacy doc, not one OwnedCollectionRepo's list), deliberately does NOT call this hook — see D13
// in docs/superpowers/plans/2026-08-16-stage5-financial-modules.md for why that's the right
// abstraction boundary, not a gap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useNavigation } from '../contexts/NavigationContext';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
import { resolveMemberSelectionIds } from '../utils/resolveMemberSelection';
import type { OwnedRecord, OwnedRecordInput } from '../services/financeCollections';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

export interface OwnedCollectionScreenConfig<T extends OwnedRecord> {
  list: (scope: 'own' | 'family', viewerMemberId: string) => Promise<T[]>;
  save: (input: OwnedRecordInput<T>, actorMemberId: string) => Promise<T>;
  remove: (id: string, actorMemberId: string) => Promise<void>;
  session: { memberId: string; role: PermissionRole };
  viewLevel: PermissionLevel | undefined;
  editLevel: PermissionLevel | undefined;
  loadErrorMessage: string;
}

export interface OwnedCollectionScreenState<T extends OwnedRecord> {
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  errorMessage: string | null;
  items: T[];
  visibleItems: T[]; // after the D6 מי filter is applied
  viewScope: 'own' | 'family' | 'none';
  editScope: 'own' | 'family' | 'none';
  isFormOpen: boolean;
  editing: T | null;
  openCreate: () => void;
  openEdit: (item: T) => void;
  closeForm: () => void;
  markDirty: (dirty: boolean) => void; // I4 — the screen's form calls this on every field change
  pendingDeleteId: string | null;
  requestDelete: (id: string) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  submit: (input: OwnedRecordInput<T>) => Promise<void>;
  reload: () => void;
}

export function useOwnedCollectionScreen<T extends OwnedRecord>(
  config: OwnedCollectionScreenConfig<T>
): OwnedCollectionScreenState<T> {
  const { list, save, remove, session, viewLevel, editLevel, loadErrorMessage } = config;
  const { filters, groups } = useGlobalFilters();
  const { setLeaveGuard } = useNavigation();

  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<OwnedCollectionScreenState<T>['status']>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const viewScope = resolveOwnedModuleScope(session.role, viewLevel);
  const editScope = resolveOwnedModuleScope(session.role, editLevel);

  useEffect(() => {
    if (viewScope === 'none') {
      // A 'none' scope means "don't query at all," not "query and expect empty" — see Task 1's
      // report. Rendering permission-denied off the resolved scope directly (never off a query
      // result) also means a viewer with no grant never issues a doomed read at all.
      setStatus('permission-denied');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    list(viewScope, session.memberId)
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
  }, [viewScope, session.memberId, reloadToken]);

  // I4 — one stable guard, registered once, reading live refs at call time (no stale closures
  // from re-registering a new function on every isFormOpen/dirty change — NavigationContext calls
  // this synchronously from navigateTo/goBack, so it must always see the CURRENT open/dirty
  // state, not whatever was captured at the last render this effect happened to run on).
  const isFormOpenRef = useRef(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    isFormOpenRef.current = isFormOpen;
  }, [isFormOpen]);
  useEffect(() => {
    setLeaveGuard(() => {
      if (!isFormOpenRef.current || !dirtyRef.current) return true;
      return window.confirm('יש שינויים שלא נשמרו בטופס. לצאת בכל זאת?');
    });
    return () => setLeaveGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLeaveGuard]);

  const selectedIds = resolveMemberSelectionIds(filters.member, groups.status === 'ready' ? groups.groups : []);
  const visibleItems = selectedIds ? items.filter((i) => selectedIds.has(i.ownerId)) : items;

  const openCreate = useCallback(() => {
    setEditing(null);
    dirtyRef.current = false;
    setIsFormOpen(true);
  }, []);
  const openEdit = useCallback((item: T) => {
    setEditing(item);
    dirtyRef.current = false;
    setIsFormOpen(true);
  }, []);
  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditing(null);
    dirtyRef.current = false;
  }, []);
  const markDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const submit = useCallback(
    async (input: OwnedRecordInput<T>) => {
      await save(editing ? ({ ...input, id: editing.id } as OwnedRecordInput<T>) : input, session.memberId);
      dirtyRef.current = false;
      setIsFormOpen(false);
      setEditing(null);
      setReloadToken((t) => t + 1);
    },
    [editing, save, session.memberId]
  );

  const requestDelete = useCallback((id: string) => setPendingDeleteId(id), []);
  const cancelDelete = useCallback(() => setPendingDeleteId(null), []);
  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    await remove(pendingDeleteId, session.memberId);
    setItems((prev) => prev.filter((i) => i.id !== pendingDeleteId));
    setPendingDeleteId(null);
  }, [pendingDeleteId, remove, session.memberId]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return {
    status,
    errorMessage,
    items,
    visibleItems,
    viewScope,
    editScope,
    isFormOpen,
    editing,
    openCreate,
    openEdit,
    closeForm,
    markDirty,
    pendingDeleteId,
    requestDelete,
    cancelDelete,
    confirmDelete,
    submit,
    reload,
  };
}
