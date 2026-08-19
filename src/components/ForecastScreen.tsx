// src/components/ForecastScreen.tsx — Stage 7 T7b. THE FULL SCREEN.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT SHIPS HERE, AND WHY IT COULD NOT SHIP ONE TASK EARLIER
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `App.tsx`'s `default` branch ends in `const _exhaustive: never = tab`, so a `MODULE_REGISTRY` id
// with no matching `case` FAILS `tsc --noEmit`. T2 therefore kept the registry entry out and handed
// it here: the id, the entry, the `case` and this file land in ONE commit, because any two of them
// without the third is either a broken build or a live tab pointing at nothing. T7a's card shipped
// deliberately without an open affordance for the same reason, and gains one in this commit.
//
// ── THE FOUR STATES, AND THE ORDER THEY ARE READ IN ───────────────────────────────────────────
//
// `forecast.status` is branched on FIRST, before a single per-input state is read. That is not
// stylistic: `LOADING_STATUS` used to be `{state: 'error'}`, so during a load every one of the
// eight inputs claimed a fault — inert in the card only because the card happened to branch on the
// scalar first. T7a's review fixed the trap at the source (`'unresolved'` is now its own state)
// rather than documenting it, and this screen keeps the same order anyway, because "remember to
// branch on status first" is not a property anything holds.
//
// ── WHAT THIS FILE CANNOT ESTABLISH ───────────────────────────────────────────────────────────
//
// There is NO browser and NO screenshot tooling in this project. Its tests assert classes, DOM
// order and text. They cannot establish that the hierarchy reads on a phone, in Hebrew, to a tired
// parent. D38–D42 were settled on paper for exactly that reason, and this is the task where the
// most drawing happens — which is why every shape decision is a pure function in `forecastView.ts`
// with its own test, and this file draws what it is handed.
import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, LineChart } from 'lucide-react';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useNotification } from '../contexts/NotificationContext';
import { formatILS } from '../config/money';
import { hebrewNameOfMonthKey } from '../config/hebrewMonths';
import { ADVICE_BOUNDARY_NOTICE_HE } from '../config/adviceBoundary';
import { currentAppDate, currentAppPeriod } from '../config/time';
import { monthKeyOf, periodOrUnknownFromMonthYear } from '../utils/periodMath';
import { Explain } from './Explain';
import { ScopeBadge } from './ScopeBadge';
import { DrillAffordance } from './DrillAffordance';
import { ForecastChart } from './ForecastChart';
import { FORECAST_INPUT_DESTINATION } from './ForecastCard';
import {
  DEFAULT_HORIZON_MONTHS,
  MAX_HORIZON_MONTHS,
  balanceVerdictOf,
  layerOf,
  type ForecastLineItem,
  type ForecastInputKey,
} from '../utils/forecast';
import {
  forecastAxisMaxILS,
  forecastMonthBarsOf,
  allowanceCategoriesFromLineItems,
} from '../utils/forecastView';
import {
  computeAllowance,
  flexibleCategoryIds,
  ALLOWANCE_LEAD_MAX,
} from '../utils/forecastTargets';
import {
  SEASONALITY_OFFERS,
  offeredSeasonalityAssumptions,
  parseSeasonalityScopeId,
  seasonalPercentOf,
} from '../utils/seasonality';
import { saveForecastAssumption } from '../services/ForecastAssumptionsService';
import {
  narrowForecastScopesToMember,
  resolveForecastScopes,
  useForecast,
  type ForecastScopes,
} from '../hooks/useForecast';
import type { PermissionLevel, PermissionRole } from '../types/permissions';
import {
  ALLOWANCE_FAMILY_GOAL_NOTE_HE,
  ALLOWANCE_NO_TARGET_HE,
  ALLOWANCE_OTHER_LEVERS_HE,
  ALLOWANCE_RANK_WORDS_HE,
  ALLOWANCE_TARGET_MET_HE,
  BAND_BASIS_LABEL_HE,
  BAND_LABEL_HE,
  CALIBRATION_NOT_ENOUGH_TIME_HE,
  CERTAIN_BASIS_LABEL_HE,
  FORECAST_ALLOWANCE_TITLE_HE,
  FORECAST_ANCHOR_CLAMPED_HE,
  FORECAST_ASSUMPTIONS_TITLE_HE,
  FORECAST_CALIBRATION_TITLE_HE,
  FORECAST_CERTAIN_TITLE_HE,
  FORECAST_DRILL_LABEL_HE,
  FORECAST_ESTIMATED_TITLE_HE,
  FORECAST_HORIZON_CONTROL_LABEL_HE,
  FORECAST_INCOMES_EDITED_HERE_HE,
  FORECAST_INPUT_LABEL_HE,
  FORECAST_MONTHS_TITLE_HE,
  FORECAST_NO_ASSUMPTIONS_HE,
  FORECAST_ONBOARDING_SENTENCE_HE,
  FORECAST_ONBOARDING_TITLE_HE,
  FORECAST_SCREEN_SUBTITLE_HE,
  FORECAST_SCREEN_TITLE_HE,
  INSTALMENT_DOUBLE_COUNT_HE,
  INSTALMENT_PLAN_KEY_CAVEAT_HE,
  LOAN_INSURANCE_DOUBLE_COUNT_HE,
  MONTH_CONFIDENCE_LABEL_HE,
  SEASONALITY_OFFERS_NONE_HE,
  SEASONALITY_OFFERS_TITLE_HE,
  SEASONALITY_OFFER_ACCEPT_HE,
  allowanceLeadHe,
  allowanceUnreachableHe,
  assumptionOverrideCertainHe,
  assumptionOverrideStatisticalHe,
  balanceGapHe,
  forecastBalanceLabelHe,
  forecastCommittedHe,
  forecastHorizonHe,
  forecastIncomeReferenceHe,
  forecastMemberScopeNoteHe,
  forecastMonthAccessibleNameHe,
  forecastMonthGapAccessibleNameHe,
  forecastOwnTargetHe,
  forecastShortfallHe,
  goalsExcludedHe,
  historyDepthChipHe,
  seasonalityOfferInertHe,
  seasonalityOfferLiveHe,
  unusableRowsHe,
} from '../utils/forecastCopy';

