// src/__tests__/ForecastScreen.test.tsx — Stage 7 T7b. The full screen.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS SUITE CAN AND CANNOT ESTABLISH — SAID FIRST, BECAUSE IT BOUNDS EVERY LINE BELOW
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// There is NO browser and NO screenshot tooling in this project. Everything here is an assertion
// about props, DOM order and rendered text. It can prove that `<XAxis reversed />` is what the
// chart library is handed; it CANNOT prove that a Hebrew reader's eye lands on September first.
// D38–D42 were settled on paper precisely because that second question has no mechanical answer
// here — and this is the task where the most drawing happens, so the bound is worth restating.
//
// The SHAPE decisions (which segment exists, what the axis may see, which chip a month carries)
// are pure functions with their own table-driven suite in `forecastView.test.ts`. This file checks
// that the screen draws what those functions produce, and that the copy and the `<Explain>`
// triggers arrive with the figures they belong to.
//
// ── WHY `useForecast` IS STUBBED HERE ─────────────────────────────────────────────────────────
//
// The hook has its own suite (`useForecast.test.tsx`) driven through injected readers. Re-driving
// it through this file would make every screen assertion depend on eight fetches, and a screen test
// that fails because a reader changed is a test that stops being read. The PURE exports of the same
// module — `resolveForecastScopes`, `narrowForecastScopesToMember`, `forecastCardScopeOf` — are
// kept REAL via `importActual`, because the מי decision is a screen-level behaviour and stubbing it
// would test the stub.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationProvider } from '../contexts/NotificationContext';
import { NavigationProvider } from '../contexts/NavigationContext';
import { FilterProvider, useGlobalFilters } from '../contexts/FilterContext';

const H = vi.hoisted(() => ({
  forecastValue: null as unknown,
  chartProps: [] as Array<{ name: string; props: Record<string, unknown> }>,
  mockSave: vi.fn(async () => ({}) as never),
  mockUseForecast: vi.fn(),
  mockNavigateTo: vi.fn(),
}));

vi.mock('../hooks/useFamilyMembers', () => ({
  useFamilyMembers: () => ({
    status: 'ready',
    members: [
      { id: 'david', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], createdAt: 'x', updatedAt: 'x' },
      { id: 'omer', name: 'עומר', role: 'ילד', color: '#E07A5F', groups: [], createdAt: 'x', updatedAt: 'x' },
    ],
    error: null,
  }),
}));
vi.mock('../hooks/useGroups', () => ({ useGroups: () => ({ status: 'ready', groups: [], error: null }) }));
// F5 — `navigateTo` is observed rather than followed. The claim under test is WHAT THE GAP LINK
// SENDS, and the destination screens have their own suites for what they do with it; re-driving
// `AccountsScreen` from here would make a forecast assertion depend on an accounts form.
vi.mock('../contexts/NavigationContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contexts/NavigationContext')>();
  return { ...actual, useNavigation: () => ({ ...actual.useNavigation(), navigateTo: H.mockNavigateTo }) };
});
vi.mock('../services/ForecastAssumptionsService', () => ({
  saveForecastAssumption: H.mockSave,
  listForecastAssumptions: vi.fn(async () => []),
}));

// The chart library, stubbed so the D42 claims are checked as PROPS ACTUALLY PASSED rather than as
// a source-text grep. `ResponsiveContainer` measures 0×0 in jsdom and renders nothing at all, so a
// real recharts here would assert nothing while looking as though it did.
vi.mock('recharts', () => {
  const record = (name: string) => {
    const Stub = (props: Record<string, unknown>): React.JSX.Element => {
      H.chartProps.push({ name, props });
      return <div data-testid={`recharts.${name}`}>{props.children as React.ReactNode}</div>;
    };
    return Stub;
  };
  return {
    BarChart: record('BarChart'),
    Bar: record('Bar'),
    XAxis: record('XAxis'),
    YAxis: record('YAxis'),
    CartesianGrid: record('CartesianGrid'),
    Tooltip: record('Tooltip'),
    ErrorBar: record('ErrorBar'),
    ResponsiveContainer: record('ResponsiveContainer'),
  };
});

vi.mock('../hooks/useForecast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useForecast')>();
  return { ...actual, useForecast: H.mockUseForecast };
});

import ForecastScreen from '../components/ForecastScreen';
import type { UseForecastResult } from '../hooks/useForecast';
import type { ForecastLineItem, ForecastResult } from '../utils/forecast';
import {
  CALIBRATION_NOT_ENOUGH_TIME_HE,
  FORECAST_CATEGORY_FILTER_NOTE_HE,
  FORECAST_FAMILY_SCOPE_NOTE_HE,
  FORECAST_NO_VARIABLE_SPEND_HE,
  FORECAST_ONBOARDING_TITLE_HE,
  INSTALMENT_DOUBLE_COUNT_HE,
  LOAN_INSURANCE_DOUBLE_COUNT_HE,
  MONTH_CONFIDENCE_LABEL_HE,
  STATISTICAL_GAP_REASON_HE,
  forecastAxisMaxHe,
  forecastBalanceLabelHe,
} from '../utils/forecastCopy';
import { ADVICE_BOUNDARY_NOTICE_HE } from '../config/adviceBoundary';
import { OPEN_CREATE_PAYLOAD } from '../utils/navigationPayload';
import { seasonalityScopeId } from '../utils/seasonality';
import { MONTH_KEY_APRIL, MONTH_KEY_SEPTEMBER, hebrewNameOfMonthKey } from '../config/hebrewMonths';
import { monthKeyOf } from '../utils/periodMath';
// The offers' own categories, READ from the map rather than spelled — a category name typed into a
// test is the same second copy `SEASONALITY_OFFERS` itself avoids.
import { CATEGORY_MAP } from '../utils/categoryMap';

const HORIZON = ['2026-09', '2026-10', '2026-11'];

function certain(period: string, amountILS: number, over: Partial<ForecastLineItem> = {}): ForecastLineItem {
  return {
    period,
    categoryId: 'החזרי הלוואות',
    direction: 'expense',
    amountILS,
    basis: { kind: 'loan', loanId: 'l1', name: 'משכנתא' },
    ...over,
  };
}

