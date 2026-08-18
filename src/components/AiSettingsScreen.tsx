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
import {
  parseCeilingInput, USAGE_CORRUPT_MESSAGE_HE, formatILS, UNVERIFIED_PRICING_CAVEAT_HE,
} from '../config/aiCeiling';
// Task 8 review F4 — the egress copy and the provider labels moved to a shared, dependency-free
// module so the chat surface (where the egress actually happens, for every role) and this screen
// tell one story from one source. The banner below is unchanged in wording; only its home moved.
import {
  AI_EGRESS_DISCLOSURE_HEADLINE_HE,
  AI_EGRESS_DISCLOSURE_DETAILS_HE,
  AI_PROVIDER_LABELS_HE as PROVIDER_LABELS,
} from '../config/aiDisclosure';
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
//
// ACCEPTANCE RE-MEASURE — the constant itself MOVED to src/config/aiCeiling.ts (imported above)
// and its bare "הספקים" was corrected to "ספקי ה-AI" in the same move. The Dashboard's overage
// panel renders the ninth ₪ figure in the app, for every role, and now shows this same sentence;
// two copies of the app's most load-bearing honesty statement is the F4 class exactly. The
// reasoning above travelled with it — only its home changed.

// Task 8 review F9 — tightened from 90 days. This is a HAND-maintained USD/ILS rate that
// multiplies into every ₪ figure on this screen; a quarter of unchecked FX drift is far more
// movement than those numbers can absorb without saying so.
const STALE_RATE_THRESHOLD_DAYS = 30;

// Batch 8 (closing review B4) — formatILS MOVED to src/config/aiCeiling.ts (imported below),
// byte-identical, because the overage-approval panel now renders a ₪ figure from the same cost
// gate and two formatters beside each other is this project's own F4 class. Its full reasoning
// (Task 8 review F8) travelled with it.

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 9 — THE 5-SECOND GLANCE, which this stage's own acceptance check failed.
//
// The old rendering drew ONE bar colour (bg-blue-600) at every level, printed the percentage in
// text-xs text-slate-500 — the faintest thing in the section, and the same token the table's
// muted furniture used — and capped the number at Math.min(100, …), so a genuine 500%-of-ceiling
// state (spend, then lower the ceiling) was pixel-identical to landing exactly on it.
//
// Three bands, because that is how many decisions there are: keep going / start watching / stop.
// The band drives BOTH the accent and the words, and the words are not optional: WCAG 1.4.1
// forbids colour as the only carrier of meaning, and this screen is read on a phone.
// ─────────────────────────────────────────────────────────────────────────────────────────────

type UsageLevel = 'ok' | 'near' | 'over';

/** The band boundary. 80% is the point at which the remaining headroom stops being comfortable. */
const NEAR_CEILING_PCT = 80;

function usageLevel(pct: number): UsageLevel {
  if (pct >= 100) return 'over';
  if (pct >= NEAR_CEILING_PCT) return 'near';
  return 'ok';
}

/**
 * Semantic colour, deliberately separate from the app's blue accent: blue is "this is a control",
 * and a budget level is not a control.
 *
 * CLOSING REVIEW (cheap item) — THE COMMENT HERE ASSERTED A MEASUREMENT NOBODY HAD TAKEN, and it
 * was wrong. It read "Bar colours are non-text (WCAG 1.4.11, 3:1 against the slate-100 track)" as
 * a statement of fact. Measured: emerald-600 = 3.34 ✔ and red-600 = 4.35 ✔, but amber-500 = 1.96 ✗
 * — the 'near' bar, the one that exists to say "start watching", failed the 3:1 non-text threshold
 * by a factor of one and a half. amber-600 is 2.91, still short; amber-700 is 4.61 and clears with
 * room, so that is the token. 1.4.1 held throughout because the band word carries the meaning
 * independently of colour — this was a contrast defect, not a colour-only-signal one.
 *
 * Both halves are now MEASURED IN A TEST rather than claimed here (AiSettingsScreen.contrast.test.ts):
 * the bar tokens against the slate-100 track at 1.4.11's 3:1, and the text tokens at AA. That file
 * reads these very class strings out of this file, so a future token change is measured, not
 * assumed — the same discipline batch 5 applied to the extraction surfaces.
 */
