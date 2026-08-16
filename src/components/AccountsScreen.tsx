// Stage 5 Task 3 — the first owned-collection screen, and the template Tasks 4/6/7 (Loans/
// Recurring/Insurances) build on. All the loading/ready/error/permission-denied state machine,
// מי-filtering, create/edit/delete plumbing, and the I4 dirty-form leave-guard live in
// useOwnedCollectionScreen<T> (D13) — this file supplies only field config, row rendering, and
// the local total.
import React, { useEffect, useState } from 'react';
import { listAccounts, saveAccount, deleteAccount } from '../services/AccountsService';
import { useNavigation } from '../contexts/NavigationContext';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';
import { OwnerPicker } from './OwnerPicker';
import { ScopeBadge } from './ScopeBadge';
import { Explain } from './Explain';
import { confirmLargeAmount } from '../utils/amountConfirm';
import type { Account, AccountType } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בחשבונות אלו';
const LOAD_ERROR_MESSAGE = 'טעינת החשבונות נכשלה. בדוק את החיבור ונסה שוב.';
const SAVE_ERROR_MESSAGE = 'שמירת החשבון נכשלה';
const NAME_REQUIRED_MESSAGE = 'יש להזין שם לחשבון';
const BALANCE_INVALID_MESSAGE = 'יש להזין סכום תקין';
const TYPE_LABELS: Record<AccountType, string> = { bank: 'בנק', cash: 'מזומן', credit: 'אשראי' };

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה לא ידועה');

export interface AccountsScreenProps {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel: PermissionLevel | undefined;
  accountsEditLevel: PermissionLevel | undefined;
}

interface FormState {
  name: string;
  type: AccountType;
  balance: string;
  status: 'active' | 'archived';
  ownerId: string;
}

const BLANK_FORM = (ownerId: string): FormState => ({ name: '', type: 'bank', balance: '', status: 'active', ownerId });

