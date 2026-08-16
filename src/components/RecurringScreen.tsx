// Stage 5 Task 7 (FINAL) — RecurringScreen, built on the shared useOwnedCollectionScreen<T> hook
// (D13), the fourth owned-collection screen to compose it with ZERO hook changes — Accounts
// (Task 3)/Loans (Task 4)/Insurances (Task 6) already proved the abstraction across three
// differently-shaped screens; this is the fourth data point, not a new question.
//
// Two deltas unique to this screen (task-7-brief.md):
//   (a) Per-row failed-posting badge (M5, binding) — threads useRecurringCatchup's
//       PostingOutcome.failed (Task 1, App.tsx) through the new `lastCatchupOutcome` prop. Today
//       an owner-deleted recurring item's per-item posting failure only ever surfaced as a
//       generic, undismissable app-boot toast, with the real failed item going to console.error —
//       training the household to ignore red banners, which defeats the next genuine error. Each
//       row now checks `lastCatchupOutcome?.failed.find((f) => f.recurringId === item.id)`; a
//       match renders a small red badge with the underlying error as its `title` tooltip.
//   (b) Income-posting limitation disclosure — posting a recurring INCOME item still needs
//       family-level edit on the ownerless 'income' module (unchanged by this stage's D1 scope
//       fix, RecurringService.ts's own header comment). A 'member'-role session can CREATE a
//       recurring income item but their own session can never POST it. This screen's
//       lastPostedPeriod column is the first place that shows up as a permanently stuck
//       "טרם נרשם" — every income-kind row says so in plain Hebrew rather than leaving the
//       household to read it as a bug.
//
// D5 — this is the one screen wiring the מה (category) dimension: filters.category.categories
// narrows the list client-side, on TOP of useOwnedCollectionScreen's own מי filter
// (screen.visibleItems), never instead of it. An income item has no category at all
// (isValidRecurring only requires it when present, never for income) — the category select
// itself only ever renders for kind === 'expense'.
//
// saveRecurring (never the factory's bare repo.save re-export) backs BOTH the form submit path
// and the status quick-actions ("השהה"/"הפעל מחדש") — RecurringService.ts exports it specifically
// for the unbounded-backfill guard (Stage 3 D-decision) that seeds lastPostedPeriod on a genuine
// create. saveRecurring's own header comment is explicit that editing an EXISTING item "is never
// touched here... whatever lastPostedPeriod it already carries in input passes through
// unchanged" — that only holds if THIS screen actually carries it forward, since
// financeCollections.save() does a full tx.set() of whatever input it's given (only createdAt is
// fetched/preserved internally, not lastPostedPeriod). Both the edit-form pre-fill (FormState's
// `lastPostedPeriod`, never rendered as an editable field) AND the status quick-action handler
// (which rebuilds the full item verbatim except `status`) carry the item's existing
// lastPostedPeriod through explicitly — omitting it here would silently re-expose the unbounded
// backfill risk the guard exists to close, every single time someone edits or pauses an item.
import React, { useEffect, useState } from 'react';
import { listRecurring, saveRecurring, deleteRecurring, type PostingOutcome } from '../services/RecurringService';
import { getCategories } from '../services/CategoriesService';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';
import { OwnerPicker } from './OwnerPicker';
import { ScopeBadge } from './ScopeBadge';
import { Explain } from './Explain';
import { confirmLargeAmount } from '../utils/amountConfirm';
import type { RecurringItem, RecurringKind, RecurringStatus } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בתנועות הקבועות האלו';
const LOAD_ERROR_MESSAGE = 'טעינת התנועות הקבועות נכשלה. בדוק את החיבור ונסה שוב.';
const DESCRIPTION_REQUIRED_MESSAGE = 'יש להזין תיאור לתנועה הקבועה';
const START_DATE_REQUIRED_MESSAGE = 'יש לבחור תאריך התחלה';
const CHARGE_DAY_INVALID_MESSAGE = 'יש להזין יום חיוב תקין, בין 1 ל-31';
const AMOUNT_INVALID_MESSAGE = 'יש להזין סכום תקין';
// (b) — deliberately unconditional on the viewer's own role/permissions: this screen has no
// income-module permission level in its props to check, and the statement is true regardless of
// who's looking at it — it explains WHY lastPostedPeriod may stay stuck at "טרם נרשם" for good.
const INCOME_POSTING_LIMITATION_NOTE =
  'הכנסה קבועה נרשמת אוטומטית רק כשהורה או סופר-אדמין נכנסים לאפליקציה, ולא כשחבר משפחה רגיל נכנס. אם "טרם נרשם" נשאר כך, זה כנראה הסיבה — לא תקלה.';

