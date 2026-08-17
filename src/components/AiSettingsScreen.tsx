// Stage 6 Task 8 — AI settings screen: provider status, cost ceiling (Rules-enforced, D4),
// usage-by-model dashboard, data-egress disclosure (D13/spec §14.6), exchange-rate disclosure
// (D15/third-lens M5).
//
// Role gating (deliberate deviation from this task's own brief snippet — disclosed here and in
// the task report): spec §4's role table groups "מפתחות AI" (AI keys/ceilings) in the SAME
// super-admin-exclusive bullet as "ניהול הרשאות" (permissions management) — not the
// ecosystem/budgetConfig parent-or-super-admin precedent. getAiUsageSummary.ts itself is
// super-admin-only (rejects a parent with permission-denied), and this task's own App.tsx wiring
// gates the nav tab to super-admin only too — so a parent-visible read-only mode (which the
// brief's UI test description also asked for) is structurally unreachable and was not built.
// This component self-guards on `role === 'super-admin'`, mirroring PermissionsManager's own
// defense-in-depth precedent exactly (fails closed even if a future call site forgets to gate).
import React, { useCallback, useEffect, useState } from 'react';
import { getAiUsageSummary, setAiCostCeiling, type AiUsageSummary } from '../services/aiClient';
import { listAiModels } from '../services/aiClient';
import { Explain } from './Explain';
import { parseCeilingInput } from '../config/aiCeiling';
import type { PermissionRole } from '../types/permissions';