function estimated(period: string, amountILS: number, band: { lowILS: number; midILS: number; highILS: number } | null = null, monthsObserved = 4): ForecastLineItem {
  return {
    period,
    categoryId: 'מזון',
    direction: 'expense',
    amountILS,
    basis: {
      kind: 'movingAverage',
      monthsObserved,
      periods: [],
      seasonalFactor: null,
      band,
      bandBasis: band === null ? 'insufficient-history' : 'observed-range',
    },
  };
}

function forecastResult(over: Partial<ForecastResult> = {}): ForecastResult {
  return {
    anchorPeriod: '2026-09',
    anchorClamped: false,
    horizon: HORIZON,
    lineItems: [],
    byPeriod: HORIZON.map((period) => ({
      period,
      certainILS: 0,
      statisticalILS: 0,
      assumptionILS: 0,
      incomeILS: 0,
      expenseILS: 0,
    })),
    ...over,
  };
}

function forecast(over: Partial<UseForecastResult> = {}): UseForecastResult {
  return {
    inputs: {} as UseForecastResult['inputs'],
    result: forecastResult(),
    statisticalLayer: null,
    openingBalance: null,
    projectedBalanceILS: 12400,
    projectedIncomeILS: 48000,
    projectedExpenseILS: 35600,
    committedILS: 8900,
    suppressed: [],
    suppressedOutflow: [],
    target: null,
    historyRefusalHe: null,
    unusableRowCount: 0,
    assumptions: [],
    status: 'ready',
    reload: vi.fn(),
    ...over,
  };
}

const PROPS = {
  session: { memberId: 'david', role: 'super-admin' as const },
  accountsViewLevel: 'family' as const,
  loansViewLevel: 'family' as const,
  expensesViewLevel: 'family' as const,
  recurringViewLevel: 'family' as const,
  insurancesViewLevel: 'family' as const,
  incomeViewLevel: 'family' as const,
  goalsViewLevel: 'family' as const,
  forecastViewLevel: 'family' as const,
};

let filtersApi: ReturnType<typeof useGlobalFilters> | null = null;
function FiltersHandle(): null {
  filtersApi = useGlobalFilters();
  return null;
}

function renderScreen(value: UseForecastResult = forecast()): void {
  H.mockUseForecast.mockReturnValue(value);
  render(
    <NotificationProvider>
      <NavigationProvider>
        <FilterProvider>
          <FiltersHandle />
          <ForecastScreen {...PROPS} />
        </FilterProvider>
      </NavigationProvider>
    </NotificationProvider>
  );
}

/** The props the stub recorded for one recharts element, from the most recent render. */
function chartPropsOf(name: string): Record<string, unknown> {
  const entries = H.chartProps.filter((e) => e.name === name);
  expect(entries.length, `no <${name}> rendered`).toBeGreaterThan(0);
  return entries[entries.length - 1].props;
}

