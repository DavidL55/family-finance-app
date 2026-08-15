// Stage 2 Task 8 — super-admin-only groups & permission-matrix admin screen.
//
// This is the ONLY place in the app that calls GroupsService/PermissionsService writes (see
// task-3-report.md "Notes for Tasks 4-8"), so it is the one place D2's "resolvedPermissions never
// drifts" guarantee actually gets enforced in practice: every saveGroup/deleteGroup/
// saveModulePermissions call here is immediately followed by recomputeResolvedPermissions for
// every affected member (src/utils/permissionSync.ts — unionMemberIds/recomputeMemberIds).
//
// Binding guardrails from the Task 3 review, and where each is implemented:
//   (a) A write that commits followed by a recompute that throws must NOT collapse into a
//       generic "השמירה נכשלה" error — see `runRecompute`/`staleNotice`/the
//       data-testid="stale-permissions-banner" banner with a one-click retry
//       (data-testid="retry-stale-recompute"). `runRecompute` also auto-retries once before
//       surfacing the banner, since a first-attempt transient failure shouldn't need a click.
//   (b) Group create/edit/delete recomputes the UNION of before-and-after memberIds (a removed
//       member needs recompute as much as an added one) — `unionMemberIds` from
//       `../utils/permissionSync`, independently unit-tested there, and exercised end-to-end by
//       this file's own component tests (create/edit/delete-group union coverage).
//   (c) `PermissionsService.recomputeAllResolvedPermissions` surviving a single member's failure
//       is implemented in that service module itself (not here) — see its own tests.
//
// Also binding: ownerless modules (`OWNERLESS_MODULES` — income/investments/goals) never offer
// `'own'` as a matrix choice (the rules will never grant it); no UI here changes a member's ROLE
// (claims) — that stays provisioning-script-only per the ledger's claims-downgrade hazard; and
// this component re-checks `role === 'super-admin'` itself (in addition to whatever gate the
// caller applies), so an accidental future render from an unguarded call site still fails closed.
import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, Trash2, UserPlus } from 'lucide-react';
import { listMembers } from '../services/MembersService';
import { listGroups, saveGroup, deleteGroup } from '../services/GroupsService';
import { listPermissionDocs, saveModulePermissions, recomputeResolvedPermissions } from '../services/PermissionsService';
import { unionMemberIds, recomputeMemberIds } from '../utils/permissionSync';
import {
  MODULE_IDS,
  OWNERLESS_MODULES,
  type ModuleId,
  type ModulePermissionMap,
  type PermissionLevel,
  type PermissionRole,
} from '../types/permissions';
import type { Member } from '../utils/seedFromBudgetConfig';
import type { Group, PermissionDoc } from '../types/permissions';

const MODULE_LABELS: Record<ModuleId, string> = {
  expenses: 'הוצאות', income: 'הכנסות', investments: 'השקעות', goals: 'יעדים',
  accounts: 'חשבונות ויתרות', recurring: 'תנועות קבועות', loans: 'הלוואות וחובות', insurances: 'ביטוחים',
};
const LEVEL_LABELS: Record<PermissionLevel, string> = { none: 'ללא', own: 'אישי', family: 'משפחתי' };
const ALL_LEVELS: readonly PermissionLevel[] = ['none', 'own', 'family'] as const;
const ACTIONS = ['view', 'edit'] as const;