const PROVIDER_LABELS: Record<string, string> = {
  mock: 'מודל דמה (ללא מפתח)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

const EGRESS_DISCLOSURE_HE =
  'קריאות ה-AI (צ\'אט וחילוץ מסמכים) נשלחות לספק המודל שנבחר ועוזבות את המחשב שלך — ' +
  'שאר הנתונים הפיננסיים נשארים מקומיים.';

const STALE_RATE_WARNING_HE =
  'שער החליפין לא עודכן זמן רב — ייתכן שהתקרה אינה משקפת עלות אמיתית';

const STALE_RATE_THRESHOLD_DAYS = 90;

// Task 8 review F1/F3 — one message per ceiling state, none of which may claim a state the cost
// gate is not actually in. The old screen tested `ceiling > 0`, which is ALSO false for the NaN a
// corrupt stored value produced, so it printed "no monthly ceiling has been set yet" at the exact
// moment that value had disabled the gate entirely.
const CEILING_UNSET_HE = 'טרם הוגדרה תקרה חודשית — קריאות AI בתשלום חסומות עד שתוגדר תקרה';
const CEILING_ZERO_HE = 'התקרה מוגדרת ל-₪0 — קריאות AI בתשלום חסומות';
const CEILING_INVALID_HE =
  'הערך השמור של התקרה החודשית אינו תקין — קריאות AI בתשלום חסומות עד שתישמר תקרה תקינה מחדש';

function isRateStale(rateAsOf: string, now: Date = new Date()): boolean {
  const rateDate = new Date(`${rateAsOf}T00:00:00Z`);
  if (Number.isNaN(rateDate.getTime())) return false;
  const diffDays = (now.getTime() - rateDate.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays > STALE_RATE_THRESHOLD_DAYS;
}

const errMsg = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message
    : 'שגיאה לא ידועה';

interface LoadState {
  status: 'loading' | 'error' | 'ready';
  error: string | null;
  summary: AiUsageSummary | null;
  configuredProviderIds: Set<string>;
}

export default function AiSettingsScreen({ role }: { actorMemberId: string; role: PermissionRole }): React.JSX.Element | null {
  // Defense in depth (mirrors PermissionsManager) — see file header for why this is super-admin
  // ONLY, with no parent read-only branch.
  const isSuperAdmin = role === 'super-admin';

  const [state, setState] = useState<LoadState>({ status: 'loading', error: null, summary: null, configuredProviderIds: new Set() });
  const [ceilingInput, setCeilingInput] = useState('');
  const [ceilingError, setCeilingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isSuperAdmin) return;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const [summary, models] = await Promise.all([getAiUsageSummary(), listAiModels()]);
      setState({
        status: 'ready', error: null, summary,
        configuredProviderIds: new Set(models.map((m) => m.providerId)),
      });
      // Task 8 review F3 — an unset/invalid ceiling leaves the field EMPTY rather than pre-filling
      // "0", which would have invited the operator to save a blocking ceiling they never chose.
      setCeilingInput(summary.ceilingILS === null ? '' : String(summary.ceilingILS));
    } catch (err) {
      setState((prev) => ({ ...prev, status: 'error', error: errMsg(err) }));
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveCeiling = async (e: React.FormEvent) => {
    e.preventDefault();
    setCeilingError(null);
    // Task 8 review F3 — parseCeilingInput, not `Number(ceilingInput)`: an empty field coerced to
    // 0 and saved a paid-AI block with no warning at all. Same bound as the callable and Rules.
    const parsed = parseCeilingInput(ceilingInput);
    if (parsed.status === 'error') {
      setCeilingError(parsed.messageHe);
      return;
    }
    setSaving(true);
    try {
      await setAiCostCeiling(parsed.value);
      await load();
    } catch (err) {
      setCeilingError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isSuperAdmin) return null;

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <h1 className="text-xl font-bold text-slate-900">הגדרות AI</h1>

      {/* D13/spec §14.6 — persistent, rendered regardless of load/ceiling/provider state. */}
      <div
        data-tour-id="screen.ai-settings.egress-banner"
        className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        {EGRESS_DISCLOSURE_HE}
      </div>

      {state.status === 'loading' && (
        <div className="text-slate-500 text-sm" role="status">טוען נתוני AI…</div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          טעינת נתוני ה-AI נכשלה: {state.error}
        </div>
      )}

      {state.status === 'ready' && state.summary && (
        <>
          {/* D15/third-lens M5 — the exchange rate the ceiling's math is built on, shown next to
              the spend numbers it protects. Registry pricing is UNVERIFIED (see registry.ts) —
              staleness is surfaced honestly rather than presenting the ceiling as authoritative. */}
          <div data-tour-id="screen.ai-settings.exchange-rate" className="text-sm text-slate-600">
            <span>
              שער דולר-שקל: {state.summary.exchangeRate.usdToILSRate} (נכון ל-{state.summary.exchangeRate.rateAsOf})
            </span>
            {isRateStale(state.summary.exchangeRate.rateAsOf) && (
              <p className="mt-1 text-amber-700" data-tour-id="screen.ai-settings.exchange-rate-stale">
                {STALE_RATE_WARNING_HE}
              </p>
            )}
          </div>

          {/* Task 8 review F2 — ONE family-wide budget line. The ceiling is a single global number
              enforced against the sum of every provider's spend (costGate.spend reads them all in
              its transaction); the four per-provider "% מהתקרה" bars this replaces each measured a
              different provider against that same number, describing a cap that was silently 4x
              what it claimed. */}
          <section
            data-testid="screen.ai-settings.total-usage"
            data-tour-id="screen.ai-settings.total-usage"
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <div className="flex items-center gap-1 text-sm text-slate-700">
              <span className="font-medium">
                סה״כ הוצאות AI החודש (כל הספקים): ₪{state.summary.totalUsedThisMonthILS.toLocaleString('he-IL')}
                {state.summary.ceilingStatus === 'configured' && state.summary.ceilingILS !== null
                  ? ` מתוך ₪${state.summary.ceilingILS.toLocaleString('he-IL')}`
                  : ''}
              </span>
              <Explain id="aiSettings.ceiling" />
            </div>
            {(() => {
              const { ceilingStatus, ceilingILS, totalUsedThisMonthILS } = state.summary!;
              if (ceilingStatus === 'invalid') {
                return (
                  <p
                    data-testid="screen.ai-settings.ceiling-invalid"
                    className="mt-1 text-xs text-red-700"
                  >
                    {CEILING_INVALID_HE}
                  </p>
                );
              }
              if (ceilingStatus === 'unset' || ceilingILS === null) {
                return <p className="mt-1 text-xs text-slate-400">{CEILING_UNSET_HE}</p>;
              }
              if (ceilingILS === 0) {
                // A deliberate ₪0 IS configured — there is simply no denominator for a percentage.
                return <p className="mt-1 text-xs text-amber-700">{CEILING_ZERO_HE}</p>;
              }
              const pct = Math.min(100, Math.round((totalUsedThisMonthILS / ceilingILS) * 100));
              return (
                <div className="mt-1">
                  <div className="w-full bg-slate-100 rounded-full h-2" aria-hidden="true">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{pct}% מהתקרה</p>
                </div>
              );
            })()}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">ספקים</h2>
            <div className="space-y-2">
              {state.summary.byProvider.map((p) => {
                const configured = state.configuredProviderIds.has(p.providerId);
                return (
                  <div
                    key={p.providerId}
                    data-testid={`screen.ai-settings.provider-row.${p.providerId}`}
                    data-tour-id="screen.ai-settings.provider-row"
                    className="rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{PROVIDER_LABELS[p.providerId] ?? p.providerId}</span>
                      <span
                        className={
                          configured
                            ? 'rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 text-xs font-medium'
                            : 'rounded-full bg-slate-100 text-slate-500 border border-slate-300 px-2 py-0.5 text-xs font-medium'
                        }
                      >
                        {configured ? 'מוגדר' : 'לא מוגדר'}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                      <span>
                        עלות החודש: ₪{p.usedThisMonthILS.toLocaleString()} ({p.callCount} קריאות)
                      </span>
                      <Explain id="aiSettings.providerSpend" />
                    </div>
                    {/* Deliberately no per-provider percentage-of-ceiling bar (Task 8 review F2):
                        there is no per-provider ceiling to be a percentage OF. This row is a
                        breakdown of where the family-wide total above went. */}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1">
              <span>פירוט שימוש לפי מודל</span>
              <Explain id="aiSettings.modelSpend" />
            </h2>
            {state.summary.byModel.length === 0 ? (
              <p className="text-sm text-slate-500">אין עדיין נתוני שימוש לפי מודל החודש</p>
            ) : (
              <div className="overflow-x-auto" data-testid="screen.ai-settings.model-table">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr className="text-slate-500 text-xs">
                      <th className="py-1 font-normal">מודל</th>
                      <th className="py-1 font-normal">ספק</th>
                      <th className="py-1 font-normal">עלות החודש</th>
                      <th className="py-1 font-normal">קריאות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.summary.byModel.map((m) => (
                      <tr key={m.modelId} className="border-t border-slate-100">
                        <td className="py-1 text-slate-900">{m.modelId}</td>
                        <td className="py-1 text-slate-600">{PROVIDER_LABELS[m.providerId] ?? m.providerId}</td>
                        <td className="py-1 text-slate-900">₪{m.usedThisMonthILS.toLocaleString()}</td>
                        <td className="py-1 text-slate-600">{m.callCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <form onSubmit={handleSaveCeiling} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              {/* Deliberately NOT a wrapping <label> around both the caption AND the Explain
                  button: a <label> implicitly associates with EVERY focusable control inside it
                  (the <input> below, but also the Explain <button>), which made
                  getByLabelText('תקרת AI חודשית (₪)') ambiguous between the two. The input keeps
                  its own explicit aria-label instead; the caption row is a plain, unassociated
                  <div>. */}
              <div className="text-sm text-slate-600 mb-1 flex items-center gap-1">
                <span>תקרת AI חודשית (₪)</span>
                <Explain id="aiSettings.ceiling" />
              </div>
              <div className="text-sm">
                <input
                  aria-label="תקרת AI חודשית (₪)"
                  data-tour-id="screen.ai-settings.ceiling-input"
                  inputMode="decimal"
                  value={ceilingInput}
                  onChange={(e) => setCeilingInput(e.target.value)}
                  disabled={saving}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm disabled:bg-slate-100"
                />
              </div>
              {ceilingError && <p className="text-xs text-red-600">{ceilingError}</p>}
              <button
                type="submit"
                disabled={saving}
                data-tour-id="screen.ai-settings.ceiling-save"
                className="min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
              >
                שמור תקרה
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