export default function AccountsScreen({ session, accountsViewLevel, accountsEditLevel }: AccountsScreenProps): React.JSX.Element {
  const { familyMembers } = useGlobalFilters();
  const { navigationPayload, consumePayload } = useNavigation();
  const screen = useOwnedCollectionScreen<Account>({
    list: listAccounts,
    save: saveAccount,
    remove: deleteAccount,
    session,
    viewLevel: accountsViewLevel,
    editLevel: accountsEditLevel,
    loadErrorMessage: LOAD_ERROR_MESSAGE,
  });
  const [form, setForm] = useState<FormState>(BLANK_FORM(session.memberId));
  const [formError, setFormError] = useState<string | null>(null);

  // D3 pre-fill affordance — a payload from the Net Worth screen's incomplete notice (Task 5)
  // opens the create form pre-populated from a legacy settings/ecosystem value. Consumed once, so
  // a re-render (or navigating away and back without a fresh navigateTo call) never re-opens it.
  useEffect(() => {
    const prefill = (navigationPayload as { prefillCreate?: { name: string; type: AccountType; balance: number } } | null)
      ?.prefillCreate;
    if (!prefill) return;
    setForm({ name: prefill.name, type: prefill.type, balance: String(prefill.balance), status: 'active', ownerId: session.memberId });
    screen.openCreate();
    consumePayload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationPayload]);

  useEffect(() => {
    if (screen.editing) {
      const a = screen.editing;
      setForm({ name: a.name, type: a.type, balance: String(a.balance), status: a.status, ownerId: a.ownerId });
    } else if (screen.isFormOpen) {
      setForm((f) => (f.name || f.balance ? f : BLANK_FORM(session.memberId)));
    }
  }, [screen.editing, screen.isFormOpen, session.memberId]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
    screen.markDirty(true);
    setFormError(null);
  }

  function closeForm(): void {
    screen.closeForm();
    setForm(BLANK_FORM(session.memberId));
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    // Validation-error UX — explicit, inline, in the household's own language; never a silent
    // no-op and never a browser-native alert. Checked BEFORE the soft large-amount confirm below,
    // so a fat-fingered figure with a missing name gets exactly one message, not two prompts.
    if (form.name.trim() === '') {
      setFormError(NAME_REQUIRED_MESSAGE);
      return;
    }
    const balance = Number(form.balance);
    if (form.balance.trim() === '' || Number.isNaN(balance)) {
      setFormError(BALANCE_INVALID_MESSAGE);
      return;
    }
    if (!confirmLargeAmount(balance)) return; // D14 — soft confirm, user can still decline
    // Account (types/finance.ts) has no optional fields — every key below is required, so
    // financeCollections.ts's save() undefined/null contract (see that file's header) has nothing
    // to apply here; this payload is always fully determined.
    //
    // Fix 2 (review, post-Stage-5): balanceUpdatedAt feeds netWorth.ts's per-line `asOf`
    // disclosure ("נכון ל..."). Stamping `new Date().toISOString()` unconditionally on EVERY
    // submit — even an edit that only changed the account's name — made that disclosure claim the
    // balance was refreshed just now when it wasn't touched. Since the field is required (not
    // optional) on Account, there's no "leave unchanged" input via undefined (financeCollections's
    // save() contract only grants that escape hatch to optional fields) — so on a genuine create
    // (screen.editing === null) it's freshly stamped as before, and on an edit it's re-stamped
    // only when the balance value itself actually changed; otherwise the existing stored stamp is
    // sent back through unchanged, which is a no-op write for that field.
    const balanceUpdatedAt =
      screen.editing && screen.editing.balance === balance ? screen.editing.balanceUpdatedAt : new Date().toISOString();
    try {
      await screen.submit({
        ownerId: form.ownerId,
        name: form.name.trim(),
        type: form.type,
        balance,
        balanceUpdatedAt,
        status: form.status,
      });
    } catch (err) {
      setFormError(`${SAVE_ERROR_MESSAGE}: ${errMsg(err)}`);
      return;
    }
    setForm(BLANK_FORM(session.memberId));
    setFormError(null);
  }

  if (screen.status === 'permission-denied') {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm" dir="rtl">
        {ACCESS_DENIED_MESSAGE}
      </div>
    );
  }
  if (screen.status === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center" dir="rtl">
        <p className="text-red-600 font-medium">{screen.errorMessage}</p>
      </div>
    );
  }
  if (screen.status === 'loading') {
    return (
      <div className="p-8 text-center text-slate-500" dir="rtl">
        טוען חשבונות...
      </div>
    );
  }

  const members = familyMembers.status === 'ready' ? familyMembers.members : [];
  const totalBalance = screen.visibleItems.filter((a) => a.status === 'active').reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="space-y-4" data-tour-id="screen.accounts.list" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">חשבונות ויתרות</h2>
          <span className="text-sm text-slate-500">סך היתרות: ₪{totalBalance.toLocaleString()}</span>
          <Explain id="accounts.totalBalance" />
          <ScopeBadge scope={screen.viewScope} />
        </div>
        {screen.editScope !== 'none' && (
          <button
            data-testid="screen.accounts.create"
            data-tour-id="screen.accounts.create"
            onClick={screen.openCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium"
          >
            חשבון חדש
          </button>
        )}
      </div>

      {screen.visibleItems.length === 0 ? (
        <p className="text-slate-400 text-center py-8">עדיין לא הוספתם חשבונות.</p>
      ) : (
        <div className="space-y-2">
          {screen.visibleItems.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800">
                  {a.name}
                  {a.status === 'archived' && (
                    <span className="ms-2 text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">ארכיון</span>
                  )}
                </p>
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <span>
                    {TYPE_LABELS[a.type]} · ₪{a.balance.toLocaleString()}
                  </span>
                  {/* Every rendered number gets an Explain, not just the aggregate total (spec's
                      own "כל מספר" requirement). */}
                  <Explain id="accounts.rowBalance" />
                </p>
              </div>
              {screen.editScope !== 'none' && (
                <div className="flex gap-2">
                  <button
                    data-tour-id="screen.accounts.row.edit"
                    onClick={() => screen.openEdit(a)}
                    className="text-sm text-blue-600 min-h-[44px] px-2"
                  >
                    עריכה
                  </button>
                  <button
                    data-testid="screen.accounts.row.delete"
                    data-tour-id="screen.accounts.row.delete"
                    onClick={() => screen.requestDelete(a.id)}
                    className="text-sm text-red-600 min-h-[44px] px-2"
                  >
                    מחיקה
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {screen.isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">שם החשבון</span>
            <input
              aria-label="שם החשבון"
              value={form.name}
              onChange={(e) => updateForm('name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סוג</span>
            <select
              aria-label="סוג"
              value={form.type}
              onChange={(e) => updateForm('type', e.target.value as AccountType)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">יתרה</span>
            {/* B3 — inputMode="decimal", never a bare text keyboard on a money field */}
            <input
              aria-label="יתרה"
              type="number"
              inputMode="decimal"
              value={form.balance}
              onChange={(e) => updateForm('balance', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </label>
          <OwnerPicker
            members={members}
            value={form.ownerId}
            onChange={(id) => updateForm('ownerId', id)}
            editLevel={screen.editScope}
            actingMemberId={session.memberId}
          />
          {formError && (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={closeForm} className="text-sm text-slate-500 min-h-[44px] px-3">
              ביטול
            </button>
            <button type="submit" className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium">
              שמור
            </button>
          </div>
        </form>
      )}

      {screen.pendingDeleteId && (
        <div className="bg-white rounded-2xl border border-red-200 p-4 space-y-3" dir="rtl">
          <p>למחוק את החשבון?</p>
          <div className="flex gap-2 justify-end">
            <button onClick={screen.cancelDelete} className="text-sm text-slate-500 min-h-[44px] px-3">
              ביטול
            </button>
            <button onClick={screen.confirmDelete} className="bg-red-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium">
              כן, מחק
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
