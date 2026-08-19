// src/components/ForecastCard.tsx — Stage 7 T7a. D38's Dashboard card.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SCALE DECISION, STATED RATHER THAN LEFT IN THE CLASSNAMES
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `Dashboard.tsx`'s net-worth figure is `text-3xl md:text-4xl font-bold`. **Two co-equal glance
// numbers is not a hierarchy**, so D38 rejects scale parity and this card takes
// `text-2xl md:text-3xl font-bold` — one step down, deliberately. It wins attention by POSITION and
// PANEL TREATMENT instead: full width, immediately beneath the net-worth block, on its own ground.
//
// Net worth stays the largest number on the Dashboard, and that is the intended hierarchy rather
// than an oversight: net worth is a measured fact about today, and this is a projection. The
// measured fact outranks the projection, and the type sizes say so.
//
// ── WHAT THIS COMPONENT IS NOT ALLOWED TO DECIDE ──────────────────────────────────────────────
//
// **Whether a figure may render.** D17 is enforced in `useForecast`, and this component only asks
// whether the hook handed it a number. A component-level suppression rule is a rule the next
// component skips — and the next component is T7b's full screen, which will read the same hook.
//
// ── WHAT CANNOT BE VERIFIED HERE, SAID PLAINLY ───────────────────────────────────────────────
//
// There is no browser and no screenshot tooling in this project. The tests below assert classes,
// DOM order and text. They CANNOT establish that the hierarchy reads correctly on a phone in
// Hebrew. That is exactly why D38–D42 were settled on paper, and it is why the class strings are
// asserted against `Dashboard.tsx`'s own — a relative claim two tests can hold is worth more than
// an absolute one no one can check.
import React from 'react';
import { Compass } from 'lucide-react';
import { formatILS } from '../config/money';
import { hebrewNameOfMonthKey } from '../config/hebrewMonths';
import { monthKeyOf } from '../utils/periodMath';
import { balanceVerdictOf, type ForecastInputKey } from '../utils/forecast';
import {
  BALANCE_VERDICT_LABEL_HE,
  FORECAST_ANCHOR_CLAMPED_HE,
  FORECAST_INCOMES_EDITED_HERE_HE,
  FORECAST_INPUT_LABEL_HE,
  FORECAST_OWN_NO_INCOME_HE,
  FORECAST_OPEN_SCREEN_HE,
  FORECAST_OWN_OUTGOING_LABEL_HE,
  balanceGapHe,
  forecastBalanceLabelHe,
  forecastCommittedHe,
  forecastHorizonHe,
  forecastIncomeReferenceHe,
  forecastOwnTargetHe,
  forecastShortfallHe,
} from '../utils/forecastCopy';
import type { UseForecastResult } from '../hooks/useForecast';
import { ScopeBadge } from './ScopeBadge';
import { DrillAffordance } from './DrillAffordance';
import { OPEN_CREATE_PAYLOAD } from '../utils/navigationPayload';

/**
 * Where each missing input's create form lives, so D26's empty state is a PATH and not an apology.
 *
 * `incomes` is `null`, and that is the one honest answer available: `MODULE_REGISTRY` HAS NO
 * INCOMES TAB (finding 1.3.11) — the collection has no screen, no service and no owner. It is not
 * unreachable, though: the Dashboard's own income section edits it. So that gap renders a NOTE
 * saying where to go rather than a link that goes nowhere. The missing tab is in §16 by name; this
 * is where a reader meets it.
 */
export const FORECAST_INPUT_DESTINATION: Record<ForecastInputKey, string | null> = {
  accounts: 'accounts',
  incomes: null,
  recurring: 'recurring',
  loans: 'loans',
  insurances: 'insurances',
  history: 'expenses',
};

