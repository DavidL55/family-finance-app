// Stage 5 Task 4 — LoansScreen, built on the shared useOwnedCollectionScreen<T> hook (D13) the
// same way AccountsScreen (Task 3) is. Loans is the first screen with real user-entered dates
// (startDate/endDate) — Accounts had none — so this is where the B3 native-date-control
// requirement and the endDate>startDate client-side validation (confirmed absent from both
// firestore.rules' isValidLoan and any client validator before this task) land for real.
import React, { useEffect, useState } from 'react';
import { listLoans, saveLoan, deleteLoan } from '../services/LoansService';
import { useNavigation } from '../contexts/NavigationContext';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';
import { OwnerPicker } from './OwnerPicker';
import { ScopeBadge } from './ScopeBadge';
import { Explain } from './Explain';
import { confirmLargeAmount } from '../utils/amountConfirm';
import type { Loan, LoanType, LoanStatus } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בהלוואות אלו';
const LOAD_ERROR_MESSAGE = 'טעינת ההלוואות נכשלה. בדוק את החיבור ונסה שוב.';
const NAME_REQUIRED_MESSAGE = 'יש להזין שם להלוואה';
const START_DATE_REQUIRED_MESSAGE = 'יש לבחור תאריך התחלה';
const END_DATE_REQUIRED_MESSAGE = 'יש לבחור תאריך סיום';
const DATE_ORDER_MESSAGE = 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה';
const PRINCIPAL_INVALID_MESSAGE = 'יש להזין סכום קרן תקין';
const BALANCE_INVALID_MESSAGE = 'יש להזין יתרה תקינה';
const INTEREST_RATE_INVALID_MESSAGE = 'יש להזין ריבית תקינה';
const MONTHLY_PAYMENT_INVALID_MESSAGE = 'יש להזין תשלום חודשי תקין';

const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  mortgage: 'משכנתא',
  personal: 'הלוואה אישית',
  creditLine: 'מסגרת אשראי',
  other: 'אחר',
};

export interface LoansScreenProps {
  session: { memberId: string; role: PermissionRole };
  loansViewLevel: PermissionLevel | undefined;
  loansEditLevel: PermissionLevel | undefined;
}

interface FormState {
  name: string;
  loanType: LoanType;
  principal: string;
  balance: string;
  interestRate: string;
  monthlyPayment: string;
  startDate: string;
  endDate: string;
  status: LoanStatus;
  ownerId: string;
}

const BLANK_FORM = (ownerId: string): FormState => ({
  name: '',
  loanType: 'mortgage',
  principal: '',
  balance: '',
  interestRate: '',
  monthlyPayment: '',
  startDate: '',
  endDate: '',
  status: 'active',
  ownerId,
});

// Spec §6's own named requirement for this module ("יתרה, ריבית, לוח סילוקין, 'כמה נשאר'") —
// clamped [0, 100] so a stale/corrupted balance greater than principal (shouldn't happen, but not
// enforced anywhere) never renders a nonsensical negative or >100% figure.
function paidOffPct(principal: number, balance: number): number {
  if (principal <= 0) return 0;
  const pct = Math.round((1 - balance / principal) * 100);
  return Math.min(100, Math.max(0, pct));
}