beforeEach(() => {
  sessionStorage.clear();
  H.chartProps = [];
  H.mockSave.mockClear();
  H.mockUseForecast.mockReset();
  H.mockNavigateTo.mockClear();
  filtersApi = null;
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE FOUR STATES, AND THE ORDER THEY ARE READ IN
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the shell branches on `status` FIRST, whatever the eight per-input states say', () => {
  it('renders the loading state even when every input reports a fault', () => {
    // `LOADING_STATUS` used to be `{state: 'error'}` — every input claimed a fault during a load,
    // and the card was saved only by happening to branch on the scalar first. T7a's review made
    // `'unresolved'` its own state so the trap is gone rather than documented; this screen keeps
    // the order anyway, and this test is what holds it rather than the comment that says so.
    renderScreen(forecast({ status: 'loading', result: null }));
    expect(screen.getByTestId('screen.forecast.loading')).toBeTruthy();
  });

  it('a failed computation renders an ERROR, never an empty screen', () => {
    renderScreen(forecast({ status: 'error', result: null }));
    expect(screen.getByTestId('screen.forecast.error')).toBeTruthy();
  });

  it('a wholly denied read renders a CALM refusal, not the red error register', () => {
    renderScreen(forecast({ status: 'permission-denied', result: null }));
    const denied = screen.getByTestId('screen.forecast.denied');
    expect(denied.className).not.toContain('bg-red');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D26 — ₪0 NEVER MEANS "UNKNOWN", AND THE EMPTY STATE IS A PATH
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D26 — the empty state is a PATH, and the glance holds a COUNT rather than ₪0', () => {
  it('!! holds the count for T0`s MEASURED ledger, which is SIX — history is the sixth gap', () => {
    // !! THE NUMBER NAMES ITS CORPUS NOW (T7b-review F6). D26's text illustrates with 3; that
    // travelled into a test title, into the ledger, was corrected to 5 — and 5 is the figure AFTER
    // the T3 backfill. T0 measured no `settings/migrationState`, `loadStatisticalHistory` refuses
    // without a complete marker, and `history` is therefore suppressed too. Six.
    //
    // The screen renders `suppressed.length`, so it holds whatever the hook hands it; the
    // arithmetic behind these two corpora is `forecastInputs.test.ts`'s, where both are asserted
    // against `suppressedBalanceInputs` itself. What is checked HERE is that the glance renders the
    // count it is given and never a shekel figure.
    renderScreen(
      forecast({
        projectedBalanceILS: null,
        suppressed: ['accounts', 'incomes', 'recurring', 'loans', 'insurances', 'history'],
      })
    );
    expect(screen.getByTestId('screen.forecast.gapCount').textContent).toBe('6');
    expect(screen.getByTestId('screen.forecast.headline').textContent).toContain(FORECAST_ONBOARDING_TITLE_HE);
    // ₪0 is nowhere near the glance position.
    expect(screen.getByTestId('screen.forecast.gapCount').textContent).not.toContain('₪');
  });

  it('…and FIVE once the backfill has run — the same screen, the other ledger', () => {
    // The pair is the point: one number that changes with the corpus is not a property of the
    // screen, and a single test asserting one of them reads as though it were.
    renderScreen(
      forecast({
        projectedBalanceILS: null,
        suppressed: ['accounts', 'incomes', 'recurring', 'loans', 'insurances'],
      })
    );
    expect(screen.getByTestId('screen.forecast.gapCount').textContent).toBe('5');
  });

  it('!! every named gap DEEP-LINKS to the form that fills it — except the one with no screen', () => {
    renderScreen(
      forecast({ projectedBalanceILS: null, suppressed: ['accounts', 'incomes', 'history'] })
    );
    expect(screen.getByTestId('screen.forecast.gapLink.accounts')).toBeTruthy();
    expect(screen.getByTestId('screen.forecast.gapLink.history')).toBeTruthy();
    // `incomes` has no tab in `MODULE_REGISTRY` (finding 1.3.11), so it gets a NOTE saying where to
    // go rather than a link that goes nowhere. A dead link is worse than no link.
    expect(screen.queryByTestId('screen.forecast.gapLink.incomes')).toBeNull();
    expect(screen.getByTestId('screen.forecast.gapNote.incomes')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D42 — THE TIME AXIS
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D42 — the axis flips and the box does not', () => {
  it('passes `reversed` to the time axis and puts the value scale on the right', () => {
    renderScreen();
    expect(chartPropsOf('XAxis').reversed).toBe(true);
    expect(chartPropsOf('YAxis').orientation).toBe('right');
  });

  it('!! the CONTAINER stays `dir="ltr"`, with the reason recorded beside it', () => {
    // Recharts' internal layout math assumes LTR and flipping the container is what makes labels
    // drift. The existing category-bar precedent is right about WHY it exists and wrong to apply
    // its unreversed axis to a time series — both halves are held here.
    renderScreen();
    expect(screen.getByTestId('screen.forecast.chart').getAttribute('dir')).toBe('ltr');
  });

  it('the NEAREST month is the first data point in DOM order', () => {
    renderScreen();
    const data = chartPropsOf('BarChart').data as Array<{ period: string }>;
    expect(data.map((row) => row.period)).toEqual(HORIZON);
  });

  it('the existing CATEGORY charts are not touched — they have no reading-direction semantics', () => {
    // Asserted against the Dashboard's own source rather than restated, so the claim moves with the
    // file. `reversed` must not appear on a category axis.
    const dashboard = readFileSyncCached('components/Dashboard.tsx');
    expect(dashboard).not.toMatch(/<XAxis[^>]*reversed/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D39 / D40 — WHAT THE MONTH LIST SAYS, WHICH IS THE CHART'S ACCESSIBLE FORM
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D39/D40 — the split, the gap and the chips reach the DOM as text', () => {
  it('!! a GAP month names the missing history and never renders ₪0 for the estimate', () => {
    const value = forecast({
      statisticalLayer: {
        status: 'ready',
        reasonHe: '',
        lineItems: [],
        categories: [],
        rowsRead: 0,
        rowsCounted: 0,
        weakestMonthsObserved: 0,
        markerCompletedAt: 'x',
        markerSourceCommit: 'y',
      },
      result: forecastResult({
        lineItems: HORIZON.map((p) => certain(p, 4200)),
        byPeriod: HORIZON.map((period) => ({
          period,
          certainILS: 4200,
          statisticalILS: 0,
          assumptionILS: 0,
          incomeILS: 0,
          expenseILS: 4200,
        })),
      }),
    });
    renderScreen(value);
    const row = screen.getByTestId('screen.forecast.month.2026-09');
    expect(screen.getByTestId('screen.forecast.month.2026-09.gap')).toBeTruthy();
    expect(screen.queryByTestId('screen.forecast.month.2026-09.estimated')).toBeNull();
    // The accessible name is the SENTENCE, not a texture and not a zero.
    expect(row.getAttribute('aria-label')).toContain(STATISTICAL_GAP_REASON_HE['no-history']);
    expect(row.getAttribute('aria-label')).not.toContain('₪0.00');
  });

  it('!! the GAP MARKER is the same size on every gap month — it reports nothing about the month', () => {
    renderScreen(
      forecast({
        statisticalLayer: {
          status: 'ready', reasonHe: '', lineItems: [], categories: [], rowsRead: 0, rowsCounted: 0,
          weakestMonthsObserved: 0, markerCompletedAt: 'x', markerSourceCommit: 'y',
        },
        result: forecastResult({
          byPeriod: [
            { period: '2026-09', certainILS: 4200, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 4200 },
            { period: '2026-10', certainILS: 1000, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 1000 },
            { period: '2026-11', certainILS: 900, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 900 },
          ],
        }),
      })
    );
    const data = chartPropsOf('BarChart').data as Array<{ gapMarker: number; gap: boolean }>;
    expect(data.every((row) => row.gap)).toBe(true);
    expect(new Set(data.map((row) => row.gapMarker)).size).toBe(1);
    // …and it is nowhere near the tallest column, so it cannot be read against the scale.
    expect(data[0].gapMarker).toBeLessThan(4200);
  });

  it('a month WITH history carries its split, its band and its confidence chip', () => {
    renderScreen(
      forecast({
        statisticalLayer: {
          status: 'ready', reasonHe: '', lineItems: [], categories: [], rowsRead: 10, rowsCounted: 10,
          weakestMonthsObserved: 4, markerCompletedAt: 'x', markerSourceCommit: 'y',
        },
        result: forecastResult({
          lineItems: [certain('2026-09', 4200), estimated('2026-09', 2900, { lowILS: 2000, midILS: 2900, highILS: 4100 })],
          byPeriod: [
            { period: '2026-09', certainILS: 4200, statisticalILS: 2900, assumptionILS: 0, incomeILS: 0, expenseILS: 7100 },
            { period: '2026-10', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
            { period: '2026-11', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
          ],
        }),
      })
    );
    const row = screen.getByTestId('screen.forecast.month.2026-09');
    expect(row.textContent).toContain('4,200');
    expect(row.textContent).toContain('2,900');
    expect(screen.getByTestId('screen.forecast.month.2026-09.band').textContent).toContain('4,100');
    expect(screen.getByTestId('screen.forecast.month.2026-09.confidence').textContent).toContain(
      MONTH_CONFIDENCE_LABEL_HE['well-based']
    );
    expect(row.getAttribute('aria-label')).toContain('7,100');
  });

  it('!! BELOW n=3 the per-bar DEPTH CHIP appears and the band does not — a chip, not a paragraph', () => {
    renderScreen(
      forecast({
        statisticalLayer: {
          status: 'ready', reasonHe: '', lineItems: [], categories: [], rowsRead: 4, rowsCounted: 4,
          weakestMonthsObserved: 2, markerCompletedAt: 'x', markerSourceCommit: 'y',
        },
        result: forecastResult({
          lineItems: [certain('2026-09', 1000), estimated('2026-09', 500, null, 2)],
          byPeriod: [
            { period: '2026-09', certainILS: 1000, statisticalILS: 500, assumptionILS: 0, incomeILS: 0, expenseILS: 1500 },
            { period: '2026-10', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
            { period: '2026-11', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
          ],
        }),
      })
    );
    expect(screen.getByTestId('screen.forecast.month.2026-09.depth').textContent).toContain('חודשיים');
    expect(screen.queryByTestId('screen.forecast.month.2026-09.band')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE TWO DOUBLE COUNTS, AND THE INERT OFFER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D23 — both double counts are DISCLOSED, and they are different disclosures', () => {
  it('the loan/insurance one appears with a contractual row and names its direction', () => {
    renderScreen(
      forecast({ result: forecastResult({ lineItems: [certain('2026-09', 4200)] }) })
    );
    expect(screen.getByTestId('screen.forecast.doubleCount').textContent).toContain(
      LOAN_INSURANCE_DOUBLE_COUNT_HE
    );
    // The INSTALMENT one is a different sentence about a different mechanism and is absent when
    // there is no instalment plan — a caveat about something the screen is not showing is noise.
    expect(screen.queryByTestId('screen.forecast.instalmentDoubleCount')).toBeNull();
  });

  it('!! the INSTALMENT one appears with an instalment row, and says the estimate runs HIGH', () => {
    // D23 rules only on `recurringId`, so a plan's already-charged rows stay inside the moving
    // average while the projector projects the ones still to come. Unlike the loan case this one
    // HAS a discriminator, so it is a smaller and different problem — disclosed here, not fixed
    // outside its ruling.
    renderScreen(
      forecast({
        result: forecastResult({
          lineItems: [
            certain('2026-09', 250, {
              categoryId: 'קניות',
              basis: { kind: 'installment', planKey: 'k', observedNumber: 3, totalInstallments: 12 },
            }),
          ],
        }),
      })
    );
    const disclosure = screen.getByTestId('screen.forecast.instalmentDoubleCount');
    expect(disclosure.textContent).toContain(INSTALMENT_DOUBLE_COUNT_HE);
    expect(INSTALMENT_DOUBLE_COUNT_HE).toContain('גבוהה');
    // D10's `planKey` heuristic gets its own sentence beside it, because it is a SECOND way the
    // instalment figure can be wrong and it is knowably wrong rather than merely uncertain.
    expect(screen.getByTestId('screen.forecast.planKey').textContent).toContain('בית העסק');
  });
});

describe('!! the September seasonality offer is INERT, and the accept surface says so', () => {
  it('!! the INERT one and the LIVE one are told apart, on the same corpus, in the same render', () => {
    // MEASURED, not assumed: the T6 review drove an accepted offer end to end and found the
    // SEPTEMBER one moves not one line item, because its category is the education category and
    // n = 0 by construction, while the APRIL one moves a real number by its stored factor. The
    // offer is NOT withdrawn — a family with no education spend today may have it in September —
    // but the surface says outright that nothing here will move.
    //
    // Both halves are asserted in ONE render, because "the inert one says it is inert" is only
    // meaningful beside "the live one does not". A fixture where everything is inert would pass
    // with a component that always prints the inert sentence.
    renderScreen(
      forecast({
        statisticalLayer: {
          status: 'ready',
          reasonHe: '',
          lineItems: [],
          // The GROCERIES category has an estimate; the EDUCATION category has none.
          categories: [
            {
              status: 'estimated',
              categoryId: CATEGORY_MAP.Groceries_Dining,
              monthsObserved: 4,
              periods: [],
              monthlyTotalsILS: [],
              estimateILS: 2000,
              band: null,
              bandBasis: 'observed-range',
            },
          ],
          rowsRead: 10,
          rowsCounted: 10,
          weakestMonthsObserved: 4,
          markerCompletedAt: 'x',
          markerSourceCommit: 'y',
        },
      })
    );
    const effects = screen
      .getAllByTestId(/^screen\.forecast\.offer\..*\.effect$/)
      .map((el) => el.textContent ?? '');
    expect(effects).toHaveLength(2);
    expect(effects.filter((text) => text.includes('לא ישנה אף מספר'))).toHaveLength(1);
    expect(effects.filter((text) => text.includes('אישור ההתאמה יקבע'))).toHaveLength(1);
    // …and the inert one is the EDUCATION one specifically, named rather than inferred from order.
    const inert = effects.find((text) => text.includes('לא ישנה אף מספר')) ?? '';
    expect(inert).toContain(CATEGORY_MAP.Education);
  });

  it('!! D35 — accepting writes the assumption and RELOADS the computation', () => {
    const reload = vi.fn();
    renderScreen(forecast({ reload }));
    const accept = screen.getAllByTestId(/^screen\.forecast\.offer\..*\.accept$/)[0];
    fireEvent.click(accept);
    return waitFor(() => {
      expect(H.mockSave).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE PAIRING RULE, AND THE REST OF THE SCREEN
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the override disclosure — the number that goes DOWN, and why that is not a bug', () => {
  it('names what was displaced when an assumption beats a CONTRACTUAL item', () => {
    // An assumption that displaces a contractual item removes it from `certainILS`, so
    // `מזה כבר סגור` reports LESS after the override than before it. That is pinned, correct, and
    // reads as a defect on sight — so the sentence names the mechanism beside the figure.
    renderScreen(
      forecast({
        result: forecastResult({
          lineItems: [
            {
              period: '2026-09',
              categoryId: 'שכר דירה',
              direction: 'expense',
              amountILS: 6000,
              basis: {
                kind: 'assumption',
                assumptionId: 'a1',
                source: 'user',
                updatedAt: '2026-08-01T00:00:00.000Z',
                overrides: [{ kind: 'loan', loanId: 'l1', name: 'משכנתא' }],
              },
            },
          ],
        }),
      })
    );
    const list = screen.getByTestId('screen.forecast.assumptionList');
    // NAMED, not priced: `ForecastBasis` carries no amount, so the previous FIGURE is not reachable
    // from what the screen is handed. D19 asks for both; only one is buildable, and rendering `₪—`
    // for the other would put a missing number where the sentence promises a real one.
    expect(list.textContent).toContain('משכנתא');
    expect(list.textContent).toContain('הסכום שכבר סגור קטן יותר');
    expect(list.textContent).not.toContain('₪—');
  });

  it('an assumption over a STATISTICAL item gets the QUIETER line — D19`s two disclosures', () => {
    renderScreen(
      forecast({
        result: forecastResult({
          lineItems: [
            {
              period: '2026-09',
              categoryId: 'מזון',
              direction: 'expense',
              amountILS: 2000,
              basis: {
                kind: 'assumption',
                assumptionId: 'a2',
                source: 'user',
                updatedAt: '2026-08-01T00:00:00.000Z',
                overrides: [],
              },
            },
          ],
        }),
      })
    );
    const list = screen.getByTestId('screen.forecast.assumptionList');
    expect(list.textContent).toContain('במקום ההערכה מההיסטוריה');
    expect(list.textContent).not.toContain('הסכום שכבר סגור קטן יותר');
  });
});

describe('!! D29 — a category the family marked FIXED is not offered as something to cut', () => {
  it('!! the allowance pool reads the family`s OWN assumptions, not an empty array', () => {
    // THE FIFTH MUTATION SURVIVOR, and the mutant is one character of intent: passing `[]` to
    // `flexibleCategoryIds` compiles, runs, and offers a category the family has already said is
    // fixed. It survived because nothing rendered a `flexible: false` assumption — a guard with an
    // empty corpus, wearing the name of one that works.
    renderScreen(
      forecast({
        projectedIncomeILS: 1000,
        projectedExpenseILS: 900,
        target: {
          status: 'target',
          source: 'goal',
          amountILS: 500,
          isFamilyScoped: true,
          goalsExcludedCount: 0,
          beyondHorizonCount: 0,
        },
        assumptions: [
          {
            id: 'a1',
            ownerId: 'david',
            createdAt: 'x',
            updatedAt: 'x',
            scopeKind: 'category',
            scopeId: 'מזון',
            fromPeriod: '2026-09',
            toPeriod: '2026-12',
            amountILS: 0,
            flexible: false,
            reasonHe: 'שכר דירה קבוע',
            source: 'user',
            status: 'active',
          },
        ],
        result: forecastResult({
          lineItems: [
            estimated('2026-09', 300),
            { ...estimated('2026-09', 3000), categoryId: 'תחבורה' },
          ],
        }),
      })
    );
    const table = screen.getByTestId('screen.forecast.allowanceTable');
    expect(table.textContent).toContain('תחבורה');
    expect(table.textContent).not.toContain('מזון');
  });
});

describe('!! the advice-boundary notice is on the screen that gives advice', () => {
  it('renders unconditionally inside the allowance section, not beside one branch of it', () => {
    renderScreen();
    expect(screen.getByTestId('screen.forecast.adviceBoundary').textContent).toBe(
      ADVICE_BOUNDARY_NOTICE_HE
    );
  });
});

describe('D28 — calibration ships as plumbing and the screen says the number cannot exist yet', () => {
  it('renders the not-enough-time state rather than a zero error rate', () => {
    renderScreen();
    expect(screen.getByTestId('screen.forecast.calibration').textContent).toContain(
      CALIBRATION_NOT_ENOUGH_TIME_HE
    );
  });
});

describe('D32 — the horizon is a forecast-LOCAL control', () => {
  it('offers 3/6/12 and marks the current one, defaulting to 3', () => {
    renderScreen();
    expect(screen.getByTestId('screen.forecast.horizon.3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('screen.forecast.horizon.6')).toBeTruthy();
    expect(screen.getByTestId('screen.forecast.horizon.12')).toBeTruthy();
  });

  it('!! is NOT persisted into the global filter state — one screen`s dimension stays there', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('screen.forecast.horizon.6'));
    const persisted = sessionStorage.getItem('ff_global_filters') ?? '';
    expect(persisted).not.toContain('horizon');
  });
});

describe('!! the מי decision, at the screen', () => {
  it('narrows the whole computation to a single selected member and SAYS whose it is', async () => {
    renderScreen();
    expect(screen.queryByTestId('screen.forecast.memberScope')).toBeNull();
    filtersApi!.setMemberSelection({ mode: 'members', memberIds: ['omer'], groupId: null });
    await waitFor(() => expect(screen.getByTestId('screen.forecast.memberScope')).toBeTruthy());
    expect(screen.getByTestId('screen.forecast.memberScope').textContent).toContain('עומר');
    // …and the hook was re-driven with that member as the TARGET and every scope collapsed to
    // `'own'` — the net-worth shape, not a re-slice of a sealed corpus.
    const lastCall = H.mockUseForecast.mock.calls[H.mockUseForecast.mock.calls.length - 1][0];
    expect(lastCall.viewerMemberId).toBe('omer');
    expect(Object.values(lastCall.scopes).every((s) => s === 'own')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — F1. AN ACCEPTED OFFER IS NOT OFFERED AGAIN
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F1 — the seasonality taken-filter is REAL, not a permanent no-op', () => {
  it('!! withdraws an offer whose scope the family already holds, and keeps the other one', () => {
    // THE DEFECT: `existing: []` was hardcoded at the call site, so
    // `offeredSeasonalityAssumptions`' taken-filter — a function with its own tests, which pass —
    // could never remove anything. An accepted September factor came back on the next render and
    // on every render after it, and accepting twice writes a SECOND assumption on ONE scope, which
    // is the state D20's tiebreak exists in order never to have to adjudicate.
    //
    // Same class as M40, in the same file and the same commit: the correct corpus was in scope
    // TWELVE LINES ABOVE and an empty literal was passed instead. And the fix left the whole suite
    // at baseline with zero failures — nothing in 2,607 tests could tell correct from broken. This
    // is what tells them apart.
    //
    // BOTH DIRECTIONS IN ONE RENDER: the September scope is taken and the April one is not, so a
    // component that filtered EVERYTHING (or nothing) fails. `scopeId` is built with the same
    // helper the offers are built with, never spelled — a scope id typed into a test is a second
    // copy of the thing under test.
    const takenScopeId = seasonalityScopeId(CATEGORY_MAP.Education, MONTH_KEY_SEPTEMBER);
    const untakenScopeId = seasonalityScopeId(CATEGORY_MAP.Groceries_Dining, MONTH_KEY_APRIL);
    renderScreen(
      forecast({
        assumptions: [
          {
            id: 'a-sep',
            // OWNED BY SOMEBODY ELSE ON PURPOSE. `offeredSeasonalityAssumptions` checks `scopeId`
            // alone — a factor Lilit accepted is a fact about the family's September, not about
            // Lilit — and re-offering David his own copy would put two assumptions on one scope.
            ownerId: 'lilit',
            createdAt: 'x',
            updatedAt: 'x',
            scopeKind: 'seasonality',
            scopeId: takenScopeId,
            fromPeriod: '2026-09',
            amountILS: 0,
            factor: 1.3,
            reasonHe: 'תחילת שנת הלימודים',
            source: 'user',
            status: 'active',
          },
        ],
      })
    );
    const offered = screen
      .getAllByTestId(/^screen\.forecast\.offer\..*\.accept$/)
      .map((el) => el.getAttribute('data-testid'));
    expect(offered).toEqual([`screen.forecast.offer.${untakenScopeId}.accept`]);
    expect(screen.queryByTestId(`screen.forecast.offer.${takenScopeId}.accept`)).toBeNull();
  });

  it('!! a RETIRED assumption still counts as taken — a decision the family already made', () => {
    // The filter reads `scopeId` and not `status`, deliberately: re-offering a suggestion somebody
    // has already said no to is the pile A31's "one-click" is the opposite of. Held here because
    // `status: 'retired'` is a value no other test on this screen produces.
    renderScreen(
      forecast({
        assumptions: [
          {
            id: 'a-apr',
            ownerId: 'david',
            createdAt: 'x',
            updatedAt: 'x',
            scopeKind: 'seasonality',
            scopeId: seasonalityScopeId(CATEGORY_MAP.Groceries_Dining, MONTH_KEY_APRIL),
            fromPeriod: '2026-09',
            amountILS: 0,
            factor: 1.3,
            reasonHe: 'חגי האביב',
            source: 'user',
            status: 'retired',
          },
        ],
      })
    );
    expect(screen.getAllByTestId(/^screen\.forecast\.offer\..*\.accept$/)).toHaveLength(1);
  });

  it('a NON-seasonality assumption on the same category does NOT withdraw the offer', () => {
    // `scopeKind` is filtered first. A `category` assumption on the education category is a
    // different statement about a different thing, and treating it as a taken seasonal scope would
    // silently withdraw a true seasonal fact.
    renderScreen(
      forecast({
        assumptions: [
          {
            id: 'a-cat',
            ownerId: 'david',
            createdAt: 'x',
            updatedAt: 'x',
            scopeKind: 'category',
            scopeId: seasonalityScopeId(CATEGORY_MAP.Education, MONTH_KEY_SEPTEMBER),
            fromPeriod: '2026-09',
            amountILS: 500,
            reasonHe: 'סכום קבוע',
            source: 'user',
            status: 'active',
          },
        ],
      })
    );
    expect(screen.getAllByTestId(/^screen\.forecast\.offer\..*\.accept$/)).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — THE REVIEWER'S TWO REPORTS DISAGREED. THIS IS THE REPRODUCTION, KEPT.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the DAY-ONE headline renders NO shekel figure at all — the claim, reproduced', () => {
  it('!! no `₪` anywhere in the headline, and the balance label is not on the screen', () => {
    // ONE OF THE TWO T7b REVIEW REPORTS CLAIMED this screen renders `₪0` under
    // `צפוי להישאר בסוף …` on the day-one corpus, "because the headline formats `balanceILS ?? 0`
    // before branching". It does not, and no such code has ever existed in this repository. The
    // headline branches on `balance === null || verdict === null` FIRST and the label builder is
    // only reachable inside the other arm. This test is that reproduction, kept as a regression:
    // the claimed defect is the single worst thing this screen could do — D26 exists to prevent
    // exactly it — so it is worth a test whether or not anybody ever wrote the bug.
    renderScreen(
      forecast({
        projectedBalanceILS: null,
        projectedIncomeILS: null,
        projectedExpenseILS: null,
        committedILS: 0,
        suppressed: ['accounts', 'incomes', 'recurring', 'loans', 'insurances'],
      })
    );
    const headline = screen.getByTestId('screen.forecast.headline');
    expect(headline.textContent).not.toContain('₪');
    expect(headline.textContent).not.toContain(forecastBalanceLabelHe(monthName('2026-11')));
    expect(screen.queryByTestId('screen.forecast.balance')).toBeNull();
    expect(screen.queryByTestId('screen.forecast.verdict')).toBeNull();
  });

  it('a real balance DOES render the label and the figure — so the check above is not vacuous', () => {
    renderScreen(forecast({ projectedBalanceILS: 12400 }));
    const headline = screen.getByTestId('screen.forecast.headline');
    expect(headline.textContent).toContain(forecastBalanceLabelHe(monthName('2026-11')));
    expect(screen.getByTestId('screen.forecast.balance').textContent).toContain('12,400');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — F3. A SELECTION THAT DID NOT NARROW, SAID OUT LOUD
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F3 — two members or a group yields the FAMILY forecast, and the screen says so', () => {
  it('!! TWO members selected: the family-scope note renders and the single-member one does not', async () => {
    // The Dashboard's filter bar renders `2 נבחרו` while this screen computes the whole family's
    // forecast. That is the misread D38 spends three signals on, one dimension over — and until
    // this note the screen was SILENT about it, which is worse than a wrong label because there is
    // nothing for the reader to disbelieve.
    renderScreen();
    expect(screen.queryByTestId('screen.forecast.familyScope')).toBeNull();
    filtersApi!.setMemberSelection({ mode: 'members', memberIds: ['david', 'omer'], groupId: null });
    await waitFor(() => expect(screen.getByTestId('screen.forecast.familyScope')).toBeTruthy());
    expect(screen.getByTestId('screen.forecast.familyScope').textContent).toBe(
      FORECAST_FAMILY_SCOPE_NOTE_HE
    );
    expect(screen.queryByTestId('screen.forecast.memberScope')).toBeNull();
    // …and the computation really is the family's: the hook was NOT re-targeted at either member.
    const lastCall = H.mockUseForecast.mock.calls[H.mockUseForecast.mock.calls.length - 1][0];
    expect(lastCall.viewerMemberId).toBe('david');
    expect(Object.values(lastCall.scopes).some((s) => s === 'family')).toBe(true);
  });

  it('!! a GROUP selected gets the same note — the other fall-through, not a different one', async () => {
    renderScreen();
    filtersApi!.setMemberSelection({ mode: 'group', memberIds: [], groupId: 'parents' });
    await waitFor(() => expect(screen.getByTestId('screen.forecast.familyScope')).toBeTruthy());
    expect(screen.queryByTestId('screen.forecast.memberScope')).toBeNull();
  });

  it('!! ONE member selected gets the member note and NOT the family one — the two never co-render', async () => {
    // The pair is the assertion. Two notes at once says both things about one screen, and neither
    // note alone can prove the other is absent.
    renderScreen();
    filtersApi!.setMemberSelection({ mode: 'members', memberIds: ['omer'], groupId: null });
    await waitFor(() => expect(screen.getByTestId('screen.forecast.memberScope')).toBeTruthy());
    expect(screen.queryByTestId('screen.forecast.familyScope')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — F4. מה NARROWS THE CATEGORY LIST, AND NOW SOMETHING SETS ONE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F4 — a מה selection narrows the category list ONLY, and the screen states it', () => {
  function withTwoEstimatedCategories(): UseForecastResult {
    return forecast({
      statisticalLayer: {
        status: 'ready',
        reasonHe: '',
        lineItems: [],
        categories: [
          {
            status: 'estimated', categoryId: 'מזון', monthsObserved: 4, periods: [],
            monthlyTotalsILS: [], estimateILS: 2000, band: null, bandBasis: 'observed-range',
          },
          {
            status: 'estimated', categoryId: 'תחבורה', monthsObserved: 4, periods: [],
            monthlyTotalsILS: [], estimateILS: 900, band: null, bandBasis: 'observed-range',
          },
        ],
        rowsRead: 10, rowsCounted: 10, weakestMonthsObserved: 4,
        markerCompletedAt: 'x', markerSourceCommit: 'y',
      },
      result: forecastResult({
        lineItems: [certain('2026-09', 4200), estimated('2026-09', 2900)],
        byPeriod: [
          { period: '2026-09', certainILS: 4200, statisticalILS: 2900, assumptionILS: 0, incomeILS: 0, expenseILS: 7100 },
          { period: '2026-10', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
          { period: '2026-11', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
        ],
      }),
    });
  }

  it('!! NO TEST IN THE TREE SET A CATEGORY FILTER ON THIS SCREEN. This one does.', async () => {
    // The screen's comment claimed "מה narrows the category-level sections and the screen says so".
    // The first clause was true and untested; the second was FALSE — there was no such copy.
    renderScreen(withTwoEstimatedCategories());
    expect(screen.getByTestId('screen.forecast.estimatedList').textContent).toContain('תחבורה');
    expect(screen.queryByTestId('screen.forecast.categoryFilterNote')).toBeNull();

    filtersApi!.setCategoryFilter({ categories: ['מזון'] });
    await waitFor(() =>
      expect(screen.getByTestId('screen.forecast.estimatedList').textContent).not.toContain('תחבורה')
    );
    expect(screen.getByTestId('screen.forecast.estimatedList').textContent).toContain('מזון');
    expect(screen.getByTestId('screen.forecast.categoryFilterNote').textContent).toBe(
      FORECAST_CATEGORY_FILTER_NOTE_HE
    );
  });

  it('!! and the HEADLINE and the BARS are untouched by it — a balance over a subset is not a balance', async () => {
    // The ruling, held as a measurement rather than as the sentence that states it: the figures the
    // note promises are unfiltered must actually be unfiltered.
    renderScreen(withTwoEstimatedCategories());
    const balanceBefore = screen.getByTestId('screen.forecast.balance').textContent;
    const barsBefore = (chartPropsOf('BarChart').data as Array<{ committed: number; estimated?: number }>).map(
      (row) => [row.committed, row.estimated]
    );
    filtersApi!.setCategoryFilter({ categories: ['מזון'] });
    await waitFor(() => expect(screen.getByTestId('screen.forecast.categoryFilterNote')).toBeTruthy());
    expect(screen.getByTestId('screen.forecast.balance').textContent).toBe(balanceBefore);
    expect(
      (chartPropsOf('BarChart').data as Array<{ committed: number; estimated?: number }>).map((row) => [
        row.committed,
        row.estimated,
      ])
    ).toEqual(barsBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — F5. THE GAP LINK OPENS THE FORM THAT FILLS THE GAP
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F5 — D26`s deep links carry the payload that OPENS the create form', () => {
  it('!! `accounts` carries `openCreate`; `recurring`, whose screen reads no payload, does not', () => {
    // Both directions in one render. Sending the payload to a screen that ignores it is
    // indistinguishable from sending nothing — a deep link that looks built and is not — so the
    // negative half is the half that keeps this honest.
    renderScreen(
      forecast({
        projectedBalanceILS: null,
        suppressed: ['accounts', 'recurring'],
      })
    );
    fireEvent.click(screen.getByTestId('screen.forecast.gapLink.accounts'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('accounts', OPEN_CREATE_PAYLOAD);
    fireEvent.click(screen.getByTestId('screen.forecast.gapLink.recurring'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('recurring', undefined);
  });

  it('`loans` carries it too — the second screen that has always consumed a payload', () => {
    renderScreen(forecast({ projectedBalanceILS: null, suppressed: ['loans'] }));
    fireEvent.click(screen.getByTestId('screen.forecast.gapLink.loans'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('loans', OPEN_CREATE_PAYLOAD);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — F7 / F8. THE UNLABELLED FIGURE AND THE ₪0.00 THAT WAS REALLY A WORD
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F7 — the chart`s value scale is LABELLED and hoverable, not a bare ₪ figure', () => {
  it('!! names what the figure is and carries its own `<Explain>`', () => {
    // It shipped as a bare `₪4,200.00` under the month list: no label, no hover, no test. It is not
    // deleted because the chart is `aria-hidden` under the declared D39 departure, which takes the
    // Y-axis ticks with it — this line is the only place the scale exists in text.
    renderScreen(
      forecast({
        result: forecastResult({
          byPeriod: [
            { period: '2026-09', certainILS: 4200, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 4200 },
            { period: '2026-10', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
            { period: '2026-11', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
          ],
        }),
      })
    );
    const scale = screen.getByTestId('screen.forecast.axisMax');
    expect(scale.textContent).toContain(forecastAxisMaxHe('₪4,200.00'));
    // The bare figure on its own is exactly what this replaced, so the label must not be optional.
    expect(scale.textContent).not.toBe('₪4,200.00');
  });
});

describe('!! F8 — a month with history and nothing variable says so in WORDS, never ₪0.00', () => {
  function historyButNothingVariable(): UseForecastResult {
    return forecast({
      statisticalLayer: {
        status: 'ready', reasonHe: '', lineItems: [], categories: [], rowsRead: 10, rowsCounted: 10,
        weakestMonthsObserved: 4, markerCompletedAt: 'x', markerSourceCommit: 'y',
      },
      result: forecastResult({
        lineItems: [certain('2026-09', 4200), estimated('2026-09', 2900)],
        byPeriod: [
          { period: '2026-09', certainILS: 4200, statisticalILS: 2900, assumptionILS: 0, incomeILS: 0, expenseILS: 7100 },
          { period: '2026-10', certainILS: 1000, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 1000 },
          { period: '2026-11', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0 },
        ],
      }),
    });
  }

  it('!! prints the sentence, not `₪0.00`, and is NOT confused with D40`s gap', () => {
    // Their own fixture already produced this in two months of three and nobody looked. It is not a
    // gap: `monthsObserved` is 4, so we HAVE a basis, and D40's ragged marker would be a lie in the
    // other direction. It is a real measured zero, and a figure is the wrong shape for it.
    renderScreen(historyButNothingVariable());
    const row = screen.getByTestId('screen.forecast.month.2026-10');
    expect(screen.getByTestId('screen.forecast.month.2026-10.noVariable').textContent).toContain(
      FORECAST_NO_VARIABLE_SPEND_HE
    );
    expect(screen.queryByTestId('screen.forecast.month.2026-10.estimated')).toBeNull();
    expect(screen.queryByTestId('screen.forecast.month.2026-10.gap')).toBeNull();
    expect(row.textContent).not.toContain('₪0.00');
  });

  it('a month WITH variable spend still prints the figure — so the branch above is not the default', () => {
    renderScreen(historyButNothingVariable());
    expect(screen.getByTestId('screen.forecast.month.2026-09.estimated').textContent).toContain('2,900');
    expect(screen.queryByTestId('screen.forecast.month.2026-09.noVariable')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — THE OTHER DISCLOSURE'S NEGATIVE DIRECTION
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! both double-count disclosures are gated in BOTH directions', () => {
  it('!! the LOAN/INSURANCE one is ABSENT on an instalment-only corpus', () => {
    // The instalment sentence's negative side was already held; this one's was not. The earlier of
    // the two T7b review reports claimed the instalment disclosure was INVERTED — shown with no
    // double count, hidden with one — and named a symbol (`instalmentRowCount`) that has never
    // existed in this repository. Reproduced against the shipped screen, it is gated on the
    // PRESENCE of instalment line items and is correct in both directions. This is the assertion
    // the pair was actually missing.
    renderScreen(
      forecast({
        result: forecastResult({
          lineItems: [
            certain('2026-09', 250, {
              categoryId: 'קניות',
              basis: { kind: 'installment', planKey: 'k', observedNumber: 3, totalInstallments: 12 },
            }),
          ],
        }),
      })
    );
    expect(screen.getByTestId('screen.forecast.instalmentDoubleCount')).toBeTruthy();
    expect(screen.queryByTestId('screen.forecast.doubleCount')).toBeNull();
  });

  it('an INSURANCE row raises the loan/insurance sentence too — it is not loans alone', () => {
    renderScreen(
      forecast({
        result: forecastResult({
          lineItems: [
            certain('2026-09', 300, {
              categoryId: 'ביטוחים',
              basis: { kind: 'insurance', insuranceId: 'i1', provider: 'הראל' },
            }),
          ],
        }),
      })
    );
    expect(screen.getByTestId('screen.forecast.doubleCount').textContent).toContain(
      LOAN_INSURANCE_DOUBLE_COUNT_HE
    );
    expect(screen.queryByTestId('screen.forecast.instalmentDoubleCount')).toBeNull();
  });
});

/** The month namer the screen uses, so the assertions above spell no Hebrew month. */
function monthName(period: string): string {
  return hebrewNameOfMonthKey(monthKeyOf(period)) ?? period;
}

/** Reads a file under `src/` once, for the source-level claims above. */
function readFileSyncCached(relPath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, '..', relPath), 'utf8');
}