/** The horizon options D32 makes forecast-LOCAL. Deliberately not in `GlobalFilterState`. */
const HORIZON_OPTIONS: readonly number[] = [3, 6, MAX_HORIZON_MONTHS];

const VERDICT_CLASS: Record<'positive' | 'near-zero' | 'negative', string> = {
  positive: 'text-teal-700',
  'near-zero': 'text-slate-600',
  negative: 'text-amber-800',
};

export interface ForecastScreenProps {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel?: PermissionLevel;
  loansViewLevel?: PermissionLevel;
  expensesViewLevel?: PermissionLevel;
  recurringViewLevel?: PermissionLevel;
  insurancesViewLevel?: PermissionLevel;
  incomeViewLevel?: PermissionLevel;
  goalsViewLevel?: PermissionLevel;
  forecastViewLevel?: PermissionLevel;
}

function Section({
  title,
  testId,
  children,
}: {
  title: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      data-testid={testId}
      data-tour-id={testId}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-6"
    >
      <div className="flex items-center gap-1.5 mb-4">
        <h2 className="text-base md:text-lg font-bold text-slate-800">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function ForecastScreen(props: ForecastScreenProps): React.JSX.Element {
  const { session } = props;
  const { filters, familyMembers } = useGlobalFilters();
  const { navigateTo } = useNavigation();
  const { addNotification } = useNotification();
  const [horizonMonths, setHorizonMonths] = useState<number>(DEFAULT_HORIZON_MONTHS);

  // The clock is read ONCE on mount and passed in as strings (D32b). `forecast.ts` and its whole
  // closure construct no `Date` at all, and `forecastPurity.test.ts` fails on one.
  const todayPeriod = useMemo(() => currentAppPeriod(), []);
  const todayDate = useMemo(() => currentAppDate(), []);

  const baseScopes: ForecastScopes = useMemo(
    () =>
      resolveForecastScopes({
        role: session.role,
        levels: {
          accounts: props.accountsViewLevel,
          loans: props.loansViewLevel,
          expenses: props.expensesViewLevel,
          recurring: props.recurringViewLevel,
          insurances: props.insurancesViewLevel,
          income: props.incomeViewLevel,
          goals: props.goalsViewLevel,
          forecast: props.forecastViewLevel,
        },
      }),
    [
      session.role,
      props.accountsViewLevel,
      props.loansViewLevel,
      props.expensesViewLevel,
      props.recurringViewLevel,
      props.insurancesViewLevel,
      props.incomeViewLevel,
      props.goalsViewLevel,
      props.forecastViewLevel,
    ]
  );

  // !! THE מי DECISION, AT ITS CALL SITE. See `narrowForecastScopesToMember`'s own header for the
  // full argument: D21(b)'s re-slice is not constructible against the sealed handle, and the option
  // taken is the one net worth already uses one card up — a single selected member becomes the
  // TARGET of every read, every scope collapses to `'own'`, and each read re-runs its own Rules
  // gate. Nothing is re-sliced and nothing is re-sealed.
  const selectedMemberId =
    filters.member.mode === 'members' && filters.member.memberIds.length === 1
      ? filters.member.memberIds[0]
      : null;
  const scopes = useMemo(
    () => (selectedMemberId === null ? baseScopes : narrowForecastScopesToMember(baseScopes)),
    [baseScopes, selectedMemberId]
  );
  const selectedMemberName =
    selectedMemberId === null
      ? null
      : familyMembers.members.find((m) => m.id === selectedMemberId)?.name ?? selectedMemberId;

  const forecast = useForecast({
    viewerMemberId: selectedMemberId ?? session.memberId,
    scopes,
    // מתי is the ANCHOR, not the range (D32). A past anchor is clamped forward and the screen says
    // so; silent back-projection is the only unacceptable option.
    anchorPeriod: periodOrUnknownFromMonthYear(filters.period.month, filters.period.year),
    todayPeriod,
    todayDate,
    horizonMonths,
  });

  const monthNameOf = useCallback(
    (period: string): string => hebrewNameOfMonthKey(monthKeyOf(period)) ?? period,
    []
  );

  // D35 — an assumption written from this screen calls `reload()` explicitly. The test that holds
  // it asserts the RENDERED FIGURE changes, not that `reload` was called.
  const acceptSeasonality = useCallback(
    async (draft: Parameters<typeof saveForecastAssumption>[0]): Promise<void> => {
      try {
        // The ACTOR is the signed-in member, not the selected one: a draft is attributed to whoever
        // accepts it, and Rules bind the write to `ownerId == memberId()` anyway.
        await saveForecastAssumption(draft, session.memberId);
        forecast.reload();
      } catch {
        addNotification('error', 'שמירת ההתאמה העונתית נכשלה');
      }
    },
    [addNotification, forecast]
  );

  // ── the four states, status FIRST ───────────────────────────────────────────────────────────
  if (forecast.status === 'loading') {
    return (
      <div data-testid="screen.forecast.loading" dir="rtl" className="p-8 text-center text-slate-500">
        טוען תחזית...
      </div>
    );
  }
  if (forecast.status === 'error') {
    return (
      <div
        data-testid="screen.forecast.error"
        dir="rtl"
        className="p-8 text-center text-red-700 bg-red-50 border border-red-200 rounded-2xl"
      >
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-300" />
        חישוב התחזית נכשל. הנתונים לא השתנו.
      </div>
    );
  }
  if (forecast.status === 'permission-denied' || forecast.result === null) {
    return (
      <div
        data-testid="screen.forecast.denied"
        dir="rtl"
        className="p-8 text-center text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl"
      >
        אין גישה לנתונים שהתחזית מחושבת מהם
      </div>
    );
  }

  const result = forecast.result;
  const cardScope = scopes.accounts === 'family' ? 'family' : 'own';
  const horizonLine = forecastHorizonHe({
    months: result.horizon.length,
    startMonthName: monthNameOf(result.anchorPeriod),
  });
  const lastMonthName = monthNameOf(result.horizon[result.horizon.length - 1]);
  const balance = forecast.projectedBalanceILS;
  const verdict = balance === null ? null : balanceVerdictOf(balance);

  const layer = forecast.statisticalLayer;
  const monthsObserved = layer === null ? 0 : layer.weakestMonthsObserved;
  const bars = forecastMonthBarsOf({
    byPeriod: result.byPeriod,
    lineItems: result.lineItems,
    monthsObserved,
  });
  const axisMaxILS = forecastAxisMaxILS(bars);

  // מה narrows the CATEGORY-LEVEL sections and nothing else, and the screen says so. A balance
  // computed over a subset of categories is not a balance — it is the same class of figure D17
  // refuses to draw, one dimension over.
  const selectedCategories = filters.category.categories;
  const categoryVisible = (categoryId: string): boolean =>
    selectedCategories.length === 0 || selectedCategories.includes(categoryId);

  const certainItems = result.lineItems.filter((item) => layerOf(item.basis) === 'certain');
  const assumedItems = result.lineItems.filter((item) => layerOf(item.basis) === 'assumption');
  const estimatedCategories =
    layer === null ? [] : layer.categories.filter((c) => categoryVisible(c.categoryId));

  // D29 — the allowance block, over the NON-CONTRACTUAL pool only.
  const allowanceCategories = allowanceCategoriesFromLineItems(result.lineItems);
  const projectedSurplusILS =
    forecast.projectedIncomeILS === null || forecast.projectedExpenseILS === null
      ? null
      : forecast.projectedIncomeILS - forecast.projectedExpenseILS;
  const target = forecast.target;
  const allowance =
    projectedSurplusILS === null
      ? null
      : computeAllowance({
          targetILS: target !== null && target.status === 'target' ? target.amountILS : null,
          projectedILS: projectedSurplusILS,
          categories: allowanceCategories,
          // The family's OWN `flexible: false` assumptions narrow the pool. They come off the hook
          // rather than being passed as `[]`: an empty corpus here compiles, runs, and offers a
          // category the family has already marked as fixed.
          flexibleIds: flexibleCategoryIds({
            categories: allowanceCategories,
            assumptions: forecast.assumptions,
            horizon: result.horizon,
          }),
        });

  // D24/A31 — the offers, and the measured-inert one among them. An offer whose category the
  // statistical layer holds no estimate for changes NOTHING when accepted; that is not a bug to
  // hide, it is a fact the accept surface has to state.
  const offers = offeredSeasonalityAssumptions({
    offers: SEASONALITY_OFFERS,
    existing: [],
    ownerId: session.memberId,
    fromPeriod: result.anchorPeriod,
  });
  const estimatedCategoryIds = new Set(
    layer === null ? [] : layer.categories.filter((c) => c.status === 'estimated').map((c) => c.categoryId)
  );

  /**
   * One contractual row's own name, so a reader sees WHAT is committed and not only how much.
   *
   * A total switch rather than `LABEL[item.basis.kind as keyof typeof LABEL]`: that cast yields
   * `undefined` for a kind the record does not hold and renders an empty cell, while this fails to
   * COMPILE the day `ForecastBasis` grows a sixth member. `layerOf(basis) === 'certain'` already
   * guarantees one of the four, and the two non-certain kinds return `null` rather than throwing —
   * this is a label, not an invariant.
   */
  const certainBasisLabelOf = (item: ForecastLineItem): string | null => {
    switch (item.basis.kind) {
      case 'recurring':
      case 'loan':
      case 'insurance':
      case 'installment':
        return CERTAIN_BASIS_LABEL_HE[item.basis.kind];
      case 'movingAverage':
      case 'assumption':
        return null;
      default: {
        const exhaustive: never = item.basis;
        void exhaustive;
        return null;
      }
    }
  };

  /**
   * The NAME of the item a basis stands for — a loan's name, an insurer, a recurring item's
   * description, a plan key. Used by the override disclosure, which names what was displaced
   * because the displaced AMOUNT is not carried on `ForecastBasis` (see `assumptionOverrideCertainHe`).
   */
  const basisNameOf = (basis: ForecastLineItem['basis']): string => {
    switch (basis.kind) {
      case 'recurring':
        return `${CERTAIN_BASIS_LABEL_HE.recurring} ${basis.description}`;
      case 'loan':
        return `${CERTAIN_BASIS_LABEL_HE.loan} ${basis.name}`;
      case 'insurance':
        return `${CERTAIN_BASIS_LABEL_HE.insurance} ${basis.provider}`;
      case 'installment':
        return `${CERTAIN_BASIS_LABEL_HE.installment} ${basis.planKey}`;
      case 'movingAverage':
      case 'assumption':
        return '';
      default: {
        const exhaustive: never = basis;
        void exhaustive;
        return '';
      }
    }
  };

  const certainByBasis = (kind: ForecastLineItem['basis']['kind']): ForecastLineItem[] =>
    certainItems.filter((item) => item.basis.kind === kind);
  const hasInstalments = certainByBasis('installment').length > 0;
  const hasLoansOrInsurances =
    certainByBasis('loan').length > 0 || certainByBasis('insurance').length > 0;

  return (
    <div className="space-y-6" dir="rtl" data-testid="screen.forecast" data-tour-id="screen.forecast">
      {/* ── header ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <LineChart className="w-6 h-6 text-teal-700" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-slate-800">{FORECAST_SCREEN_TITLE_HE}</h1>
            {cardScope === 'own' && <ScopeBadge scope="own" />}
          </div>
          <p className="text-slate-500 mt-1">{FORECAST_SCREEN_SUBTITLE_HE}</p>
          {selectedMemberName !== null && (
            <p data-testid="screen.forecast.memberScope" className="text-sm text-indigo-700 mt-1">
              {forecastMemberScopeNoteHe(selectedMemberName)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5" data-tour-id="screen.forecast.horizon">
          <span className="text-sm text-slate-500">{FORECAST_HORIZON_CONTROL_LABEL_HE}</span>
          <Explain id="forecast.horizon" />
          <div className="flex gap-1">
            {HORIZON_OPTIONS.map((months) => (
              <button
                key={months}
                type="button"
                data-testid={`screen.forecast.horizon.${months}`}
                data-tour-id={`screen.forecast.horizon.${months}`}
                aria-pressed={months === horizonMonths}
                onClick={() => setHorizonMonths(months)}
                className={`min-h-[36px] px-3 rounded-full text-sm font-medium border transition-colors ${
                  months === horizonMonths
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {months}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── the headline, or D26's path ──────────────────────────────────────────────────── */}
      <section
        data-testid="screen.forecast.headline"
        data-tour-id="screen.forecast.headline"
        className={`rounded-2xl border p-5 md:p-6 shadow-sm ${
          verdict === 'negative' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
        }`}
      >
        {balance === null || verdict === null ? (
          <>
            {/* !! THE GLANCE POSITION HOLDS A NUMBER, and the number is the COUNT OF MISSING
                INPUTS. Not ₪0 — ₪0 in this position says the family has nothing, which is a
                statement about their money rather than about our data. On the corpus T0 actually
                measured, the day-one figure is FIVE, not three: `accounts`, `incomes` and
                `recurring` are missing as collections and `loans`/`insurances` are empty, and an
                empty read suppresses. */}
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm md:text-base font-medium text-slate-600">
                {FORECAST_ONBOARDING_TITLE_HE}
              </h2>
              <Explain id="forecast.balanceSuppressed" />
            </div>
            <p
              data-testid="screen.forecast.gapCount"
              className="text-3xl md:text-4xl font-bold tabular-nums text-slate-800 mt-1"
            >
              {forecast.suppressed.length}
            </p>
            <p data-testid="screen.forecast.gap" className="text-sm text-slate-600 mt-1">
              {balanceGapHe(forecast.suppressed.map((key) => FORECAST_INPUT_LABEL_HE[key]))}
            </p>
            <p className="text-xs text-slate-500 mt-1">{FORECAST_ONBOARDING_SENTENCE_HE}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {forecast.suppressed.map((key: ForecastInputKey) => {
                const destination = FORECAST_INPUT_DESTINATION[key];
                return (
                  <li key={key}>
                    {destination === null ? (
                      <span
                        data-testid={`screen.forecast.gapNote.${key}`}
                        className="inline-flex items-center text-xs text-slate-500 border border-slate-200 rounded-full px-3 py-1.5"
                      >
                        {FORECAST_INPUT_LABEL_HE[key]} — {FORECAST_INCOMES_EDITED_HERE_HE}
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`screen.forecast.gapLink.${key}`}
                        data-tour-id={`screen.forecast.gapLink.${key}`}
                        onClick={() => navigateTo(destination)}
                        className="inline-flex items-center text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-3 py-1.5 min-h-[36px] hover:bg-indigo-100 transition-colors"
                      >
                        {FORECAST_INPUT_LABEL_HE[key]}
                        <DrillAffordance className="text-indigo-400" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm md:text-base font-medium text-slate-600">
                {forecastBalanceLabelHe(lastMonthName)}
              </h2>
              <Explain id="forecast.projectedBalance" />
            </div>
            <p
              data-testid="screen.forecast.balance"
              className={`text-3xl md:text-4xl font-bold tabular-nums ${VERDICT_CLASS[verdict]}`}
            >
              {formatILS(balance)}
            </p>
            <p className={`text-sm font-medium ${VERDICT_CLASS[verdict]}`} data-testid="screen.forecast.verdict">
              {verdict === 'negative' ? forecastShortfallHe(formatILS(Math.abs(balance))) : ''}
            </p>
            {forecast.projectedIncomeILS !== null && (
              <p data-testid="screen.forecast.reference" className="text-sm text-slate-600 mt-1 tabular-nums">
                {forecastIncomeReferenceHe(formatILS(forecast.projectedIncomeILS))}
                <Explain id="forecast.monthIncome" />
              </p>
            )}
            <p data-testid="screen.forecast.committed" className="text-sm text-slate-600 mt-1 tabular-nums">
              {forecastCommittedHe(formatILS(forecast.committedILS))}
              <Explain id="forecast.certainTotal" />
            </p>
            {forecast.openingBalance !== null && (
              <p data-testid="screen.forecast.opening" className="text-xs text-slate-500 mt-2 tabular-nums">
                {formatILS(forecast.openingBalance.amountILS)}
                <Explain id="forecast.openingBalance" />
                <span className="mx-1">·</span>
                {forecast.openingBalance.asOf}
                <Explain id="forecast.balanceAsOf" />
                <span className="mx-1">·</span>
                <span data-testid="screen.forecast.staleness">{forecast.openingBalance.staleness}</span>
                <Explain id="forecast.balanceStaleness" />
              </p>
            )}
          </>
        )}
        <p data-testid="screen.forecast.horizonLine" className="text-xs text-slate-500 mt-3">
          {horizonLine}
        </p>
        {result.anchorClamped && (
          <p data-testid="screen.forecast.clamped" className="text-xs text-slate-500 mt-1">
            {FORECAST_ANCHOR_CLAMPED_HE}
            <Explain id="forecast.anchorClamp" />
          </p>
        )}
      </section>

      {/* ── month by month ───────────────────────────────────────────────────────────────── */}
      <Section title={FORECAST_MONTHS_TITLE_HE} testId="screen.forecast.months">
        <ForecastChart bars={bars} monthNameOf={monthNameOf} />
        {/* !! THE ACCESSIBLE REPRESENTATION OF THE CHART LIVES HERE, IN ORDINARY DOM. See
            `ForecastChart.tsx`'s header: an `aria-label` on an SVG rect inside a third-party chart
            is reachable only through that library's own DOM, which this project cannot verify.
            Every figure below carries its own `<Explain>`, which the chart could never offer. */}
        <ul className="mt-4 space-y-2" data-testid="screen.forecast.monthList">
          {bars.map((bar) => {
            const monthName = monthNameOf(bar.period);
            const totals = result.byPeriod.find((m) => m.period === bar.period);
            return (
              <li
                key={bar.period}
                data-testid={`screen.forecast.month.${bar.period}`}
                data-tour-id={`screen.forecast.month.${bar.period}`}
                aria-label={
                  bar.gap
                    ? forecastMonthGapAccessibleNameHe({
                        monthName,
                        committedText: formatILS(bar.certainILS),
                      })
                    : forecastMonthAccessibleNameHe({
                        monthName,
                        totalText: formatILS(bar.totalILS),
                        committedText: formatILS(bar.certainILS),
                      })
                }
                className="border border-slate-100 rounded-xl p-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-slate-800">{monthName}</span>
                  <span className="text-sm text-slate-600 tabular-nums">
                    {formatILS(bar.certainILS)}
                    <Explain id="forecast.certainTotal" />
                  </span>
                  {bar.gap ? (
                    <span
                      data-testid={`screen.forecast.month.${bar.period}.gap`}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 border border-dashed border-slate-300 rounded-full px-2 py-0.5"
                    >
                      ?
                      <Explain id="forecast.gapNoHistory" />
                    </span>
                  ) : (
                    <span
                      data-testid={`screen.forecast.month.${bar.period}.estimated`}
                      className="text-sm text-slate-600 tabular-nums"
                    >
                      {formatILS(bar.estimatedILS)}
                      <Explain id="forecast.estimatedTotal" />
                    </span>
                  )}
                  {totals !== undefined && (
                    <span className="text-xs text-slate-500 tabular-nums">
                      {formatILS(totals.expenseILS)}
                      <Explain id="forecast.monthExpense" />
                    </span>
                  )}
                  {bar.confidence !== null && (
                    <span
                      data-testid={`screen.forecast.month.${bar.period}.confidence`}
                      className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5"
                    >
                      {MONTH_CONFIDENCE_LABEL_HE[bar.confidence]}
                      <Explain id="forecast.monthConfidence" />
                    </span>
                  )}
                  {bar.historyDepthMonths !== null && (
                    <span
                      data-testid={`screen.forecast.month.${bar.period}.depth`}
                      className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5"
                    >
                      {historyDepthChipHe(bar.historyDepthMonths)}
                      <Explain id="forecast.historyDepth" />
                    </span>
                  )}
                </div>
                {bar.band !== null && (
                  <div
                    data-testid={`screen.forecast.month.${bar.period}.band`}
                    className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 tabular-nums"
                  >
                    <span>
                      {BAND_LABEL_HE.low} {formatILS(bar.band.lowILS)}
                      <Explain id="forecast.bandLow" />
                    </span>
                    <span>
                      {BAND_LABEL_HE.mid} {formatILS(bar.band.midILS)}
                      <Explain id="forecast.bandMid" />
                    </span>
                    <span>
                      {BAND_LABEL_HE.high} {formatILS(bar.band.highILS)}
                      <Explain id="forecast.bandHigh" />
                    </span>
                  </div>
                )}
                {bar.bandBasis !== null && bar.band === null && (
                  <p className="mt-1 text-xs text-slate-500">{BAND_BASIS_LABEL_HE[bar.bandBasis]}</p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-slate-400 tabular-nums">
          {formatILS(axisMaxILS)}
        </p>
      </Section>

      {/* ── the contractual layer, ITEMISED BY NAME (D23) ────────────────────────────────── */}
      <Section title={FORECAST_CERTAIN_TITLE_HE} testId="screen.forecast.certain">
        {certainItems.length === 0 ? (
          <p className="text-sm text-slate-500">{FORECAST_ONBOARDING_SENTENCE_HE}</p>
        ) : (
          <ul className="space-y-1.5" data-testid="screen.forecast.certainList">
            {certainItems.map((item, index) => (
              <li
                key={`${item.period}-${item.categoryId}-${index}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-slate-700">
                  {certainBasisLabelOf(item)} · {monthNameOf(item.period)} · {item.categoryId}
                  {item.basis.kind === 'installment' && <Explain id="forecast.installmentsCommitted" />}
                </span>
                <span className="text-slate-800 tabular-nums">{formatILS(item.amountILS)}</span>
              </li>
            ))}
          </ul>
        )}
        {/* !! THE TWO DOUBLE COUNTS, DISCLOSED RATHER THAN EXCLUDED — and they are different
            problems. The loan/insurance one has NO discriminator on the bank row, so it cannot be
            excluded at all. The instalment one HAS one (`installmentNumber`) and is therefore
            smaller and excludable in principle — it is not excluded here because D23 rules only on
            `recurringId`, and widening an engine rule from a screen is how a plan and a tree stop
            describing the same app. Both name the DIRECTION of the error, because a family can act
            on "the estimate is a little high" and cannot act on "there may be an inaccuracy". */}
        {hasLoansOrInsurances && (
          <p data-testid="screen.forecast.doubleCount" className="mt-4 text-xs text-slate-500">
            {LOAN_INSURANCE_DOUBLE_COUNT_HE}
            <Explain id="forecast.doubleCountCaveat" />
          </p>
        )}
        {hasInstalments && (
          <>
            <p data-testid="screen.forecast.instalmentDoubleCount" className="mt-2 text-xs text-slate-500">
              {INSTALMENT_DOUBLE_COUNT_HE}
              <Explain id="forecast.instalmentDoubleCount" />
            </p>
            <p data-testid="screen.forecast.planKey" className="mt-2 text-xs text-slate-500">
              {INSTALMENT_PLAN_KEY_CAVEAT_HE}
              <Explain id="forecast.installmentPlanKey" />
            </p>
          </>
        )}
      </Section>

      {/* ── the statistical layer, per category, with D36's one drill ─────────────────────── */}
      <Section title={FORECAST_ESTIMATED_TITLE_HE} testId="screen.forecast.estimated">
        {estimatedCategories.length === 0 ? (
          <p className="text-sm text-slate-500">{FORECAST_ONBOARDING_SENTENCE_HE}</p>
        ) : (
          <ul className="space-y-2" data-testid="screen.forecast.estimatedList">
            {estimatedCategories.map((category) => (
              <li key={category.categoryId} className="border border-slate-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800">{category.categoryId}</span>
                  {category.status === 'estimated' ? (
                    <span className="text-sm text-slate-700 tabular-nums">
                      {formatILS(category.estimateILS)}
                      <Explain id="forecast.estimatedTotal" />
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">{category.reasonHe}</span>
                  )}
                </div>
                {category.status === 'estimated' && (
                  <>
                    <p className="mt-1 text-xs text-slate-500">
                      {historyDepthChipHe(category.monthsObserved)}
                      <Explain id="forecast.historyDepth" />
                    </p>
                    {/* D36 — THE ONE DRILL, BUILT. October's estimated variable spend opens the
                        rows the average was computed from, in the existing drill affordance's
                        shape. §5.4's comparison mode is deferred BY NAME in §16 rather than
                        dropped silently. */}
                    <button
                      type="button"
                      data-testid={`screen.forecast.drill.${category.categoryId}`}
                      data-tour-id="screen.forecast.drill"
                      onClick={() => navigateTo('expenses')}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 transition-colors"
                    >
                      {FORECAST_DRILL_LABEL_HE}
                      <DrillAffordance className="text-indigo-400" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {layer !== null && layer.status !== 'ready' && (
          <p data-testid="screen.forecast.historyRefusal" className="mt-3 text-xs text-amber-800">
            {layer.reasonHe}
          </p>
        )}
        {forecast.historyRefusalHe !== null && (
          <p data-testid="screen.forecast.historyRefusalHook" className="mt-2 text-xs text-amber-800">
            {forecast.historyRefusalHe}
          </p>
        )}
        <p data-testid="screen.forecast.unusableRows" className="mt-3 text-xs text-slate-500 tabular-nums">
          {unusableRowsHe(forecast.unusableRowCount)}
          <Explain id="forecast.unusableRows" />
        </p>
      </Section>

      {/* ── manually set amounts, and the number that goes DOWN because of one ────────────── */}
      <Section title={FORECAST_ASSUMPTIONS_TITLE_HE} testId="screen.forecast.assumptions">
        {assumedItems.length === 0 ? (
          <p className="text-sm text-slate-500">{FORECAST_NO_ASSUMPTIONS_HE}</p>
        ) : (
          <ul className="space-y-2" data-testid="screen.forecast.assumptionList">
            {assumedItems.map((item, index) => {
              const overrides = item.basis.kind === 'assumption' ? item.basis.overrides : [];
              const displacedCertain = overrides.find(
                (basis) => layerOf(basis) === 'certain'
              );
              return (
                <li key={`${item.period}-${item.categoryId}-${index}`} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-800">
                      {monthNameOf(item.period)} · {item.categoryId}
                      <Explain id="forecast.assumptionOverride" />
                    </span>
                    <span className="text-slate-800 tabular-nums">{formatILS(item.amountILS)}</span>
                  </div>
                  {/* !! THE COPY THAT STOPS A CORRECT NUMBER READING AS A BUG. An assumption that
                      displaces a CONTRACTUAL item removes it from `certainILS`, so `מזה כבר סגור`
                      reports LESS after an override than before it. That is pinned, it is correct,
                      and on first reading it looks exactly like a defect — so the sentence names
                      the mechanism in the same breath as the figure. */}
                  <p className="mt-1 text-xs text-slate-500">
                    {displacedCertain !== undefined
                      ? assumptionOverrideCertainHe({
                          categoryId: item.categoryId,
                          displacedName: basisNameOf(displacedCertain),
                          assumedText: formatILS(item.amountILS),
                        })
                      : assumptionOverrideStatisticalHe({
                          categoryId: item.categoryId,
                          assumedText: formatILS(item.amountILS),
                        })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── seasonality offers, including the one that is measured INERT ─────────────────── */}
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            {SEASONALITY_OFFERS_TITLE_HE}
            <Explain id="forecast.seasonalAdjustment" />
          </span>
        }
        testId="screen.forecast.seasonality"
      >
        {offers.length === 0 ? (
          <p className="text-sm text-slate-500">{SEASONALITY_OFFERS_NONE_HE}</p>
        ) : (
          <ul className="space-y-2" data-testid="screen.forecast.seasonalityList">
            {offers.map((draft) => {
              const scope = parseSeasonalityScopeId(draft.scopeId);
              const monthName =
                scope === null ? draft.scopeId : hebrewNameOfMonthKey(scope.monthKey) ?? scope.monthKey;
              const categoryId = scope === null ? draft.scopeId : scope.categoryId;
              // !! MEASURED, NOT ASSUMED. The T6 review drove an accepted offer end to end and
              // measured the September one INERT on the demo corpus: its category is the education
              // category, n = 0 by construction, so accepting it moves not one line item. That was
              // handed here as a PRODUCT requirement. The offer is not withdrawn — a family with no
              // education spend today may have it in September — but it says outright that nothing
              // on this screen will move.
              const inert = !estimatedCategoryIds.has(categoryId);
              return (
                <li
                  key={draft.scopeId}
                  data-testid={`screen.forecast.offer.${draft.scopeId}`}
                  className="border border-slate-100 rounded-xl p-3"
                >
                  <p className="text-sm text-slate-800">{draft.reasonHe}</p>
                  <p
                    data-testid={`screen.forecast.offer.${draft.scopeId}.effect`}
                    className={`mt-1 text-xs ${inert ? 'text-amber-800' : 'text-slate-500'}`}
                  >
                    {inert
                      ? seasonalityOfferInertHe({ monthName, categoryId })
                      : seasonalityOfferLiveHe({
                          monthName,
                          categoryId,
                          percent: seasonalPercentOf({
                            source: 'user',
                            factor: draft.factor ?? 1,
                            // `n` is the observation count behind an OBSERVED factor. A user-set one
                            // rests on a person, not on a sample, and `seasonalPercentOf` reads only
                            // `factor` — so this is the honest zero rather than an invented count.
                            n: 0,
                          }),
                        })}
                  </p>
                  <button
                    type="button"
                    data-testid={`screen.forecast.offer.${draft.scopeId}.accept`}
                    data-tour-id="screen.forecast.offer.accept"
                    onClick={() => {
                      void acceptSeasonality(draft as Parameters<typeof saveForecastAssumption>[0]);
                    }}
                    className="mt-2 min-h-[36px] px-3 rounded-full text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 transition-colors"
                  >
                    {SEASONALITY_OFFER_ACCEPT_HE}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── "מה צריך לקרות" — AND THE ADVICE BOUNDARY, WHICH SHIPS WITH IT ────────────────── */}
      <Section title={FORECAST_ALLOWANCE_TITLE_HE} testId="screen.forecast.allowance">
        {target !== null && target.status === 'target' && (
          <p className="text-sm text-slate-700 tabular-nums">
            {forecastOwnTargetHe(formatILS(target.amountILS))}
            <Explain id={target.source === 'personalTarget' ? 'forecast.personalTarget' : 'forecast.targetSource'} />
            {target.isFamilyScoped && (
              <span className="block text-xs text-slate-500">{ALLOWANCE_FAMILY_GOAL_NOTE_HE}</span>
            )}
          </p>
        )}
        {target !== null && target.goalsExcludedCount > 0 && (
          <p className="mt-1 text-xs text-slate-500">{goalsExcludedHe(target.goalsExcludedCount)}</p>
        )}
        {allowance === null && <p className="text-sm text-slate-500">{ALLOWANCE_NO_TARGET_HE}</p>}
        {allowance !== null && allowance.status === 'no-target' && (
          <p className="text-sm text-slate-500">{ALLOWANCE_NO_TARGET_HE}</p>
        )}
        {allowance !== null && allowance.status === 'target-met' && (
          <p className="text-sm text-teal-700">{ALLOWANCE_TARGET_MET_HE}</p>
        )}
        {allowance !== null && allowance.status === 'unreachable' && (
          <p data-testid="screen.forecast.unreachable" className="text-sm text-slate-700">
            {allowanceUnreachableHe({
              targetText: formatILS(target !== null && target.status === 'target' ? target.amountILS : null),
              months: result.horizon.length,
              flexibleTotalText: formatILS(allowance.flexibleTotalILS),
              gapText: formatILS(allowance.gapILS),
            })}
            <Explain id="forecast.unreachableTarget" />
          </p>
        )}
        {allowance !== null && allowance.status === 'allowances' && (
          <>
            <p data-testid="screen.forecast.shortfall" className="text-sm text-slate-700 tabular-nums">
              {formatILS(allowance.shortfallILS)}
              <Explain id="forecast.shortfall" />
            </p>
            <ul className="mt-3 space-y-2" data-testid="screen.forecast.allowanceLead">
              {allowance.leadCategoryIds.map((categoryId, index) => {
                const row = allowance.rows.find((r) => r.categoryId === categoryId);
                return (
                  <li key={categoryId} className="text-sm text-slate-700">
                    {allowanceLeadHe({
                      categoryId,
                      projectedText: formatILS(row === undefined ? null : row.projectedILS),
                      rankWord: ALLOWANCE_RANK_WORDS_HE[Math.min(index, ALLOWANCE_LEAD_MAX - 1)],
                      isLargest: index === 0,
                    })}
                  </li>
                );
              })}
            </ul>
            <ul className="mt-3 space-y-1" data-testid="screen.forecast.allowanceTable">
              {allowance.rows.map((row) => (
                <li key={row.categoryId} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                  <span>{row.categoryId}</span>
                  <span className="tabular-nums">
                    {formatILS(row.allowanceILS)}
                    <Explain id="forecast.categoryAllowance" />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">{ALLOWANCE_OTHER_LEVERS_HE}</p>
          </>
        )}
        {/* !! THE PAIRING RULE, SATISFIED HERE FOR THE FIRST TIME IN THE APP.
            `adviceBoundary.test.ts` pins the set of modules reaching for `allowanceLeadHe` and
            requires each to reach for `ADVICE_BOUNDARY_NOTICE_HE` too. Until this file that set was
            EXACTLY EMPTY — the guard was true on an empty set and said so in its own comment. This
            is the first screen to fail that line, and it is the reason the notice is rendered
            unconditionally inside this section rather than beside one branch of it. */}
        <p data-testid="screen.forecast.adviceBoundary" className="mt-4 text-xs text-slate-500 border-t border-slate-100 pt-3">
          {ADVICE_BOUNDARY_NOTICE_HE}
        </p>
      </Section>

      {/* ── D28 — calibration ships as plumbing and says so ──────────────────────────────── */}
      <Section title={FORECAST_CALIBRATION_TITLE_HE} testId="screen.forecast.calibration">
        <p className="text-sm text-slate-500">{CALIBRATION_NOT_ENOUGH_TIME_HE}</p>
      </Section>
    </div>
  );
}