const KIND_LABELS: Record<RecurringKind, string> = { income: 'הכנסה', expense: 'הוצאה' };
const STATUS_LABELS: Record<RecurringStatus, string> = { active: 'פעילה', paused: 'מושהית', ended: 'הסתיימה' };

export interface RecurringScreenProps {
  session: { memberId: string; role: PermissionRole };
  recurringViewLevel: PermissionLevel | undefined;
  recurringEditLevel: PermissionLevel | undefined;
  lastCatchupOutcome: PostingOutcome | null; // Task 1's useRecurringCatchup return value, threaded through App.tsx — M5
}

interface FormState {
  kind: RecurringKind;
  description: string;
  amount: string;
  category: string;
  chargeDay: string;
  startDate: string;
  endDate: string;
  status: RecurringStatus;
  ownerId: string;
  // Pass-through only — NEVER rendered as a user-editable field. See the module header comment:
  // omitting this on submit would silently erase the catch-up engine's own bookkeeping.
  lastPostedPeriod: string | undefined;
}

const BLANK_FORM = (memberId: string): FormState => ({
  kind: 'expense',
  description: '',
  amount: '',
  category: '',
  chargeDay: '1',
  startDate: '',
  endDate: '',
  status: 'active',
  ownerId: memberId,
  lastPostedPeriod: undefined,
});