/**
 * !! T7b-REVIEW F5 — THE DESTINATIONS THAT ACTUALLY OPEN A FORM, AND THE ONES THAT DO NOT.
 *
 * Every gap link above was a BARE TAB SWITCH, so `יתרות חשבונות` — rendered inside a sentence
 * saying the family has no accounts — landed on a screen with no accounts on it and no form open.
 * `forecastCopy.ts`'s comment on `balanceGapHe` already claimed T7b "turns each named input into its
 * create form"; it did not, and nothing in the tree held the claim.
 *
 * `accounts` and `loans` are on this list because `AccountsScreen` and `LoansScreen` CONSUME the
 * payload — they have done since Stage 5 D11, for `NetWorthIncompleteNotice`. `recurring`,
 * `insurances` and `expenses` are NOT, because their screens read no payload at all: sending one
 * would be indistinguishable from sending nothing, which is a deep link that looks built and is not.
 *
 * !! THIS LIST IS NOT TRUSTED. `forecastDeepLinks.test.ts` derives the same set from the tree — the
 * `case` clauses in `App.tsx` give tab → component, and the component's own imports say whether it
 * reads the payload — and fails if the two disagree in EITHER direction. So the day
 * `ExpensesBreakdown` gains a create form, the guard turns red and D36's drill gets its payload,
 * rather than the omission living on as a comment.
 */
export const FORECAST_DESTINATIONS_OPENING_CREATE: readonly string[] = ['accounts', 'loans'];

/**
 * The payload one gap link carries — `OPEN_CREATE_PAYLOAD` where the destination honours it, and
 * `undefined` where it does not.
 *
 * A function rather than a ternary at each of the two call sites: the card and the screen render the
 * same list of gaps, and "the card and the screen disagree about where a link goes" is the class of
 * defect the מי decision was routed through one shared helper to avoid.
 */
export function forecastGapPayload(destination: string): unknown {
  return FORECAST_DESTINATIONS_OPENING_CREATE.includes(destination) ? OPEN_CREATE_PAYLOAD : undefined;
}

/**
 * D38's conditional colour rule. The WORD carries the state too — colour is never the only signal.
 *
 * ── !! HOW THIS MAP IS HELD, AFTER T7a-REVIEW F4 ──────────────────────────────────────────────
 *
 * `ForecastCard.contrast.test.tsx` RENDERS this component and measures the colour token it finds
 * on the rendered element against the ground the rendered PANEL actually paints. That is a change
 * of subject, not of rigour: the guard used to call `ratio('teal-700', 'white')` on literal token
 * strings transcribed into the test, which proves a fact about the Tailwind theme and nothing at
 * all about this file. Both mutants below survived it — `negative` → `text-red-600` and `positive`
 * → `text-slate-400` — because neither literal in the test moved.
 *
 * The comment on `negative` used to be the ONLY thing holding D38's amber ruling, and a ratio
 * cannot replace it: `red-600` on `amber-50` measures 4.60:1 and PASSES AA. So the guard asserts
 * the amber family by name, which is the actual ruling, while the ratio holds legibility.
 */
const VERDICT_CLASS: Record<'positive' | 'near-zero' | 'negative', string> = {
  // Brand teal. Measured on the RENDERED CARD against the installed Tailwind theme in
  // `ForecastCard.contrast.test.tsx`, never a hardcoded ratio and never a transcribed token.
  positive: 'text-teal-700',
  'near-zero': 'text-slate-600',
  // AMBER GROUND, NOT RED-AS-ALARM (D38). A projected shortfall three months out is a thing to look
  // at, not an emergency, and red is the register this app uses for a failed read. HELD BY AN
  // ASSERTION on the rendered element, not by this sentence — F4's finding was that the sentence
  // was all there was.
  negative: 'text-amber-800',
};

const PANEL_CLASS: Record<'positive' | 'near-zero' | 'negative' | 'gap', string> = {
  positive: 'bg-white border-slate-200',
  'near-zero': 'bg-white border-slate-200',
  negative: 'bg-amber-50 border-amber-200',
  gap: 'bg-white border-slate-200',
};

/** D38's subordination, in one place so the two cards cannot drift apart. */
const GLANCE_CLASS = 'text-2xl md:text-3xl font-bold tabular-nums';

function monthNameOf(period: string): string {
  return hebrewNameOfMonthKey(monthKeyOf(period)) ?? period;
}