// D5: 'own' is meaningless (and denied by the rules) on modules with no owner field. Offering it
// here would imply an access the resolver/rules can never actually grant.
function levelsFor(moduleId: ModuleId): readonly PermissionLevel[] {
  return (OWNERLESS_MODULES as readonly ModuleId[]).includes(moduleId)
    ? (['none', 'family'] as const)
    : ALL_LEVELS;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה לא ידועה');

interface LoadState {
  status: 'loading' | 'error' | 'ready';
  error: string | null;
  members: Member[];
  groups: Group[];
  permissionDocs: PermissionDoc[];
}

interface StaleNotice {
  memberIds: string[];
  message: string;
}

interface GroupDraft {
  name: string;
  memberIds: string[];
  modules: ModulePermissionMap;
}

const EMPTY_DRAFT: GroupDraft = { name: '', memberIds: [], modules: {} };

function setLevelInMap(map: ModulePermissionMap, moduleId: ModuleId, action: 'view' | 'edit', level: PermissionLevel): ModulePermissionMap {
  return {
    ...map,
    [moduleId]: { view: map[moduleId]?.view ?? 'none', edit: map[moduleId]?.edit ?? 'none', [action]: level },
  };
}

function staleMessage(failedCount: number): string {
  return (
    `השינוי נשמר בהצלחה, אך עדכון ההרשאות בפועל נכשל עבור ${failedCount} ` +
    `${failedCount === 1 ? 'בן משפחה' : 'בני משפחה'}. ייתכן שההרשאות המוצגות עבורם אינן מעודכנות — ` +
    `לחץ "נסה לעדכן שוב" כדי לנסות שוב.`
  );
}

export default function PermissionsManager({ actorMemberId, role }: { actorMemberId: string; role: PermissionRole }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', error: null, members: [], groups: [], permissionDocs: [] });
  const [staleNotice, setStaleNotice] = useState<StaleNotice | null>(null);
  const [retryingStale, setRetryingStale] = useState(false);

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [draftModules, setDraftModules] = useState<ModulePermissionMap>({});
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupId, setNewGroupId] = useState('');
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(EMPTY_DRAFT);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

  const isSuperAdmin = role === 'super-admin';

  const load = async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const [members, groups, permissionDocs] = await Promise.all([listMembers(), listGroups(), listPermissionDocs()]);
      setState({ status: 'ready', error: null, members, groups, permissionDocs });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: errMsg(err) || 'שגיאה בטעינת ההרשאות' }));
    }
  };

  useEffect(() => {
    // Defense in depth (Sasha): this component re-checks the role itself even though the caller
    // (App.tsx) is expected to gate the tab entirely. If it's ever mounted without that gate, it
    // must still never issue a `permissions`/`groups` read on behalf of a non-super-admin.
    if (!isSuperAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  // Runs recompute for every affected member id, with one immediate auto-retry for whichever
  // subset still fails, before surfacing the distinct stale-permissions banner (guardrail a).
  const runRecompute = async (memberIds: string[]) => {
    if (memberIds.length === 0) return;
    let result = await recomputeMemberIds(memberIds, recomputeResolvedPermissions);
    if (result.failed.length > 0) {
      const retryIds = result.failed.map((f) => f.memberId);
      const retried = await recomputeMemberIds(retryIds, recomputeResolvedPermissions);
      result = { succeeded: [...result.succeeded, ...retried.succeeded], failed: retried.failed };
    }
    if (result.failed.length > 0) {
      setStaleNotice({ memberIds: result.failed.map((f) => f.memberId), message: staleMessage(result.failed.length) });
    } else {
      setStaleNotice(null);
    }
  };

  const retryStale = async () => {
    if (!staleNotice) return;
    setRetryingStale(true);
    const result = await recomputeMemberIds(staleNotice.memberIds, recomputeResolvedPermissions);
    setStaleNotice(result.failed.length > 0 ? { memberIds: result.failed.map((f) => f.memberId), message: staleMessage(result.failed.length) } : null);
    setRetryingStale(false);
  };

  // ---- Member exception matrix ----

  const startEditMember = (memberId: string) => {
    const existing = state.permissionDocs.find((d) => d.scope === 'member' && d.targetId === memberId);
    setDraftModules(existing?.modules ?? {});
    setEditingMemberId(memberId);
  };

  const saveMemberPermissions = async (memberId: string) => {
    setSavingMemberId(memberId);
    try {
      await saveModulePermissions('member', memberId, draftModules, actorMemberId);
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: `השמירה נכשלה: ${errMsg(err)}` }));
      setSavingMemberId(null);
      return;
    }
    setEditingMemberId(null);
    await load();
    await runRecompute([memberId]);
    setSavingMemberId(null);
  };

  // ---- Groups CRUD (guardrail b: union-of-before/after recompute) ----

  const startEditGroup = (group: Group) => {
    const existingModules = state.permissionDocs.find((d) => d.scope === 'group' && d.targetId === group.id)?.modules ?? {};
    setGroupDraft({ name: group.name, memberIds: [...group.memberIds], modules: existingModules });
    setEditingGroupId(group.id);
    setCreatingGroup(false);
  };

  const startCreateGroup = () => {
    setGroupDraft(EMPTY_DRAFT);
    setNewGroupId('');
    setCreatingGroup(true);
    setEditingGroupId(null);
  };

  const toggleGroupMember = (memberId: string) => {
    setGroupDraft((prev) => ({
      ...prev,
      memberIds: prev.memberIds.includes(memberId)
        ? prev.memberIds.filter((id) => id !== memberId)
        : [...prev.memberIds, memberId],
    }));
  };

  const saveGroupEdit = async (groupId: string, isNew: boolean) => {
    const before = isNew ? [] : (state.groups.find((g) => g.id === groupId)?.memberIds ?? []);
    const after = groupDraft.memberIds;
    setSavingGroupId(groupId);
    try {
      // `before` is also passed as previousMemberIds so GroupsService can sync each affected
      // member's own `.groups` array (arrayUnion for added, arrayRemove for removed) in the same
      // batch as the group doc write — without that, recomputeResolvedPermissions below would
      // never actually see this membership change (it reads member.groups, not group.memberIds).
      await saveGroup({ id: groupId, name: groupDraft.name, memberIds: after }, actorMemberId, before);
      await saveModulePermissions('group', groupId, groupDraft.modules, actorMemberId);
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: `שמירת הקבוצה נכשלה: ${errMsg(err)}` }));
      setSavingGroupId(null);
      return;
    }
    setEditingGroupId(null);
    setCreatingGroup(false);
    await load();
    await runRecompute(unionMemberIds(before, after));
    setSavingGroupId(null);
  };

  const deleteGroupHandler = async (groupId: string) => {
    const before = state.groups.find((g) => g.id === groupId)?.memberIds ?? [];
    setSavingGroupId(groupId);
    try {
      await deleteGroup(groupId, actorMemberId, before);
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: `מחיקת הקבוצה נכשלה: ${errMsg(err)}` }));
      setSavingGroupId(null);
      return;
    }
    setEditingGroupId(null);
    await load();
    await runRecompute(unionMemberIds(before, []));
    setSavingGroupId(null);
  };

  const renderMatrix = (
    idPrefix: string,
    modules: ModulePermissionMap,
    onChange: (moduleId: ModuleId, action: 'view' | 'edit', level: PermissionLevel) => void
  ) => (
    <div className="space-y-2">
      {MODULE_IDS.map((moduleId) => (
        <div key={moduleId} className="flex items-center gap-3 text-sm flex-wrap">
          <span className="w-16 text-slate-600">{MODULE_LABELS[moduleId]}</span>
          {ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-1">
              <span className="text-xs text-slate-400">{action === 'view' ? 'צפייה' : 'עריכה'}</span>
              <select
                data-testid={`${idPrefix}-${moduleId}-${action}`}
                value={modules[moduleId]?.[action] ?? 'none'}
                onChange={(e) => onChange(moduleId, action, e.target.value as PermissionLevel)}
                className="border border-slate-300 rounded px-1 py-0.5 text-xs"
              >
                {levelsFor(moduleId).map((level) => (
                  <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 p-4" dir="rtl">
      <h2 className="text-lg font-bold text-slate-800">ניהול משפחה והרשאות</h2>

      {staleNotice && (
        <div data-testid="stale-permissions-banner" className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl p-3 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p>{staleNotice.message}</p>
            <button
              data-testid="retry-stale-recompute"
              onClick={retryStale}
              disabled={retryingStale}
              className="text-xs font-medium text-amber-900 underline disabled:opacity-60"
            >
              {retryingStale ? 'מנסה שוב...' : 'נסה לעדכן שוב'}
            </button>
          </div>
        </div>
      )}

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-slate-500 p-8"><Loader2 className="w-5 h-5 animate-spin" /> טוען...</div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col items-start gap-2 text-red-600 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> <span>שגיאה: {state.error}</span>
          </div>
          <button onClick={() => load()} className="text-sm text-red-700 underline">נסה שוב</button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {/* Members + per-person exception matrix */}
          <section className="bg-white rounded-xl border border-slate-200 divide-y">
            {state.members.length === 0 && <p className="p-4 text-sm text-slate-400">אין בני משפחה רשומים.</p>}
            {state.members.map((m) => (
              <div key={m.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color }} />
                    <span className="font-medium text-slate-800">{m.name}</span>
                    <span className="text-xs text-slate-400">({m.role})</span>
                  </div>
                  {editingMemberId !== m.id && (
                    <button
                      data-testid={`edit-permissions-${m.id}`}
                      onClick={() => startEditMember(m.id)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      ערוך הרשאות
                    </button>
                  )}
                </div>

                {editingMemberId === m.id && (
                  <div className="mt-3 space-y-2">
                    {renderMatrix(`permission-select-${m.id}`, draftModules, (moduleId, action, level) =>
                      setDraftModules((prev) => setLevelInMap(prev, moduleId, action, level))
                    )}
                    <div className="flex gap-2 pt-2">
                      <button
                        data-testid={`save-permissions-${m.id}`}
                        onClick={() => saveMemberPermissions(m.id)}
                        disabled={savingMemberId === m.id}
                        className="flex items-center gap-1 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-60"
                      >
                        {savingMemberId === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        שמור
                      </button>
                      <button onClick={() => setEditingMemberId(null)} className="text-xs text-slate-500">ביטול</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* Groups CRUD + per-group matrix */}
          <section className="bg-white rounded-xl border border-slate-200 divide-y">
            <div className="p-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 text-sm">קבוצות</h3>
              <button
                data-testid="create-group-button"
                onClick={startCreateGroup}
                className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                <UserPlus className="w-4 h-4" /> הוסף קבוצה
              </button>
            </div>

            {state.groups.length === 0 && !creatingGroup && (
              <p className="p-4 text-sm text-slate-400">אין קבוצות מוגדרות.</p>
            )}

            {creatingGroup && (
              <div className="p-4 space-y-3 bg-slate-50">
                <div className="flex gap-2">
                  <input
                    data-testid="new-group-id-input"
                    value={newGroupId}
                    onChange={(e) => setNewGroupId(e.target.value)}
                    placeholder="מזהה (אנגלית, ללא רווחים)"
                    className="border border-slate-300 rounded px-2 py-1 text-sm flex-1"
                  />
                  <input
                    data-testid="new-group-name-input"
                    value={groupDraft.name}
                    onChange={(e) => setGroupDraft((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="שם הקבוצה"
                    className="border border-slate-300 rounded px-2 py-1 text-sm flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  {state.members.map((m) => (
                    <label key={m.id} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        data-testid={`new-group-member-${m.id}`}
                        checked={groupDraft.memberIds.includes(m.id)}
                        onChange={() => toggleGroupMember(m.id)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
                {renderMatrix('group-permission-select-new', groupDraft.modules, (moduleId, action, level) =>
                  setGroupDraft((prev) => ({ ...prev, modules: setLevelInMap(prev.modules, moduleId, action, level) }))
                )}
                <div className="flex gap-2">
                  <button
                    data-testid="save-group-new"
                    onClick={() => newGroupId.trim() && saveGroupEdit(newGroupId.trim(), true)}
                    disabled={!newGroupId.trim() || !groupDraft.name.trim() || savingGroupId === newGroupId.trim()}
                    className="flex items-center gap-1 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    <Save className="w-3 h-3" /> צור קבוצה
                  </button>
                  <button onClick={() => setCreatingGroup(false)} className="text-xs text-slate-500">ביטול</button>
                </div>
              </div>
            )}

            {state.groups.map((g) => (
              <div key={g.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-slate-800">{g.name}</span>
                    <span className="text-xs text-slate-400 mr-2">({g.memberIds.length} חברים)</span>
                  </div>
                  {editingGroupId !== g.id && (
                    <button
                      data-testid={`edit-group-${g.id}`}
                      onClick={() => startEditGroup(g)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      ערוך קבוצה
                    </button>
                  )}
                </div>

                {editingGroupId === g.id && (
                  <div className="mt-3 space-y-3">
                    <input
                      data-testid={`group-name-input-${g.id}`}
                      value={groupDraft.name}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, name: e.target.value }))}
                      className="border border-slate-300 rounded px-2 py-1 text-sm w-full"
                    />
                    <div className="flex flex-wrap gap-3">
                      {state.members.map((m) => (
                        <label key={m.id} className="flex items-center gap-1 text-sm">
                          <input
                            type="checkbox"
                            data-testid={`group-member-checkbox-${g.id}-${m.id}`}
                            checked={groupDraft.memberIds.includes(m.id)}
                            onChange={() => toggleGroupMember(m.id)}
                          />
                          {m.name}
                        </label>
                      ))}
                    </div>
                    {renderMatrix(`group-permission-select-${g.id}`, groupDraft.modules, (moduleId, action, level) =>
                      setGroupDraft((prev) => ({ ...prev, modules: setLevelInMap(prev.modules, moduleId, action, level) }))
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        data-testid={`save-group-${g.id}`}
                        onClick={() => saveGroupEdit(g.id, false)}
                        disabled={savingGroupId === g.id}
                        className="flex items-center gap-1 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-60"
                      >
                        {savingGroupId === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        שמור
                      </button>
                      <button
                        data-testid={`delete-group-${g.id}`}
                        onClick={() => deleteGroupHandler(g.id)}
                        disabled={savingGroupId === g.id}
                        className="flex items-center gap-1 text-red-600 text-xs px-3 py-1.5 rounded-lg border border-red-200 disabled:opacity-60"
                      >
                        <Trash2 className="w-3 h-3" /> מחק קבוצה
                      </button>
                      <button onClick={() => setEditingGroupId(null)} className="text-xs text-slate-500">ביטול</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