export default function LoansScreen({ session, loansViewLevel, loansEditLevel }: LoansScreenProps): React.JSX.Element {
  const { familyMembers } = useGlobalFilters();
  const { navigationPayload, consumePayload } = useNavigation();
  const screen = useOwnedCollectionScreen<Loan>({
    list: listLoans,
    save: saveLoan,
    remove: deleteLoan,
    session,
    viewLevel: loansViewLevel,
    editLevel: loansEditLevel,
    loadErrorMessage: LOAD_ERROR_MESSAGE,
  });
  const [form, setForm] = useState<FormState>(BLANK_FORM(session.memberId));
  const [formError, setFormError] = useState<string | null>(null);

  // D3 pre-fill affordance — same shape as AccountsScreen's, for a legacy settings/ecosystem
  // mortgage value the Net Worth screen (Task 5) may offer to import as a loan.
  useEffect(() => {
    const prefill = (
      navigationPayload as { prefillCreate?: { name: string; loanType: LoanType; principal: number; balance: number } } | null
    )?.prefillCreate;
    if (!prefill) return;
    setForm({
      name: prefill.name,
      loanType: prefill.loanType,
      principal: String(prefill.principal),
      balance: String(prefill.balance),
      interestRate: '',
      monthlyPayment: '',
      startDate: '',
      endDate: '',
      status: 'active',
      ownerId: session.memberId,
    });
    screen.openCreate();
    consumePayload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationPayload]);

  useEffect(() => {
    if (screen.editing) {
      const l = screen.editing;
      setForm({
        name: l.name,
        loanType: l.loanType,
        principal: String(l.principal),
        balance: String(l.balance),
        interestRate: String(l.interestRate),
        monthlyPayment: String(l.monthlyPayment),
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        ownerId: l.ownerId,
      });
    } else if (screen.isFormOpen) {
      setForm((f) => (f.name || f.principal ? f : BLANK_FORM(session.memberId)));
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
    // no-op and never a browser-native alert. The date-order check runs before the numeric-field
    // checks: a loan whose payoff date precedes its start date is nonsensical (and would corrupt
    // the payoff-progress math below) regardless of what the money fields say, so it's caught
    // first.
    if (form.name.trim() === '') {
      setFormError(NAME_REQUIRED_MESSAGE);
      return;
    }
    if (form.startDate.trim() === '') {
      setFormError(START_DATE_REQUIRED_MESSAGE);
      return;
    }
    if (form.endDate.trim() === '') {
      setFormError(END_DATE_REQUIRED_MESSAGE);
      return;
    }
    // ISO YYYY-MM-DD string comparison is safe here — both fields come from
    // <input type="date">, which always emits that format (task-4-brief.md).
    if (form.endDate <= form.startDate) {
      setFormError(DATE_ORDER_MESSAGE);
      return;
    }
    const principal = Number(form.principal);
    if (form.principal.trim() === '' || Number.isNaN(principal)) {
      setFormError(PRINCIPAL_INVALID_MESSAGE);
      return;
    }
    const balance = Number(form.balance);
    if (form.balance.trim() === '' || Number.isNaN(balance)) {
      setFormError(BALANCE_INVALID_MESSAGE);
      return;
    }
    const interestRate = Number(form.interestRate);
    if (form.interestRate.trim() === '' || Number.isNaN(interestRate)) {
      setFormError(INTEREST_RATE_INVALID_MESSAGE);
      return;
    }
    const monthlyPayment = Number(form.monthlyPayment);
    if (form.monthlyPayment.trim() === '' || Number.isNaN(monthlyPayment)) {
      setFormError(MONTHLY_PAYMENT_INVALID_MESSAGE);
      return;
    }
    if (!confirmLargeAmount(balance)) return; // D14 — soft confirm, user can still decline
    await screen.submit({
      ownerId: form.ownerId,
      name: form.name.trim(),
      loanType: form.loanType,
      principal,
      balance,
      interestRate,
      monthlyPayment,
      startDate: form.startDate,
      endDate: form.endDate,
      status: form.status,
    });
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
        טוען הלוואות...
      </div>
    );
  }

  const members = familyMembers.status === 'ready' ? familyMembers.members : [];
  const totalBalance = screen.visibleItems.filter((l) => l.status === 'active').reduce((sum, l) => sum + l.balance, 0);

  return (
    <div className="space-y-4" data-tour-id="screen.loans.list" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">הלוואות וחובות</h2>
          <span className="text-sm text-slate-500">סך היתרה שנותרה: ₪{totalBalance.toLocaleString()}</span>
          <Explain id="loans.totalBalance" />
          <ScopeBadge scope={screen.viewScope} />
        </div>
        {screen.editScope !== 'none' && (
          <button
            data-testid="screen.loans.create"
            data-tour-id="screen.loans.create"
            onClick={screen.openCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium"
          >
            הלוואה חדשה
          </button>
        )}
      </div>

      {screen.visibleItems.length === 0 ? (
        <p className="text-slate-400 text-center py-8">עדיין לא הוספתם הלוואות.</p>
      ) : (
        <div className="space-y-2">
          {screen.visibleItems.map((l) => {
            const pct = paidOffPct(l.principal, l.balance);
            return (
              <div key={l.id} className="bg-white rounded-xl border border-slate-100 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">
                      {l.name}
                      {l.status === 'paid-off' && (
                        <span className="ms-2 text-xs bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">שולמה במלואה</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span>
                        {LOAN_TYPE_LABELS[l.loanType]} · ריבית {l.interestRate}%
                      </span>
                      <Explain id="loans.rowInterestRate" />
                      <span>· תשלום חודשי ₪{l.monthlyPayment.toLocaleString()}</span>
                      <Explain id="loans.rowMonthlyPayment" />
                    </p>
                  </div>
                  {screen.editScope !== 'none' && (
                    <div className="flex gap-2">
                      <button
                        data-tour-id="screen.loans.row.edit"
                        onClick={() => screen.openEdit(l)}
                        className="text-sm text-blue-600 min-h-[44px] px-2"
                      >
                        עריכה
                      </button>
                      <button
                        data-testid="screen.loans.row.delete"
                        data-tour-id="screen.loans.row.delete"
                        onClick={() => screen.requestDelete(l.id)}
                        className="text-sm text-red-600 min-h-[44px] px-2"
                      >
                        מחיקה
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <div className="w-full bg-slate-100 rounded-full h-2" aria-hidden="true">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <span>
                      {pct}% שולם, נשארו ₪{l.balance.toLocaleString()}
                    </span>
                    <Explain id="loans.payoffProgress" />
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {screen.isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">שם ההלוואה</span>
            <input
              aria-label="שם ההלוואה"
              value={form.name}
              onChange={(e) => updateForm('name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סוג הלוואה</span>
            <select
              aria-label="סוג הלוואה"
              value={form.loanType}
              onChange={(e) => updateForm('loanType', e.target.value as LoanType)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              {(Object.keys(LOAN_TYPE_LABELS) as LoanType[]).map((t) => (
                <option key={t} value={t}>
                  {LOAN_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">תאריך התחלה</span>
              {/* B3 — native date control, never free-text; Loans is the first screen with real
                  user-entered dates, so this is where that requirement actually gets exercised. */}
              <input
                aria-label="תאריך התחלה"
                type="date"
                value={form.startDate}
                onChange={(e) => updateForm('startDate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">תאריך סיום</span>
              <input
                aria-label="תאריך סיום"
                type="date"
                value={form.endDate}
                onChange={(e) => updateForm('endDate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">סכום קרן</span>
              {/* B3 — inputMode="decimal" on every money field */}
              <input
                aria-label="סכום קרן"
                type="number"
                inputMode="decimal"
                value={form.principal}
                onChange={(e) => updateForm('principal', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">יתרה נוכחית</span>
              <input
                aria-label="יתרה נוכחית"
                type="number"
                inputMode="decimal"
                value={form.balance}
                onChange={(e) => updateForm('balance', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">ריבית שנתית (%)</span>
              {/* A percentage is still numeric entry, same keyboard need as money fields. */}
              <input
                aria-label="ריבית שנתית (%)"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={form.interestRate}
                onChange={(e) => updateForm('interestRate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">תשלום חודשי</span>
              <input
                aria-label="תשלום חודשי"
                type="number"
                inputMode="decimal"
                value={form.monthlyPayment}
                onChange={(e) => updateForm('monthlyPayment', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סטטוס</span>
            <select
              aria-label="סטטוס"
              value={form.status}
              onChange={(e) => updateForm('status', e.target.value as LoanStatus)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              <option value="active">פעילה</option>
              <option value="paid-off">שולמה במלואה</option>
            </select>
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
          <p>למחוק את ההלוואה?</p>
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