export interface ForecastCardProps {
  forecast: UseForecastResult;
  /** The viewer's resolved forecast scope. `'own'` gets a DIFFERENT panel, never this one's slot. */
  scope: 'own' | 'family';
  /** Opens a module's own screen so a named gap is actionable. */
  onNavigate: (moduleId: string, payload?: unknown) => void;
  /**
   * !! T7b — THE OPEN AFFORDANCE THE CARD SHIPPED WITHOUT.
   *
   * T7a deliberately shipped no link: the `תחזית` tab, its `ModuleRegistryId` member and
   * `App.tsx`'s `case` all land with the screen, and a card offering a link to nothing would have
   * been worse than a card offering none. It is OPTIONAL rather than required so the card stays
   * mountable in a bare test with no navigation, and absent rather than disabled when it is not
   * passed — a disabled control is a promise the screen cannot keep.
   */
  onOpen?: () => void;
}

/** The one open affordance, in one place so the two cards cannot drift apart. */
function OpenFullScreen({ onOpen, testId }: { onOpen?: () => void; testId: string }): React.JSX.Element | null {
  if (onOpen === undefined) return null;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onOpen}
      className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 transition-colors min-h-[36px]"
    >
      {FORECAST_OPEN_SCREEN_HE}
      <DrillAffordance className="text-indigo-400" />
    </button>
  );
}

/**
 * The named-gap state, shared by both cards.
 *
 * !! THE GLANCE POSITION HOLDS A NUMBER (D26 row 0 / A3), and the number is the COUNT OF MISSING
 * INPUTS — not ₪0, and not a caveat. "A caveat you can close is information; a caveat you can only
 * read is noise", and ₪0 in the glance would say the family has nothing, which is a statement about
 * their money rather than about our data.
 */
