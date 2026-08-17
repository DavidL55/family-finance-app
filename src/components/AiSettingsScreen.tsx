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
import { parseCeilingInput, USAGE_CORRUPT_MESSAGE_HE } from '../config/aiCeiling';
// Task 8 review F4 — the egress copy and the provider labels moved to a shared, dependency-free
// module so the chat surface (where the egress actually happens, for every role) and this screen
// tell one story from one source. The banner below is unchanged in wording; only its home moved.
import { AI_EGRESS_DISCLOSURE_HE, AI_PROVIDER_LABELS_HE as PROVIDER_LABELS } from '../config/aiDisclosure';
import type { PermissionRole } from '../types/permissions';

const STALE_RATE_WARNING_HE =
  'שער החליפין לא עודכן זמן רב — ייתכן שהתקרה אינה משקפת עלות אמיתית';

// Task 8 review F9 — a date we cannot read is not evidence of freshness, and it needs its own
// message: "re-save a readable date" is a different operator action from "refresh a stale rate",
// exactly the distinction F1's ceiling-invalid vs ceiling-unconfigured split already established.
const UNREADABLE_RATE_DATE_WARNING_HE =
  'תאריך שער החליפין אינו קריא — אי אפשר לדעת אם השער מעודכן';

// Task 8 review F5 — registry.ts's own 20-line banner records that every per-token price below it
// is an UNVERIFIED placeholder (vendor pricing pages blocked or ambiguous). The exchange rate is
// only HALF the ₪ conversion; the prices are the other half, and the more-wrong half. The screen
// disclosed the FX date and presented the rest with the visual authority of fact.
const UNVERIFIED_PRICING_CAVEAT_HE =
  'מחירי המודלים לא אומתו מול הספקים — כל סכום בשקלים כאן הוא הערכה.';

// Task 8 review F9 — tightened from 90 days. This is a HAND-maintained USD/ILS rate that
// multiplies into every ₪ figure on this screen; a quarter of unchecked FX drift is far more
// movement than those numbers can absorb without saying so.
const STALE_RATE_THRESHOLD_DAYS = 30;

