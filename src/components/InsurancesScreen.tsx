// Stage 5 Task 6 — InsurancesScreen, built on the shared useOwnedCollectionScreen<T> hook (D13)
// exactly as AccountsScreen (Task 3) and LoansScreen (Task 4) are — the hook needed ZERO changes
// for this screen either (see task-6-report.md), confirming Task 4's own prediction that
// Insurances (the plan's own named stress test for the abstraction) would still fit.
//
// The real deltas this collection introduces, all handled entirely in THIS file (never in the
// hook):
//   - insuredMemberId is a SECOND member reference, distinct from ownerId ("who pays/owns the
//     policy" vs "who is covered" — types/finance.ts's own comment: "may differ from ownerId
//     (parent owns, child insured)"). Rendered as a plain <select>, deliberately NOT OwnerPicker —
//     isValidInsurance only requires it non-empty, with no own/family Rules restriction of its
//     own, so every viewer who can create a policy at all may name any insured member.
//   - coverages: Coverage[] is a dynamic add/remove list of { label, amount? } rows.
//   - renewalDate is a native <input type="date">, with a "מתחדש בקרוב" callout badge computed
//     with plain Date arithmetic (no library) when the policy renews within 30 days.
//   - documentId is rendered as a plain text reference ("מסמך מקושר: {id}") when present — no
//     picker, no archive UI. The `documents` collection this would eventually point at has no
//     Firestore rules match block (a confirmed, dated risk in the stage plan); building a link
//     that likely can't be written in production today would be pretending it resolves. This
//     form NEVER sends `documentId` in its submit payload (below) — not even `null` — because it
//     has no UI to let the household set OR clear it; omitting the key means "not managed by this
//     form, leave unchanged" per financeCollections.ts's save() contract, so an edit through this
//     screen can no longer silently wipe a documentId some other path (e.g. a future
//     Drive-sync/upload flow) already populated — the ship-blocker this file used to have before
//     that contract existed.
//
// One screen, not a two-step (basics/coverages) wizard — see task-6-report.md's "one-screen-vs-
// two-step" section for the full UX ruling. Short version: the form is grouped into visually
// distinct sections (identity, money, coverages, status/owner) exactly like Loans already groups
// its paired date/money fields into grid-cols-2 rows; a second form-shape pattern (a wizard) would
// duplicate the dirty-form leave-guard/state-machine one level up for a form that already fits one
// scrolling screen once it's organized, not force-split it.
import React, { useState } from 'react';
import { listInsurances, saveInsurance, deleteInsurance } from '../services/InsurancesService';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';
import { OwnerPicker } from './OwnerPicker';
import { ScopeBadge } from './ScopeBadge';
import { Explain } from './Explain';
import { confirmLargeAmount } from '../utils/amountConfirm';
import type { Insurance, InsuranceType, InsuranceStatus, PremiumFrequency, Coverage } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בביטוחים אלו';
const LOAD_ERROR_MESSAGE = 'טעינת הביטוחים נכשלה. בדוק את החיבור ונסה שוב.';
const SAVE_ERROR_MESSAGE = 'שמירת הביטוח נכשלה';
const PROVIDER_REQUIRED_MESSAGE = 'יש להזין את שם חברת הביטוח';
const INSURED_MEMBER_REQUIRED_MESSAGE = 'יש לבחור מי מבוטח בפוליסה';
const RENEWAL_DATE_REQUIRED_MESSAGE = 'יש לבחור תאריך חידוש';
const PREMIUM_INVALID_MESSAGE = 'יש להזין פרמיה תקינה';
const COVERAGE_LABEL_REQUIRED_MESSAGE = 'יש להזין תיאור לכל כיסוי שהוזן לו סכום';

const TYPE_LABELS: Record<InsuranceType, string> = {
  life: 'חיים',
  health: 'בריאות',
  car: 'רכב',
  home: 'דירה',
  other: 'אחר',
};
const STATUS_LABELS: Record<InsuranceStatus, string> = {
  active: 'פעילה',
  lapsed: 'פגה תוקף',
  cancelled: 'מבוטלת',
};
const FREQUENCY_LABELS: Record<PremiumFrequency, string> = {
  monthly: 'חודשי',
  yearly: 'שנתי',
};

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : 'שגיאה לא ידועה');