function ForecastGap({
  suppressed,
  onNavigate,
  testId,
}: {
  suppressed: readonly ForecastInputKey[];
  onNavigate: (moduleId: string, payload?: unknown) => void;
  testId: string;
}): React.JSX.Element {
  const labels = suppressed.map((key) => FORECAST_INPUT_LABEL_HE[key]);
  return (
    <>
      <p data-testid={`${testId}.gapCount`} className={`${GLANCE_CLASS} text-slate-800`}>
        {suppressed.length}
      </p>
      <p data-testid={`${testId}.gap`} className="text-sm text-slate-600 mt-1">
        {balanceGapHe(labels)}
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {suppressed.map((key) => {
          const destination = FORECAST_INPUT_DESTINATION[key];
          return (
            <li key={key}>
              {destination === null ? (
                <span
                  data-testid={`${testId}.gapNote.${key}`}
                  className="inline-flex items-center text-xs text-slate-500 border border-slate-200 rounded-full px-3 py-1.5"
                >
                  {FORECAST_INPUT_LABEL_HE[key]} — {FORECAST_INCOMES_EDITED_HERE_HE}
                </span>
              ) : (
                <button
                  type="button"
                  data-testid={`${testId}.gapLink.${key}`}
                  onClick={() => onNavigate(destination, forecastGapPayload(destination))}
                  className="inline-flex items-center text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-3 py-1.5 min-h-[36px] hover:bg-indigo-100 transition-colors"
                >
                  {FORECAST_INPUT_LABEL_HE[key]}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function ForecastCard({ forecast, scope, onNavigate, onOpen }: ForecastCardProps): React.JSX.Element | null {
  const { result } = forecast;

  if (forecast.status === 'loading') {
    return (
      <div
        data-testid="card.forecast.loading"
        // !! `slate-500`, NOT `slate-400`, AND THE REBUILT CONTRAST GUARD IS WHY. T7a-review F4
        // moved that guard off palette literals and onto the CARD, and the first thing measuring
        // the card turned up was this line: `text-slate-400` on white is 2.63:1, far under AA for
        // normal text — so the one sentence a family sees while the forecast loads was the least
        // legible thing on the screen. `slate-500` is 4.77:1 and is the token this card already
        // uses for its other subdued text.
        className="bg-white rounded-2xl border border-slate-100 p-6 text-center text-slate-500 text-sm"
      >
        טוען תחזית...
      </div>
    );
  }
  if (forecast.status === 'error') {
    // A FAILED COMPUTATION IS NOT A DENIAL, and the two must not share a panel. The only way to get
    // here is this app's own arithmetic refusing — `horizonPeriods` on a malformed anchor,
    // `balanceVerdictOf` on a non-finite figure — which is something somebody has to go and fix,
    // while a denial is a permission fact about the viewer. Rendering one as the other sends the
    // family to the wrong place.
    return (
      <div
        data-testid="card.forecast.error"
        // !! `red-700`, NOT `red-600`, AND MEASURING FOUND THIS ONE TOO. `text-red-600` on
        // `bg-red-50` is 4.36:1 — under AA, and only just, which is exactly how it survives review
        // by eye. `red-700` is 5.88:1 and keeps the red register D38 reserves for a failed read.
        //
        // THE PAIRING IS REPO-WIDE — twelve `bg-red-50` + `text-red-600` class strings across
        // `src/components` — and the other eleven are NOT touched here. They are a design-token
        // decision about the whole app's error register, not a T7a review finding, and changing
        // them inside a review-fix commit would put an unreviewed visual change in eleven screens.
        // Recorded in the ledger for a token pass instead; this card is fixed because this card is
        // the one the new guard measures, and a guard with a carve-out for its own file is not one.
        className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700 text-sm"
      >
        חישוב התחזית נכשל. הנתונים לא השתנו.
      </div>
    );
  }
  if (forecast.status === 'permission-denied' || result === null) {
    // A refusal is a calm explanatory state, never an absence (§5.7). It is also NOT a rebuke: the
    // sentence names what is unavailable and stops.
    return (
      <div
        data-testid="card.forecast.denied"
        className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm"
      >
        אין גישה לנתונים שהתחזית מחושבת מהם
      </div>
    );
  }

  const horizonMonths = result.horizon.length;
  const horizonLine = forecastHorizonHe({
    months: horizonMonths,
    startMonthName: monthNameOf(result.anchorPeriod),
  });
  const lastMonthName = monthNameOf(result.horizon[horizonMonths - 1]);

  // ── the `'own'` card — its OWN panel, and an explicit prefix ────────────────────────────────
  //
  // !! IT MUST NOT REUSE THE FAMILY PANEL. The family figure is money that will be LEFT; this is
  // money that will GO OUT. Opposite sign semantics in the same place is the most dangerous misread
  // in this stage, so the label is part of the glance line rather than a caption above it, the
  // panel is visually distinct, and `<ScopeBadge>` says the view is restricted while the sentence
  // says what is missing from it.
  //
  // !! D38's "DIFFERENT POSITION" CLAUSE IS STRUCK, AND IT IS STRUCK IN THE PLAN (§v2.2/A1), NOT
  // HERE. T7a-review F7: this comment used to assert the different position while the tree rendered
  // both scopes into ONE Dashboard slot — a departure from a drawn decision, carried by a sentence
  // in a file the plan's readers never open. The shipped design is the better one, and that is
  // precisely why it had to be declared rather than quietly kept: `forecastCardScopeOf` makes the
  // two cards mutually exclusive, so a reader never sees them adjacent and position was never a
  // signal it could read. The three signals that DO carry the sign semantics are all above, and
  // `ForecastCard.test.tsx` holds the exclusivity and the single slot as assertions.
  if (scope === 'own') {
    const outgoing = forecast.projectedExpenseILS;
    return (
      <section
        data-testid="card.forecast.own"
        dir="rtl"
        className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 md:p-6"
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm md:text-base font-medium text-slate-600">תחזית אישית</h2>
          <ScopeBadge scope="own" />
        </div>
        {outgoing === null ? (
          <ForecastGap
            suppressed={forecast.suppressedOutflow}
            onNavigate={onNavigate}
            testId="card.forecast.own"
          />
        ) : (
          <>
            <p data-testid="card.forecast.own.figure" className={`${GLANCE_CLASS} text-slate-800`}>
              <span className="text-sm md:text-base font-medium text-slate-600">
                {FORECAST_OWN_OUTGOING_LABEL_HE}:{' '}
              </span>
              {formatILS(outgoing)}
            </p>
            <p data-testid="card.forecast.own.committed" className="text-xs text-slate-600 mt-1 tabular-nums">
              {forecastCommittedHe(formatILS(forecast.committedILS))}
            </p>
            {forecast.target !== null && forecast.target.status === 'target' && (
              // NAMED, NOT SUBTRACTED — see `forecastOwnTargetHe` for why the arithmetic D38
              // implies is not available on this scope.
              <p data-testid="card.forecast.own.target" className="text-xs text-slate-600 mt-1 tabular-nums">
                {forecastOwnTargetHe(formatILS(forecast.target.amountILS))}
              </p>
            )}
            <p data-testid="card.forecast.own.noIncome" className="text-xs text-slate-500 mt-2">
              {FORECAST_OWN_NO_INCOME_HE}
            </p>
          </>
        )}
        <p data-testid="card.forecast.own.horizon" className="text-xs text-slate-500 mt-3">
          {horizonLine}
        </p>
        {result.anchorClamped && (
          <p data-testid="card.forecast.own.clamped" className="text-xs text-slate-500 mt-1">
            {FORECAST_ANCHOR_CLAMPED_HE}
          </p>
        )}
        <OpenFullScreen onOpen={onOpen} testId="card.forecast.own.open" />
      </section>
    );
  }

  // ── the family card ─────────────────────────────────────────────────────────────────────────
  const balance = forecast.projectedBalanceILS;
  const verdict = balance === null ? null : balanceVerdictOf(balance);
  const panel = verdict === null ? PANEL_CLASS.gap : PANEL_CLASS[verdict];

  return (
    <section
      data-testid="card.forecast"
      dir="rtl"
      className={`rounded-2xl border p-5 md:p-6 shadow-sm ${panel}`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm md:text-base font-medium text-slate-600">
          {balance === null ? 'תחזית' : forecastBalanceLabelHe(lastMonthName)}
        </h2>
        <Compass className="w-5 h-5 text-slate-400" aria-hidden="true" />
      </div>

      {balance === null || verdict === null ? (
        <ForecastGap suppressed={forecast.suppressed} onNavigate={onNavigate} testId="card.forecast" />
      ) : (
        <>
          {/* THE FIGURE. `data-testid="card.forecast.balance"` exists ONLY here, so "no number is
              labelled `יתרה צפויה` when the balance is null" (D16) is testable as a PICTURE rather
              than as a string search — the gap sentence legitimately contains that phrase while
              saying the figure cannot be shown. */}
          <p data-testid="card.forecast.balance" className={`${GLANCE_CLASS} ${VERDICT_CLASS[verdict]}`}>
            {formatILS(balance)}
          </p>
          <p data-testid="card.forecast.verdict" className={`text-sm font-medium tabular-nums ${VERDICT_CLASS[verdict]}`}>
            {verdict === 'negative'
              ? forecastShortfallHe(formatILS(Math.abs(balance)))
              : BALANCE_VERDICT_LABEL_HE[verdict]}
          </p>
          {forecast.projectedIncomeILS !== null && (
            // D38 element 3 — the denominator. Absent rather than ₪0 when nothing projects income,
            // because a ₪0 reference would answer "% of what?" with a number that is not one.
            <p data-testid="card.forecast.reference" className="text-sm text-slate-600 mt-1 tabular-nums">
              {forecastIncomeReferenceHe(formatILS(forecast.projectedIncomeILS))}
            </p>
          )}
          <p data-testid="card.forecast.committed" className="text-xs text-slate-600 mt-1 tabular-nums">
            {forecastCommittedHe(formatILS(forecast.committedILS))}
          </p>
        </>
      )}

      <p data-testid="card.forecast.horizon" className="text-xs text-slate-500 mt-3">
        {horizonLine}
      </p>
      {result.anchorClamped && (
        <p data-testid="card.forecast.clamped" className="text-xs text-slate-500 mt-1">
          {FORECAST_ANCHOR_CLAMPED_HE}
        </p>
      )}
      <OpenFullScreen onOpen={onOpen} testId="card.forecast.open" />
    </section>
  );
}