// Task 8 review F8 (Ofra) — one money formatter for the whole screen. Before this, the same table
// rendered ₪0 (for a real ₪0.0004 charge — a genuine cost displayed as nothing), ₪0.038 and
// ₪1,234.568 side by side: no fraction-digit control and `toLocaleString()` with no locale, so
// grouping followed each device. ComparisonTable.tsx already pins 'he-IL'; this follows it.
const MIN_DISPLAYED_ILS = 0.01;
// Batch 6 (closing review B1) — `number | null`. The server now says "unreadable" explicitly
// instead of leaking a NaN that only rendered as ₪— by accident of Number.isFinite; the guard
// stays for a NaN arriving some other way, but null is the typed, intended path.
function formatILS(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '₪—';
  // A charge that is real but smaller than an agora must not round away to "₪0.00", which reads
  // as free. Chosen over adding more decimal places (₪0.0004 is noise a reader cannot use, and it
  // would wreck column alignment for the ₪1,234.57 beside it) and over "₪0.01" (that would round
  // UP, overstating a real number on a screen this batch exists to make honest). "Less than an
  // agora" is the only form that is both readable and true.
  if (amount > 0 && amount < MIN_DISPLAYED_ILS) return `פחות מ-₪${MIN_DISPLAYED_ILS.toFixed(2)}`;
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Task 8 review F1/F3 — one message per ceiling state, none of which may claim a state the cost
// gate is not actually in. The old screen tested `ceiling > 0`, which is ALSO false for the NaN a
// corrupt stored value produced, so it printed "no monthly ceiling has been set yet" at the exact
// moment that value had disabled the gate entirely.
const CEILING_UNSET_HE = 'טרם הוגדרה תקרה חודשית — קריאות AI בתשלום חסומות עד שתוגדר תקרה';
const CEILING_ZERO_HE = 'התקרה מוגדרת ל-₪0 — קריאות AI בתשלום חסומות';
const CEILING_INVALID_HE =
  'הערך השמור של התקרה החודשית אינו תקין — קריאות AI בתשלום חסומות עד שתישמר תקרה תקינה מחדש';

/**
 * Task 8 review F9 — this used to be `isRateStale`, returning FALSE for any rateAsOf it could not
 * parse. A corrupt date therefore SILENTLY SUPPRESSED the warning: fail-open on the only honesty
 * mechanism this stage ships, the same class as F1's corrupt ceiling disabling the cost gate.
 * It now fails CLOSED — unparseable is its own reported state, never treated as fresh.
 *
 * A status string rather than a boolean-discriminated union deliberately: the ROOT tsconfig does
 * not enable `strict`, so `{ok:true}|{ok:false}` narrowing does not work in src/.
 */
type RateFreshness = 'fresh' | 'stale' | 'unreadable';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function rateFreshness(rateAsOf: string, now: Date = new Date()): RateFreshness {
  // The regex is the strict half: `new Date` alone accepts a surprising amount ('2026-8-1',
  // whole-year strings), and a date we only half-understand is exactly what F9 is about.
  if (typeof rateAsOf !== 'string' || !ISO_DATE_RE.test(rateAsOf)) return 'unreadable';
  const rateDate = new Date(`${rateAsOf}T00:00:00Z`);
  if (Number.isNaN(rateDate.getTime())) return 'unreadable';
  const diffDays = (now.getTime() - rateDate.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays > STALE_RATE_THRESHOLD_DAYS ? 'stale' : 'fresh';
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
        {AI_EGRESS_DISCLOSURE_HE}
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
              the spend numbers it protects.
              Task 8 review F5 — and BOTH halves of that ₪ conversion are now disclosed. The
              previous version's comment claimed "staleness is surfaced honestly", but the only
              honesty shipped covered the FX rate; registry.ts's per-token prices — placeholders
              its own banner labels UNVERIFIED — were rendered as fact. That caveat is
              unconditional: it is a property of the rate card, not of any date. */}
          <div data-tour-id="screen.ai-settings.exchange-rate" className="text-sm text-slate-600">
            <span>
              שער דולר-שקל: {state.summary.exchangeRate.usdToILSRate} (נכון ל-{state.summary.exchangeRate.rateAsOf})
            </span>
            {(() => {
              const freshness = rateFreshness(state.summary!.exchangeRate.rateAsOf);
              if (freshness === 'unreadable') {
                return (
                  <p
                    className="mt-1 text-amber-700"
                    data-testid="screen.ai-settings.exchange-rate-unreadable"
                    data-tour-id="screen.ai-settings.exchange-rate-unreadable"
                  >
                    {UNREADABLE_RATE_DATE_WARNING_HE}
                  </p>
                );
              }
              if (freshness === 'stale') {
                return (
                  <p className="mt-1 text-amber-700" data-tour-id="screen.ai-settings.exchange-rate-stale">
                    {STALE_RATE_WARNING_HE}
                  </p>
                );
              }
              return null;
            })()}
            <p
              className="mt-1 text-amber-700"
              data-testid="screen.ai-settings.unverified-pricing"
              data-tour-id="screen.ai-settings.unverified-pricing"
            >
              {UNVERIFIED_PRICING_CAVEAT_HE}
            </p>
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
              <span className="font-medium tabular-nums">
                סה״כ הוצאות AI החודש (כל הספקים): {formatILS(state.summary.totalUsedThisMonthILS)}
                {state.summary.ceilingStatus === 'configured' && state.summary.ceilingILS !== null
                  ? ` מתוך ${formatILS(state.summary.ceilingILS)}`
                  : ''}
              </span>
              <Explain id="aiSettings.ceiling" />
            </div>
            {(() => {
              const { ceilingStatus, ceilingILS, totalUsedThisMonthILS, usageStatus } = state.summary!;
              // Batch 6 (closing review B1) — checked BEFORE the ceiling branches, because it is
              // the more total failure: with an unreadable counter the cost gate refuses every
              // paid call whatever the ceiling says, and there is no numerator for a percentage.
              // Rendered in the same red as the ceiling-invalid line for the same reason — both
              // are "a corrupt stored value has closed the gate", and both name a repair rather
              // than a budget decision. Before this batch this state reached the bar below as a
              // NaN and printed "NaN% מהתקרה" under a bar that rendered at zero width.
              if (usageStatus === 'corrupt' || totalUsedThisMonthILS === null) {
                return (
                  <p
                    data-testid="screen.ai-settings.usage-corrupt"
                    className="mt-1 text-xs text-red-700"
                  >
                    {USAGE_CORRUPT_MESSAGE_HE}
                  </p>
                );
              }
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
                      <span className="tabular-nums">
                        עלות החודש: {formatILS(p.usedThisMonthILS)} ({p.callCount} קריאות)
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
                        {/* Task 8 review F8 — tabular-nums on every numeric cell, following
                            AnnualReport.tsx, this project's own money-table precedent. Without it
                            the ₪ column jitters column-to-column and is unscannable. */}
                        <td
                          data-testid={`screen.ai-settings.model-cost.${m.modelId}`}
                          className="py-1 text-slate-900 tabular-nums whitespace-nowrap"
                        >
                          {formatILS(m.usedThisMonthILS)}
                        </td>
                        <td
                          data-testid={`screen.ai-settings.model-calls.${m.modelId}`}
                          className="py-1 text-slate-600 tabular-nums"
                        >
                          {m.callCount}
                        </td>
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