// Renewal-soon callout — plain Date arithmetic, no library, per B3. Both sides are normalized to
// midnight-UTC via an ISO date-only string round-trip so the day-count diff is never off by one
// depending on the runtime's local timezone (renewalDate is always a bare YYYY-MM-DD, never a
// timestamp).
function isRenewingSoon(renewalDate: string): boolean {
  const todayIso = new Date().toISOString().slice(0, 10);
  const diffDays = Math.round((new Date(renewalDate).getTime() - new Date(todayIso).getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= 30;
}

export interface InsurancesScreenProps {
  session: { memberId: string; role: PermissionRole };
  insurancesViewLevel: PermissionLevel | undefined;
  insurancesEditLevel: PermissionLevel | undefined;
}

interface CoverageFormRow {
  label: string;
  amount: string;
}

interface FormState {
  type: InsuranceType;
  provider: string;
  insuredMemberId: string;
  premium: string;
  premiumFrequency: PremiumFrequency;
  coverages: CoverageFormRow[];
  renewalDate: string;
  status: InsuranceStatus;
  ownerId: string;
}

const BLANK_FORM = (memberId: string): FormState => ({
  type: 'life',
  provider: '',
  insuredMemberId: memberId,
  premium: '',
  premiumFrequency: 'monthly',
  coverages: [],
  renewalDate: '',
  status: 'active',
  ownerId: memberId,
});

export default function InsurancesScreen({
  session,
  insurancesViewLevel,
  insurancesEditLevel,
}: InsurancesScreenProps): React.JSX.Element {
  const { familyMembers } = useGlobalFilters();
  const screen = useOwnedCollectionScreen<Insurance>({
    list: listInsurances,
    save: saveInsurance,
    remove: deleteInsurance,
    session,
    viewLevel: insurancesViewLevel,
    editLevel: insurancesEditLevel,
    loadErrorMessage: LOAD_ERROR_MESSAGE,
  });
  const [form, setForm] = useState<FormState>(BLANK_FORM(session.memberId));
  const [formError, setFormError] = useState<string | null>(null);

  React.useEffect(() => {
    if (screen.editing) {
      const i = screen.editing;
      setForm({
        type: i.type,
        provider: i.provider,
        insuredMemberId: i.insuredMemberId,
        premium: String(i.premium),
        premiumFrequency: i.premiumFrequency,
        coverages: i.coverages.map((c) => ({ label: c.label, amount: c.amount !== undefined ? String(c.amount) : '' })),
        renewalDate: i.renewalDate,
        status: i.status,
        ownerId: i.ownerId,
      });
    } else if (screen.isFormOpen) {
      setForm((f) => (f.provider || f.premium ? f : BLANK_FORM(session.memberId)));
    }
  }, [screen.editing, screen.isFormOpen, session.memberId]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
    screen.markDirty(true);
    setFormError(null);
  }

  function addCoverage(): void {
    setForm((f) => ({ ...f, coverages: [...f.coverages, { label: '', amount: '' }] }));
    screen.markDirty(true);
  }
  function updateCoverage(idx: number, key: keyof CoverageFormRow, value: string): void {
    setForm((f) => ({ ...f, coverages: f.coverages.map((c, i) => (i === idx ? { ...c, [key]: value } : c)) }));
    screen.markDirty(true);
    setFormError(null);
  }
  function removeCoverage(idx: number): void {
    setForm((f) => ({ ...f, coverages: f.coverages.filter((_, i) => i !== idx) }));
    screen.markDirty(true);
  }

  function closeForm(): void {
    screen.closeForm();
    setForm(BLANK_FORM(session.memberId));
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    // Validation-error UX — explicit, inline, in the household's own language; never a silent
    // no-op and never a browser-native alert. Order: provider -> insuredMemberId (defensive; the
    // <select> always carries a default so this should never actually fire in practice) ->
    // renewalDate -> premium -> coverage label (for any row with an amount) -> soft confirm.
    if (form.provider.trim() === '') {
      setFormError(PROVIDER_REQUIRED_MESSAGE);
      return;
    }
    if (form.insuredMemberId.trim() === '') {
      setFormError(INSURED_MEMBER_REQUIRED_MESSAGE);
      return;
    }
    if (form.renewalDate.trim() === '') {
      setFormError(RENEWAL_DATE_REQUIRED_MESSAGE);
      return;
    }
    const premium = Number(form.premium);
    if (form.premium.trim() === '' || Number.isNaN(premium)) {
      setFormError(PREMIUM_INVALID_MESSAGE);
      return;
    }
    // A coverage row with an amount but no label represents a real figure the household typed in
    // (e.g. ₪500,000 of hospitalization coverage) — dropping it silently on submit would lose that
    // entered financial data with no warning. Block submit and ask for the label instead, same
    // inline-error pattern as every other required field on this form. A row that's entirely blank
    // (no label AND no amount) is genuinely empty — the household opened it via "הוסף כיסוי" and
    // never filled it in — so it stays safe to drop without complaint (see the filter below).
    const coverageMissingLabel = form.coverages.some((c) => c.label.trim() === '' && c.amount.trim() !== '');
    if (coverageMissingLabel) {
      setFormError(COVERAGE_LABEL_REQUIRED_MESSAGE);
      return;
    }
    if (!confirmLargeAmount(premium)) return; // D14 — soft confirm, user can still decline

    // Every remaining row either has a label (kept) or is entirely blank (dropped, see comment
    // above) — the guard above already ruled out "amount but no label" ever reaching this filter.
    // Amount is optional per the Coverage type (isValidInsurance only requires `coverages is
    // list`, no per-item shape), so a row with a label but no amount keeps `amount: undefined`.
    const coverages: Coverage[] = form.coverages
      .filter((c) => c.label.trim() !== '')
      .map((c) => {
        const amt = Number(c.amount);
        return c.amount.trim() !== '' && !Number.isNaN(amt) ? { label: c.label.trim(), amount: amt } : { label: c.label.trim() };
      });

    try {
      await screen.submit({
        ownerId: form.ownerId,
        type: form.type,
        provider: form.provider.trim(),
        insuredMemberId: form.insuredMemberId,
        premium,
        premiumFrequency: form.premiumFrequency,
        coverages,
        renewalDate: form.renewalDate,
        status: form.status,
        // documentId deliberately absent — see the module header comment. This form has no UI to
        // set or clear it, so per the save() contract it's left unchanged, never wiped.
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
        טוען ביטוחים...
      </div>
    );
  }

  const members = familyMembers.status === 'ready' ? familyMembers.members : [];
  const memberName = (id: string): string => members.find((m) => m.id === id)?.name ?? '—';
  // Active-only, same convention accounts.totalBalance/loans.totalBalance already established —
  // a lapsed/cancelled policy no longer represents real monthly spend. A yearly premium is
  // divided by 12 before summing so the total is always a comparable monthly figure (spec's own
  // "totalPremium" requirement — see insurances.totalPremium glossary copy).
  const totalPremium = screen.visibleItems
    .filter((i) => i.status === 'active')
    .reduce((sum, i) => sum + (i.premiumFrequency === 'yearly' ? i.premium / 12 : i.premium), 0);

  return (
    <div className="space-y-4" data-tour-id="screen.insurances.list" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">ביטוחים</h2>
          <span className="text-sm text-slate-500">סך הפרמיה החודשית: ₪{Math.round(totalPremium).toLocaleString()}</span>
          <Explain id="insurances.totalPremium" />
          <ScopeBadge scope={screen.viewScope} />
        </div>
        {screen.editScope !== 'none' && (
          <button
            data-testid="screen.insurances.create"
            data-tour-id="screen.insurances.create"
            onClick={screen.openCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium"
          >
            פוליסה חדשה
          </button>
        )}
      </div>

      {screen.visibleItems.length === 0 ? (
        <p className="text-slate-400 text-center py-8">
          עדיין לא הוספתם פוליסות ביטוח. אפשר להתחיל בהוספת הפוליסה הראשונה כשנוח.
        </p>
      ) : (
        <div className="space-y-2">
          {screen.visibleItems.map((i) => {
            const renewingSoon = isRenewingSoon(i.renewalDate);
            return (
              <div key={i.id} className="bg-white rounded-xl border border-slate-100 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800 flex items-center gap-1.5 flex-wrap">
                      <span>{i.provider}</span>
                      {i.status === 'lapsed' && (
                        <span className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">פגה תוקף</span>
                      )}
                      {i.status === 'cancelled' && (
                        <span className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">מבוטלת</span>
                      )}
                      {renewingSoon && (
                        <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">מתחדש בקרוב</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span>
                        {TYPE_LABELS[i.type]} · מבוטח: {memberName(i.insuredMemberId)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span>
                        פרמיה: ₪{i.premium.toLocaleString()} ({FREQUENCY_LABELS[i.premiumFrequency]})
                      </span>
                      <Explain id="insurances.rowPremium" />
                    </p>
                    <p className="text-xs text-slate-500">תאריך חידוש: {i.renewalDate}</p>
                    {i.coverages.length > 0 && (
                      <ul className="text-xs text-slate-500 space-y-0.5">
                        {i.coverages.map((c, idx) => (
                          <li key={idx} className="flex items-center gap-1 flex-wrap">
                            <span>{c.label}</span>
                            {c.amount != null && (
                              <>
                                <span>· ₪{c.amount.toLocaleString()}</span>
                                <Explain id="insurances.rowCoverageAmount" />
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {i.documentId && <p className="text-xs text-slate-400">מסמך מקושר: {i.documentId}</p>}
                  </div>
                  {screen.editScope !== 'none' && (
                    <div className="flex gap-2">
                      <button
                        data-tour-id="screen.insurances.row.edit"
                        onClick={() => screen.openEdit(i)}
                        className="text-sm text-blue-600 min-h-[44px] px-2"
                      >
                        עריכה
                      </button>
                      <button
                        data-testid="screen.insurances.row.delete"
                        data-tour-id="screen.insurances.row.delete"
                        onClick={() => screen.requestDelete(i.id)}
                        className="text-sm text-red-600 min-h-[44px] px-2"
                      >
                        מחיקה
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {screen.isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">ספק</span>
            <input
              aria-label="ספק"
              value={form.provider}
              onChange={(e) => updateForm('provider', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סוג ביטוח</span>
            <select
              aria-label="סוג ביטוח"
              value={form.type}
              onChange={(e) => updateForm('type', e.target.value as InsuranceType)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              {(Object.keys(TYPE_LABELS) as InsuranceType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">מבוטח</span>
            {/* insuredMemberId — a SECOND member reference, distinct from ownerId ("who pays" vs
                "who is covered"). Deliberately a plain <select>, not OwnerPicker: isValidInsurance
                only requires this field non-empty, with no own/family Rules restriction of its
                own, so any viewer who can create a policy at all may name any insured member —
                matching how a parent commonly insures a child with no login of their own. */}
            <select
              aria-label="מבוטח"
              value={form.insuredMemberId}
              onChange={(e) => updateForm('insuredMemberId', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">פרמיה</span>
              {/* B3 — inputMode="decimal" on every money field */}
              <input
                aria-label="פרמיה"
                type="number"
                inputMode="decimal"
                value={form.premium}
                onChange={(e) => updateForm('premium', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">תדירות תשלום</span>
              <select
                aria-label="תדירות תשלום"
                value={form.premiumFrequency}
                onChange={(e) => updateForm('premiumFrequency', e.target.value as PremiumFrequency)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              >
                {(Object.keys(FREQUENCY_LABELS) as PremiumFrequency[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">תאריך חידוש</span>
            {/* B3 — native date control, never free-text */}
            <input
              aria-label="תאריך חידוש"
              type="date"
              value={form.renewalDate}
              onChange={(e) => updateForm('renewalDate', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </label>

          {/* Dynamic coverages editor — its own visually distinct, bordered block (the same
              grouping technique Loans already uses for its paired date/money rows), so the form
              reads as sections rather than one undifferentiated 8+-field wall. */}
          <div className="space-y-2 border border-slate-200 rounded-xl p-3" dir="rtl">
            <span className="text-sm text-slate-600 block">כיסויים</span>
            {form.coverages.map((c, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <label className="flex-1 text-sm">
                  <span className="text-slate-500 mb-1 block text-xs">תיאור כיסוי</span>
                  <input
                    aria-label="תיאור כיסוי"
                    value={c.label}
                    onChange={(e) => updateCoverage(idx, 'label', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                  />
                </label>
                <label className="w-28 text-sm">
                  <span className="text-slate-500 mb-1 block text-xs">סכום כיסוי</span>
                  {/* B3 — inputMode="decimal" here too, even though it's nested inside a
                      repeating row rather than a top-level field — the case this requirement is
                      most likely to be missed. */}
                  <input
                    aria-label="סכום כיסוי"
                    type="number"
                    inputMode="decimal"
                    value={c.amount}
                    onChange={(e) => updateCoverage(idx, 'amount', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                  />
                </label>
                <button
                  type="button"
                  aria-label="הסר כיסוי"
                  onClick={() => removeCoverage(idx)}
                  className="text-red-600 min-h-[44px] min-w-[44px] flex items-center justify-center text-lg leading-none"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addCoverage} className="text-sm text-blue-600 min-h-[44px]">
              הוסף כיסוי
            </button>
          </div>

          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סטטוס</span>
            <select
              aria-label="סטטוס"
              value={form.status}
              onChange={(e) => updateForm('status', e.target.value as InsuranceStatus)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              {(Object.keys(STATUS_LABELS) as InsuranceStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
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
          <p>למחוק את הפוליסה?</p>
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