export default function RecurringScreen({
  session,
  recurringViewLevel,
  recurringEditLevel,
  lastCatchupOutcome,
}: RecurringScreenProps): React.JSX.Element {
  const { familyMembers, filters } = useGlobalFilters();
  const screen = useOwnedCollectionScreen<RecurringItem>({
    list: listRecurring,
    save: saveRecurring,
    remove: deleteRecurring,
    session,
    viewLevel: recurringViewLevel,
    editLevel: recurringEditLevel,
    loadErrorMessage: LOAD_ERROR_MESSAGE,
  });
  const [form, setForm] = useState<FormState>(BLANK_FORM(session.memberId));
  const [formError, setFormError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  // Same source FilterBar's own מה control already uses (getCategories() over
  // settings/categories) — never a second, screen-local category taxonomy. A failed fetch leaves
  // the select with just the "no category" option; category is optional on this record either
  // way (isValidRecurring), so this can never block create/edit.
  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((list) => {
        if (!cancelled) setCategories(list);
      })
      .catch(() => {
        /* category list is a convenience only — an expense item's category stays optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (screen.editing) {
      const r = screen.editing;
      setForm({
        kind: r.kind,
        description: r.description,
        amount: String(r.amount),
        category: r.category ?? '',
        chargeDay: String(r.chargeDay),
        startDate: r.startDate,
        endDate: r.endDate ?? '',
        status: r.status,
        ownerId: r.ownerId,
        lastPostedPeriod: r.lastPostedPeriod,
      });
    } else if (screen.isFormOpen) {
      setForm((f) => (f.description || f.amount ? f : BLANK_FORM(session.memberId)));
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
    // no-op and never a browser-native alert.
    if (form.description.trim() === '') {
      setFormError(DESCRIPTION_REQUIRED_MESSAGE);
      return;
    }
    if (form.startDate.trim() === '') {
      setFormError(START_DATE_REQUIRED_MESSAGE);
      return;
    }
    const chargeDay = Number(form.chargeDay);
    if (form.chargeDay.trim() === '' || !Number.isInteger(chargeDay) || chargeDay < 1 || chargeDay > 31) {
      setFormError(CHARGE_DAY_INVALID_MESSAGE);
      return;
    }
    const amount = Number(form.amount);
    if (form.amount.trim() === '' || Number.isNaN(amount) || amount <= 0) {
      setFormError(AMOUNT_INVALID_MESSAGE);
      return;
    }
    if (!confirmLargeAmount(amount)) return; // D14 — soft confirm, user can still decline

    await screen.submit({
      ownerId: form.ownerId,
      kind: form.kind,
      description: form.description.trim(),
      amount,
      // An income item has no expense category — dropped even if the field carries a stale value
      // from before the household switched the kind toggle.
      category: form.kind === 'expense' && form.category ? form.category : undefined,
      chargeDay,
      status: form.status,
      startDate: form.startDate,
      endDate: form.endDate.trim() === '' ? undefined : form.endDate,
      lastPostedPeriod: form.lastPostedPeriod,
    });
    setForm(BLANK_FORM(session.memberId));
    setFormError(null);
  }

  // Status quick-actions ("השהה"/"הפעל מחדש") — call saveRecurring directly with only `status`
  // changed, bypassing useOwnedCollectionScreen's form/dirty state entirely: there is no open
  // form to guard here (task-7-brief.md). Every other field, including lastPostedPeriod, carries
  // through verbatim from the item itself — see the module header comment for why that matters.
  async function handleStatusQuickAction(item: RecurringItem, newStatus: RecurringStatus): Promise<void> {
    await saveRecurring(
      {
        id: item.id,
        ownerId: item.ownerId,
        kind: item.kind,
        description: item.description,
        amount: item.amount,
        category: item.category,
        chargeDay: item.chargeDay,
        status: newStatus,
        startDate: item.startDate,
        endDate: item.endDate,
        lastPostedPeriod: item.lastPostedPeriod,
      },
      session.memberId
    );
    screen.reload();
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
        טוען תנועות קבועות...
      </div>
    );
  }

  const members = familyMembers.status === 'ready' ? familyMembers.members : [];

  // D5 — the מה (category) dimension, layered on top of useOwnedCollectionScreen's own מי filter
  // (screen.visibleItems), never instead of it. Literally Dashboard's own M1 formula, unchanged,
  // for consistency with the one other screen that already filters by category. Note this means
  // an income-kind item (which has no category) is excluded too whenever a category filter is
  // ACTIVE — the same behavior Dashboard's own KPI cards already have for an uncategorized
  // expense row, not a special case invented for this screen. Worth a product call later if that
  // turns out to surprise anyone (see task-7-report.md).
  const visibleItems = screen.visibleItems.filter(
    (item) => filters.category.categories.length === 0 || filters.category.categories.includes(item.category ?? '')
  );

  // recurring.totalMonthly (glossary) — active items only, both kinds summed. A paused/ended item
  // isn't currently committing anything to the household's automatic monthly postings.
  const totalMonthly = visibleItems.filter((i) => i.status === 'active').reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="space-y-4" data-tour-id="screen.recurring.list" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">תנועות קבועות</h2>
          <span className="text-sm text-slate-500">סך ההתחייבות החודשית: ₪{Math.round(totalMonthly).toLocaleString()}</span>
          <Explain id="recurring.totalMonthly" />
          <ScopeBadge scope={screen.viewScope} />
        </div>
        {screen.editScope !== 'none' && (
          <button
            data-testid="screen.recurring.create"
            data-tour-id="screen.recurring.create"
            onClick={screen.openCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium"
          >
            תנועה קבועה חדשה
          </button>
        )}
      </div>

      {visibleItems.length === 0 ? (
        <p className="text-slate-400 text-center py-8">
          עדיין לא הוספתם תנועות קבועות. אפשר להתחיל בהוספת הראשונה כשנוח — היא תירשם אוטומטית מדי חודש.
        </p>
      ) : (
        <div className="space-y-2">
          {visibleItems.map((item) => {
            const failure = lastCatchupOutcome?.failed.find((f) => f.recurringId === item.id);
            return (
              <div key={item.id} className="bg-white rounded-xl border border-slate-100 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800 flex items-center gap-1.5 flex-wrap">
                      <span>{item.description}</span>
                      <span className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{STATUS_LABELS[item.status]}</span>
                      {failure && (
                        <span className="text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5" title={failure.error}>
                          פרסום אחרון נכשל
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span>
                        {KIND_LABELS[item.kind]}
                        {item.kind === 'expense' && item.category ? ` · ${item.category}` : ''} · חיוב ביום {item.chargeDay} בכל חודש
                      </span>
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                      <span>₪{item.amount.toLocaleString()}</span>
                      <Explain id="recurring.rowAmount" />
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.lastPostedPeriod ? `נרשם לאחרונה: ${item.lastPostedPeriod}` : 'טרם נרשם'}
                    </p>
                    {item.kind === 'income' && <p className="text-xs text-amber-600">{INCOME_POSTING_LIMITATION_NOTE}</p>}
                  </div>
                  {screen.editScope !== 'none' && (
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex gap-2">
                        <button
                          data-tour-id="screen.recurring.row.edit"
                          onClick={() => screen.openEdit(item)}
                          className="text-sm text-blue-600 min-h-[44px] px-2"
                        >
                          עריכה
                        </button>
                        <button
                          data-testid="screen.recurring.row.delete"
                          data-tour-id="screen.recurring.row.delete"
                          onClick={() => screen.requestDelete(item.id)}
                          className="text-sm text-red-600 min-h-[44px] px-2"
                        >
                          מחיקה
                        </button>
                      </div>
                      {item.status === 'active' && (
                        <button
                          onClick={() => void handleStatusQuickAction(item, 'paused')}
                          className="text-xs text-slate-500 underline min-h-[44px] px-1"
                        >
                          השהה
                        </button>
                      )}
                      {item.status === 'paused' && (
                        <button
                          onClick={() => void handleStatusQuickAction(item, 'active')}
                          className="text-xs text-blue-600 underline min-h-[44px] px-1"
                        >
                          הפעל מחדש
                        </button>
                      )}
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
          <div className="block text-sm">
            <span className="text-slate-600 mb-1 block">סוג תנועה</span>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 min-h-[44px]">
                <input type="radio" name="kind" checked={form.kind === 'income'} onChange={() => updateForm('kind', 'income')} />
                <span>הכנסה</span>
              </label>
              <label className="flex items-center gap-1.5 min-h-[44px]">
                <input type="radio" name="kind" checked={form.kind === 'expense'} onChange={() => updateForm('kind', 'expense')} />
                <span>הוצאה</span>
              </label>
            </div>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">תיאור</span>
            <input
              aria-label="תיאור"
              value={form.description}
              onChange={(e) => updateForm('description', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </label>
          {form.kind === 'expense' && (
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">קטגוריה</span>
              <select
                aria-label="קטגוריה"
                value={form.category}
                onChange={(e) => updateForm('category', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              >
                <option value="">— ללא —</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">סכום</span>
              {/* B3 — inputMode="decimal" on every money field */}
              <input
                aria-label="סכום"
                type="number"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => updateForm('amount', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">יום חיוב בחודש</span>
              {/* No native min/max — those trigger the browser's own constraint validation and
                  silently BLOCK the submit event before our own handleSubmit ever runs, which
                  would replace this screen's Hebrew inline error with a native (or, in a
                  headless/jsdom context, a completely silent) validation bubble. The 1-31 range
                  is enforced entirely in JS below, same convention as every other field on this
                  screen and its siblings. */}
              <input
                aria-label="יום חיוב בחודש"
                type="number"
                inputMode="numeric"
                value={form.chargeDay}
                onChange={(e) => updateForm('chargeDay', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">תאריך התחלה</span>
              {/* B3 — native date control, never free-text */}
              <input
                aria-label="תאריך התחלה"
                type="date"
                value={form.startDate}
                onChange={(e) => updateForm('startDate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 mb-1 block">תאריך סיום (אופציונלי)</span>
              <input
                aria-label="תאריך סיום"
                type="date"
                value={form.endDate}
                onChange={(e) => updateForm('endDate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סטטוס</span>
            <select
              aria-label="סטטוס"
              value={form.status}
              onChange={(e) => updateForm('status', e.target.value as RecurringStatus)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            >
              {(Object.keys(STATUS_LABELS) as RecurringStatus[]).map((s) => (
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
          <p>למחוק את התנועה הקבועה?</p>
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