const USAGE_STYLES: Record<UsageLevel, { bar: string; text: string; labelHe: string }> = {
  ok: { bar: 'bg-emerald-600', text: 'text-emerald-800', labelHe: 'בטווח התקציב' },
  near: { bar: 'bg-amber-700', text: 'text-amber-800', labelHe: 'מתקרב לתקרה' },
  // Not "חריגה מהתקרה": the line already says "% מהתקרה", and the F2 guard counts how many
  // statements on this screen claim a percentage of the ceiling.
  over: { bar: 'bg-red-600', text: 'text-red-700', labelHe: 'חריגה מהתקציב' },
};

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

      {/* Batch 9 — THE NUMBER THAT CHANGES GOES FIRST.
          This section used to sit below two static amber blocks, so the eye landed on two facts
          that are identical every single visit before reaching the one that moves. It is hoisted
          out of the main ready-fragment below (rather than the banner being pushed into it)
          because the banner must keep rendering during load, ceiling-unset and error states —
          a disclosure that appears only once the data resolves is a disclosure with gaps. */}
      {state.status === 'ready' && state.summary && (
        /* Task 8 review F2 — ONE family-wide budget line. The ceiling is a single global number
           enforced against the sum of every provider's spend (costGate.spend reads them all in
           its transaction); the four per-provider "% מהתקרה" bars this replaces each measured a
           different provider against that same number, describing a cap that was silently 4x
           what it claimed. */
        <section
          data-testid="screen.ai-settings.total-usage"
          data-tour-id="screen.ai-settings.total-usage"
          className="rounded-xl border border-slate-200 bg-white p-3"
        >
          {/* CLOSING REVIEW (Ofra) — THE GLANCE HAD NO GLANCE-SCALE NUMBER.
              Batch 9's redesign fixed colour, weight, order and the Math.min cap, and every one of
              those was right. It did not fix SCALE, and scale is what makes a glance: the whole
              screen used exactly three type sizes, and the primary money figure was text-sm
              font-medium — the SAME size as the percentage under it and the provider rows below
              it. A figure that is the same size as everything else is not a headline, it is a row.
              The project's own precedent is Dashboard.tsx's net-worth card at
              `text-3xl md:text-4xl font-bold`, and this follows it rather than inventing a size.
              The LABEL stays small and quiet: the label is the same on every visit, the number is
              the thing that moves. `מתוך ₪X` stays with the figure — a spend with no denominator
              beside it is the "% of what?" problem F2 was. */}
          <div className="flex items-center gap-1 text-sm text-slate-700">
            <span>סה״כ הוצאות AI החודש (כל ספקי ה-AI)</span>
            <Explain id="aiSettings.ceiling" />
          </div>
          <p
            data-testid="screen.ai-settings.total-usage-figure"
            className="text-3xl md:text-4xl font-bold tabular-nums text-slate-900 mt-0.5"
          >
            {formatILS(state.summary.totalUsedThisMonthILS)}
            {state.summary.ceilingStatus === 'configured' && state.summary.ceilingILS !== null
              ? <span className="text-base font-medium text-slate-600"> {`מתוך ${formatILS(state.summary.ceilingILS)}`}</span>
              : ''}
          </p>
          {/* ACCEPTANCE RE-MEASURE — THE CAVEAT, BACK WHERE IT QUALIFIES SOMETHING.
              Batch 9 hoisted the usage section to the top of the screen and reported that the
              caveat "moved directly below the headline figure and still precedes every other ₪
              figure". THE FIRST HALF WAS NEVER TRUE: it stayed inside the exchange-rate block
              three elements down, after the progress bar, the percentage and the FX line. The
              committed test covered only the second half, and the comment on that test asserted
              the first — a comment asserting a property is not a test, and the ledger then
              carried the claim forward as verified.
              It is now the element IMMEDIATELY after the figure, pinned by nextElementSibling
              rather than by "somewhere after" (which was already true while it was three blocks
              down, and is therefore the assertion that could not catch this).
              BELOW rather than above, deliberately: the closing review made this figure a glance
              at text-3xl md:text-4xl font-bold, following Dashboard's net-worth card, and a
              12-word amber disclaimer above it would put a caveat where the glance belongs. Read
              top-to-bottom it lands before every other number on the screen, the percentage
              included, which is the property that actually matters. */}
          <p
            className="mt-1 text-xs text-amber-700"
            data-testid="screen.ai-settings.unverified-pricing"
            data-tour-id="screen.ai-settings.unverified-pricing"
          >
            {UNVERIFIED_PRICING_CAVEAT_HE}
          </p>
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
              return <p className="mt-1 text-xs text-slate-600">{CEILING_UNSET_HE}</p>;
            }
            if (ceilingILS === 0) {
              // A deliberate ₪0 IS configured — there is simply no denominator for a percentage.
              return <p className="mt-1 text-xs text-amber-700">{CEILING_ZERO_HE}</p>;
            }
            // Batch 9 — UNCAPPED. The displayed number is the real one; only the BAR is clamped,
            // because a div at width:500% is not a longer bar, it is a broken layout. The old
            // Math.min sat on the number itself, so 250 spent against a ₪50 ceiling rendered
            // exactly like 50 spent against 50 — reachable simply by lowering the ceiling after
            // spending, which is a thing an operator does precisely when spend is a problem.
            // CLOSING REVIEW (Ofra) — grouped, on the very screen whose F8 fix routes every ₪
            // figure through formatILS('he-IL'). A bare Math.round rendered the 500%-of-ceiling
            // state batch 9 deliberately made reachable as `50000%`, an unreadable run of digits
            // in exactly the state a reader most needs to parse at a glance.
            const pct = Math.round((totalUsedThisMonthILS / ceilingILS) * 100);
            const pctHe = pct.toLocaleString('he-IL');
            const style = USAGE_STYLES[usageLevel(pct)];
            return (
              <div className="mt-1">
                <div className="w-full bg-slate-100 rounded-full h-2" aria-hidden="true">
                  <div
                    data-testid="screen.ai-settings.usage-bar"
                    className={`${style.bar} h-2 rounded-full`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p
                  data-testid="screen.ai-settings.usage-pct"
                  className={`text-sm font-semibold tabular-nums mt-1 ${style.text}`}
                >
                  {pctHe}% מהתקרה — {style.labelHe}
                </p>
              </div>
            );
          })()}
            {/* D15/third-lens M5 — the exchange rate the ceiling's math is built on, shown next to
                the spend numbers it protects.
                Task 8 review F5 — and BOTH halves of that ₪ conversion are now disclosed. The
                previous version's comment claimed "staleness is surfaced honestly", but the only
                honesty shipped covered the FX rate; registry.ts's per-token prices — placeholders
                its own banner labels UNVERIFIED — were rendered as fact. That caveat is
                unconditional: it is a property of the rate card, not of any date.
                ACCEPTANCE RE-MEASURE — the pricing caveat itself no longer lives in this block. It
                sat here, three elements below the headline figure, while both a comment and the
                ledger described it as sitting directly beneath that figure. It has moved up to
                where those claims said it already was; only the FX-rate disclosures remain here,
                which are about the date and belong beside it. */}
            <div data-tour-id="screen.ai-settings.exchange-rate" className="mt-3 text-xs text-slate-600">
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
            </div>
        </section>
      )}

      {/* D13/spec §14.6 — persistent, rendered regardless of load/ceiling/provider state.
          Batch 9 (closing review I1) — this used to be ONE sentence ending "שאר הנתונים
          הפיננסיים נשארים מקומיים", which the chat handler had been contradicting on every turn.
          It is now the headline fact plus a list of what actually travels, and every line of that
          list is tied to a real field of the payload by src/__tests__/aiEgressDisclosure.payload
          .test.ts — see src/config/aiDisclosure.ts's EGRESS maps. */}
      <div
        data-testid="screen.ai-settings.egress-banner"
        data-tour-id="screen.ai-settings.egress-banner"
        className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        <p>{AI_EGRESS_DISCLOSURE_HEADLINE_HE}</p>
        <ul className="mt-2 space-y-1 list-disc ps-5">
          {AI_EGRESS_DISCLOSURE_DETAILS_HE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
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

          <section className="space-y-2">
            {/* Batch 9 — "ספקי AI", not a bare "ספקים". This app already uses ספק for the MERCHANT
                on a transaction (ExtractionReviewModal, CentralExpenseReport) and for the INSURER
                (InsurancesScreen); on a screen full of money figures, a bare ספק column reads as
                "who I paid". The disambiguation is made here, at the source, not only in the
                glossary prose that explains the number. */}
            <h2 className="text-sm font-semibold text-slate-700">ספקי AI</h2>
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
                            // CLOSING REVIEW — text-slate-500 on bg-slate-100 is 4.35:1 and FAILS
                            // WCAG AA for normal text. Exactly the token pair batch 5 measured and
                            // replaced on the extraction surfaces; this file was in no contrast
                            // guard, so it kept it. slate-600 clears with room, and the badge stays
                            // visibly quieter than its emerald-800 'מוגדר' sibling.
                            : 'rounded-full bg-slate-100 text-slate-600 border border-slate-300 px-2 py-0.5 text-xs font-medium'
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
            {/* ACCEPTANCE RE-MEASURE asked whether this <Explain> needs an empty state, because
                on a fresh install it explains a table with no rows. DECISION: NO CHANGE, and the
                premise is half-wrong — the empty state already exists (the branch immediately
                below, covered by AiSettingsScreen.test.tsx's byModel: [] case). What is genuinely
                slightly off is the glossary copy, which points at "the first column in the table"
                on a screen where the table is not rendered yet.
                Left as is, deliberately. The entry's FIRST job is defining the word מודל, which
                batch 9 added because 25 glossary entries never did — and a reader on a clean
                machine, who has never seen a model id, is the reader who most needs that
                definition. Hiding the Explain until data arrives would withhold it exactly then.
                Rewording it away from the column would cost the concrete referent that makes the
                definition land for everyone else, to fix a mismatch that lasts until the first AI
                call. The empty-state line already says plainly that there is no data yet. */}
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
                      <th className="py-1 font-normal">ספק AI</th>
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
