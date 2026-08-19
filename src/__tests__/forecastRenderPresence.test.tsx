// src/__tests__/forecastRenderPresence.test.tsx — Stage 7 T7c. THE GUARDS THAT NEED A DOM.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS FOR, AND WHY IT COULD NOT BE ANY OF THE FILES IT REPLACES HALF OF
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Four guards in this repo assert something about SOURCE and say, in their own headers, that source
// is not what they mean:
//
//   · `forecastGlossaryWiring.test.ts` — "SOURCE presence, not RENDER presence. It cannot tell an
//     `<Explain>` on a live branch from one behind a condition that is never true. T7c owns the
//     render-presence conversion and the DOM-derived coverage guard."
//   · `adviceBoundary.test.ts` — "it cannot tell a component that renders the notice from one that
//     imports it and puts it behind a collapsed panel."
//   · `ForecastCard.test.tsx` / `ForecastScreen.test.tsx` — D16's "no figure labelled `יתרה צפויה`
//     when the balance is null" is held ONE STATE AT A TIME, by whichever cases happened to be
//     written. The rule is about EVERY state.
//   · §7's "`tabular-nums` on every numeric cell" was held by NOTHING at all.
//
// This file answers all four the same way: **render the surfaces, then ask the DOM.** The
// predicates are in `./helpers/renderPresence`, proven on synthetic DOM below before they are
// pointed at anything real — because on a tree where the guards pass, an unproven predicate is a
// predicate that says nothing.
//
// ── WHY THE MOCKS ARE REPEATED HERE RATHER THAN IMPORTED ─────────────────────────────────────
//
// `vi.mock` registrations are hoisted per MODULE and importing `ForecastScreen.test.tsx` would
// execute its hundred render cases inside this suite — the problem `extractionSurfaces.ts`'s header
// records and the reason helpers exist at all. The PREDICATES are shared; the mock table is not
// shareable and is not pretended to be.
//
// ── THE STATE TABLE IS THE CORPUS, AND IT IS NAMED ────────────────────────────────────────────
//
// Every guard below runs over `FORECAST_STATES` — a table of hook results chosen to reach every
// branch of the two surfaces, not a single happy path. A guard driven by one render is a guard that
// covers one branch and claims a screen.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotificationProvider } from '../contexts/NotificationContext';
import { NavigationProvider } from '../contexts/NavigationContext';
import { FilterProvider } from '../contexts/FilterContext';
import { GLOSSARY } from '../config/glossary';
import {
  EXPLAIN_SELECTOR,
  ILS_SIGN,
  describeElement,
  directTextOf,
  hasExplainWithin,
  isExplainCovered,
  misalignedMoneyFigures,
  moneyFigureElements,
  renderedExplainIds,
  unexplainedMoneyFigures,
} from './helpers/renderPresence';

const H = vi.hoisted(() => ({
  mockUseForecast: vi.fn(),
  mockNavigateTo: vi.fn(),
}));

vi.mock('../hooks/useFamilyMembers', () => ({
  useFamilyMembers: () => ({
    status: 'ready',
    members: [
      { id: 'david', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], createdAt: 'x', updatedAt: 'x' },
    ],
    error: null,
  }),
}));
vi.mock('../hooks/useGroups', () => ({ useGroups: () => ({ status: 'ready', groups: [], error: null }) }));
vi.mock('../contexts/NavigationContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contexts/NavigationContext')>();
  return { ...actual, useNavigation: () => ({ ...actual.useNavigation(), navigateTo: H.mockNavigateTo }) };
});
vi.mock('../services/ForecastAssumptionsService', () => ({
  saveForecastAssumption: vi.fn(async () => ({}) as never),
  listForecastAssumptions: vi.fn(async () => []),
}));
// The chart is `aria-hidden` and stubbed for the same reason `ForecastScreen.test.tsx` stubs it:
// `ResponsiveContainer` measures 0×0 in jsdom and renders nothing. A real recharts here would put
// ZERO of the chart in the DOM while the month list — the accessible form, which is what these
// guards are about — renders in full.
vi.mock('recharts', () => {
  const record = () => {
    const Stub = (props: Record<string, unknown>): React.JSX.Element => (
      <div>{props.children as React.ReactNode}</div>
    );
    return Stub;
  };
  return {
    BarChart: record(), Bar: record(), XAxis: record(), YAxis: record(),
    CartesianGrid: record(), Tooltip: record(), ErrorBar: record(), ResponsiveContainer: record(),
  };
});
vi.mock('../hooks/useForecast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useForecast')>();
  return { ...actual, useForecast: H.mockUseForecast };
});

import ForecastScreen from '../components/ForecastScreen';
import { ForecastCard } from '../components/ForecastCard';
import { Explain } from '../components/Explain';
import type { UseForecastResult } from '../hooks/useForecast';
import type { ForecastLineItem } from '../utils/forecastBasis';
import type { ForecastResult } from '../utils/forecast';

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

function estimated(
  period: string,
  amountILS: number,
  band: { lowILS: number; midILS: number; highILS: number } | null = null,
  monthsObserved = 4
): ForecastLineItem {
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

function instalment(period: string, amountILS: number): ForecastLineItem {
  return {
    period,
    categoryId: 'ריהוט',
    direction: 'expense',
    amountILS,
    basis: { kind: 'installment', planKey: 'k', observedNumber: 3, totalInstallments: 12 },
  };
}

function assumed(period: string, amountILS: number): ForecastLineItem {
  return {
    period,
    categoryId: 'שכר דירה',
    direction: 'expense',
    amountILS,
    basis: {
      kind: 'assumption',
      assumptionId: 'a1',
      source: 'user',
      updatedAt: '2026-08-01T00:00:00.000Z',
      overrides: [{ kind: 'loan', loanId: 'l1', name: 'משכנתא' }],
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

function layer(over: Record<string, unknown> = {}): UseForecastResult['statisticalLayer'] {
  return {
    status: 'ready',
    reasonHe: '',
    lineItems: [],
    categories: [],
    rowsRead: 10,
    rowsCounted: 10,
    weakestMonthsObserved: 4,
    markerCompletedAt: 'x',
    markerSourceCommit: 'y',
    ...over,
  } as UseForecastResult['statisticalLayer'];
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE TABLE — the corpus every guard below runs over
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Named states rather than an anonymous array, so a failure says WHICH picture is wrong. Between
// them they reach every conditional branch that renders a figure or a hover on either surface: a
// balance and no balance, a band and a depth chip, a gap month and a measured-zero month, all four
// contractual bases, an assumption over a contractual item, both target sources, all three
// allowance outcomes, and the clamp.
const richByPeriod = [
  { period: '2026-09', certainILS: 4200, statisticalILS: 2900, assumptionILS: 6000, incomeILS: 16000, expenseILS: 13100 },
  { period: '2026-10', certainILS: 1000, statisticalILS: 500, assumptionILS: 0, incomeILS: 16000, expenseILS: 1500 },
  { period: '2026-11', certainILS: 900, statisticalILS: 0, assumptionILS: 0, incomeILS: 16000, expenseILS: 900 },
];

const richItems = [
  certain('2026-09', 4200),
  certain('2026-09', 800, { categoryId: 'ביטוחים', basis: { kind: 'insurance', insuranceId: 'i1', provider: 'הראל' } }),
  certain('2026-10', 1000, { categoryId: 'קבועות', basis: { kind: 'recurring', recurringId: 'r1', description: 'נטפליקס', chargeDay: 3 } }),
  instalment('2026-09', 450),
  estimated('2026-09', 2900, { lowILS: 2000, midILS: 2900, highILS: 4100 }),
  estimated('2026-10', 500, null, 2),
  assumed('2026-09', 6000),
];

const FORECAST_STATES: Array<{ name: string; value: UseForecastResult }> = [
  {
    // Everything the screen can draw at once: balance, opening balance with its staleness, all four
    // contractual bases, a banded month, a depth-chipped month, an assumption, unusable rows.
    name: 'full picture',
    value: forecast({
      openingBalance: { amountILS: 21000, asOf: '01/09/2026', staleness: 'current' } as UseForecastResult['openingBalance'],
      unusableRowCount: 3,
      statisticalLayer: layer({
        categories: [
          { status: 'estimated', categoryId: 'מזון', monthsObserved: 4, periods: [], monthlyTotalsILS: [], estimateILS: 2900, band: null, bandBasis: 'observed-range' },
          { status: 'gap', categoryId: 'חינוך', monthsObserved: 0, periods: [], monthlyTotalsILS: [], reasonHe: 'אין היסטוריה', gapReason: 'no-history' },
        ],
      }),
      result: forecastResult({ anchorClamped: true, lineItems: richItems, byPeriod: richByPeriod }),
      target: { status: 'target', source: 'personalTarget', amountILS: 14000, isFamilyScoped: false, goalsExcludedCount: 2, beyondHorizonCount: 0 },
    }),
  },
  {
    // D26/D40 — no balance, every input suppressed, and a gap month in every column.
    name: 'day one — balance suppressed, gap months',
    value: forecast({
      projectedBalanceILS: null,
      projectedIncomeILS: null,
      // !! `projectedExpenseILS` IS NULL TOO, AND THAT IS THE HOOK'S OWN RULE RATHER THAN TIDINESS:
      // with every outflow input suppressed there is no outflow to project, and the `'own'` card's
      // `צפוי לצאת` figure is exactly what D17 refuses to draw from missing inputs. Leaving the
      // default here rendered a confident ₪35,600.00 on the day-one card — a fixture stating
      // something the app does not.
      projectedExpenseILS: null,
      suppressed: ['accounts', 'incomes', 'recurring', 'loans', 'insurances', 'history'],
      suppressedOutflow: ['recurring', 'loans', 'insurances', 'history'],
      statisticalLayer: layer({ weakestMonthsObserved: 0, rowsRead: 0, rowsCounted: 0 }),
      result: forecastResult({
        lineItems: HORIZON.map((p) => certain(p, 4200)),
        byPeriod: HORIZON.map((period) => ({ period, certainILS: 4200, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 4200 })),
      }),
    }),
  },
  {
    // T7b-review F8's month: history behind it and nothing non-contractual in it — a WORD, not ₪0.
    name: 'measured zero — history, no variable spend',
    value: forecast({
      statisticalLayer: layer({ weakestMonthsObserved: 4 }),
      result: forecastResult({
        lineItems: [certain('2026-09', 4200)],
        byPeriod: HORIZON.map((period) => ({ period, certainILS: 4200, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 4200 })),
      }),
    }),
  },
  {
    // D29 — the allowance table, which is the only state that renders a lead row at all.
    name: 'allowance rows — a reachable shortfall',
    value: forecast({
      projectedIncomeILS: 48000,
      projectedExpenseILS: 34000,
      statisticalLayer: layer(),
      result: forecastResult({ lineItems: richItems, byPeriod: richByPeriod }),
      target: { status: 'target', source: 'goal', amountILS: 16000, isFamilyScoped: true, goalsExcludedCount: 0, beyondHorizonCount: 0 },
    }),
  },
  {
    // D29's refusal — the shortfall is larger than the whole flexible pool.
    name: 'allowance unreachable',
    value: forecast({
      projectedIncomeILS: 48000,
      projectedExpenseILS: 34000,
      statisticalLayer: layer(),
      result: forecastResult({ lineItems: richItems, byPeriod: richByPeriod }),
      target: { status: 'target', source: 'goal', amountILS: 90000, isFamilyScoped: false, goalsExcludedCount: 0, beyondHorizonCount: 0 },
    }),
  },
  {
    // D38's negative state, on the surface that renders it at glance scale.
    name: 'negative balance',
    value: forecast({ projectedBalanceILS: -3100, statisticalLayer: layer(), result: forecastResult({ lineItems: richItems, byPeriod: richByPeriod }) }),
  },
];

/** The card takes two scopes and they are mutually exclusive by construction (§v2.2). Both render. */
const CARD_SCOPES = ['family', 'own'] as const;

function renderScreenState(value: UseForecastResult): HTMLElement {
  H.mockUseForecast.mockReturnValue(value);
  const { container } = render(
    <NotificationProvider>
      <NavigationProvider>
        <FilterProvider>
          <ForecastScreen {...PROPS} />
        </FilterProvider>
      </NavigationProvider>
    </NotificationProvider>
  );
  return container;
}

function renderCardState(value: UseForecastResult, scope: 'family' | 'own'): HTMLElement {
  const { container } = render(
    <ForecastCard forecast={value} scope={scope} onNavigate={() => undefined} onOpen={() => undefined} />
  );
  return container;
}

/** Every state of both surfaces, each rendered into its own container. */
function everySurfaceRender(): Array<{ name: string; container: HTMLElement }> {
  const rendered: Array<{ name: string; container: HTMLElement }> = [];
  for (const state of FORECAST_STATES) {
    rendered.push({ name: `screen / ${state.name}`, container: renderScreenState(state.value) });
    for (const scope of CARD_SCOPES) {
      rendered.push({ name: `card ${scope} / ${state.name}`, container: renderCardState(state.value, scope) });
    }
  }
  return rendered;
}

beforeEach(() => {
  sessionStorage.clear();
  H.mockUseForecast.mockReset();
  H.mockNavigateTo.mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE PREDICATES, PROVEN ON SYNTHETIC DOM BEFORE ANY REAL SURFACE IS TOUCHED
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the render-presence predicates FIRE — proven before they are pointed at the tree', () => {
  const dom = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
  };

  it('`directTextOf` reads an element`s OWN text and nothing a descendant contributes', () => {
    const host = dom('<p id="outer">plain<span id="inner">₪12.00</span></p>');
    const outer = host.querySelector('#outer') as Element;
    const inner = host.querySelector('#inner') as Element;
    expect(directTextOf(outer)).toBe('plain');
    expect(directTextOf(inner)).toBe(`${ILS_SIGN}12.00`);
    // …and this is what makes the figure set derivable: `textContent` would report BOTH.
    expect(outer.textContent).toContain(ILS_SIGN);
    expect(moneyFigureElements(host).map((e) => e.id)).toEqual(['inner']);
  });

  it('a money figure with its own `<Explain>` is covered; a bare one is not', () => {
    const withHover = dom(`<span id="f">${ILS_SIGN}12.00<span data-tour-id="explain.forecast.x"></span></span>`);
    expect(unexplainedMoneyFigures(withHover)).toEqual([]);
    const bare = dom(`<span id="f">${ILS_SIGN}12.00</span>`);
    expect(unexplainedMoneyFigures(bare).map((e) => e.id)).toEqual(['f']);
  });

  it('!! the LABEL-THEN-FIGURE shape is covered, and it is bounded to EARLIER siblings', () => {
    // D38's glance figure carries no ⓘ of its own — the label above it does, and an info button
    // inside a text-4xl number is a tap target in the middle of the one thing the card exists to
    // show. So an earlier sibling's hover covers the figure…
    const labelled = dom(
      `<div><div data-tour-id="explain.forecast.projectedBalance"></div><p id="f">${ILS_SIGN}12,400.00</p></div>`
    );
    expect(unexplainedMoneyFigures(labelled)).toEqual([]);
    // …and a LATER one does NOT. This is the half that makes the guard able to fail: under an
    // "anywhere in the parent" rule, a bare figure dropped into a row that already has five hovers
    // would be covered by them, which is precisely the addition §12 says this guard must catch.
    const trailing = dom(
      `<div><p id="f">${ILS_SIGN}12,400.00</p><div data-tour-id="explain.forecast.projectedBalance"></div></div>`
    );
    expect(trailing.querySelector(EXPLAIN_SELECTOR)).not.toBeNull(); // the hover IS in the subtree
    expect(unexplainedMoneyFigures(trailing).map((e) => e.id)).toEqual(['f']); // and it does not count
  });

  it('!! and a FIGURE cannot vouch for the figure beside it — the survivor the sweep found', () => {
    // M5. The first draft accepted ANY earlier sibling with a hover, and deleting the month row's
    // `forecast.estimatedTotal` survived all 2,708 tests: the CERTAIN figure sits earlier in the
    // same flex row and carries its own ⓘ, which explains the certain figure and nothing else.
    const row = dom(
      `<div>` +
        `<span id="certain">${ILS_SIGN}4,200.00<i data-tour-id="explain.forecast.certainTotal"></i></span>` +
        `<span id="estimated">${ILS_SIGN}2,900.00</span>` +
      `</div>`
    );
    expect(unexplainedMoneyFigures(row).map((e) => e.id)).toEqual(['estimated']);
    // …while a LABEL — an earlier sibling with no ₪ of its own — still covers, which is the shape
    // D38's glance figure and the contractual row both use.
    const labelled = dom(
      `<div>` +
        `<span id="label">הלוואה · ספטמבר<i data-tour-id="explain.forecast.certainTotal"></i></span>` +
        `<span id="amount">${ILS_SIGN}4,200.00</span>` +
      `</div>`
    );
    expect(unexplainedMoneyFigures(labelled)).toEqual([]);
  });

  it('`renderedExplainIds` reads ids off the DOM, and an unknown id leaves NO trace', () => {
    const host = dom('<i data-tour-id="explain.forecast.shortfall"></i><i data-tour-id="screen.forecast"></i>');
    expect(renderedExplainIds(host)).toEqual(['forecast.shortfall']);
  });

  it('!! and the attribute this all rests on is the one `Explain` actually writes', () => {
    // The convention in `renderPresence.ts`'s header, checked against the component rather than
    // trusted: a rendered `<Explain>` for a KNOWN id writes `data-tour-id="explain.<id>"`, and an
    // UNKNOWN id renders nothing at all — which is what makes DOM presence mean "wired AND drawn".
    const known = Object.keys(GLOSSARY).find((id) => id.startsWith('forecast.')) as string;
    const { container } = render(<Explain id={known} />);
    expect(renderedExplainIds(container)).toEqual([known]);
    cleanup();
    const { container: missing } = render(<Explain id="forecast.thisIdDoesNotExist" />);
    expect(renderedExplainIds(missing)).toEqual([]);
    expect(hasExplainWithin(missing.ownerDocument.body)).toBe(false);
  });

  it('`misalignedMoneyFigures` fires on proportional figures and inherits `tabular-nums`', () => {
    expect(misalignedMoneyFigures(dom(`<p id="f">${ILS_SIGN}1,234.00</p>`)).map((e) => e.id)).toEqual(['f']);
    expect(misalignedMoneyFigures(dom(`<p id="f" class="tabular-nums">${ILS_SIGN}1,234.00</p>`))).toEqual([]);
    // Inherited from an ancestor is enough — the utility is inherited by the CSS cascade, and a
    // rule that demanded the class on the leaf would cry wolf on every correctly-set column.
    expect(misalignedMoneyFigures(dom(`<div class="tabular-nums"><p id="f">${ILS_SIGN}1.00</p></div>`))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §12 — EXPLAIN COVERAGE, DERIVED FROM THE RENDERED DOM, WITH A CANARY
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! §12 — every ₪ figure a reader can see carries a hover (RENDER presence)', () => {
  it('the derived figure set is NON-VACUOUS and holds the figures known to exist', () => {
    // THE CANARY. A predicate that returned nothing would make every assertion below pass by
    // running over an empty set — this stage's own recorded shadowing class, ten instances and
    // counting. Deliberately a SUPERSET check: a figure added tomorrow must not fail this line, it
    // must fail the coverage line.
    const container = renderScreenState(FORECAST_STATES[0].value);
    const figures = moneyFigureElements(container);
    expect(figures.length).toBeGreaterThan(10);
    const named = figures.map((e) => e.getAttribute('data-testid')).filter((id) => id !== null);
    expect(named).toEqual(
      expect.arrayContaining(['screen.forecast.balance', 'screen.forecast.committed', 'screen.forecast.axisMax'])
    );
  });

  it('!! NO ₪ figure renders without a hover, in ANY state of EITHER surface', () => {
    for (const { name, container } of everySurfaceRender()) {
      const uncovered = unexplainedMoneyFigures(container).map(describeElement);
      // The card is exempt as a WHOLE SURFACE and only while it renders no hover at all — see the
      // next assertion, which is what keeps that exemption from being permanent.
      if (renderedExplainIds(container).length === 0) continue;
      expect(uncovered, name).toEqual([]);
    }
  });

  it('!! the card`s exemption is a MEASURED state, not a permanent hole', () => {
    // D38's card is a glance summary with an "open the screen" affordance and NO `<Explain>`: an
    // unwired glossary id renders nothing, so T7a shipped the card without hovers and T7b put them
    // on the screen the card opens. That is a decision, and it is exempted above by a DERIVED
    // property — "this surface renders no hover at all" — rather than by its filename.
    //
    // The day one hover is added to the card, this line goes red and the whole card comes under the
    // coverage rule in the same commit. An exemption keyed on a filename would not have.
    for (const scope of CARD_SCOPES) {
      const container = renderCardState(FORECAST_STATES[0].value, scope);
      expect(renderedExplainIds(container), `card ${scope}`).toEqual([]);
      expect(moneyFigureElements(container).length, `card ${scope}`).toBeGreaterThan(0);
    }
  });

  it('!! EVERY `forecast.*` glossary entry is RENDERED by some state — not merely present in source', () => {
    // The conversion `forecastGlossaryWiring.test.ts` hands over. Its AST version cannot tell an
    // `<Explain>` on a live branch from one behind a condition that is never true; this one reads
    // the attribute the component only writes when it actually renders, for an id that actually
    // exists.
    const rendered = new Set<string>();
    for (const { container } of everySurfaceRender()) {
      for (const id of renderedExplainIds(container)) rendered.add(id);
    }
    const unrendered = Object.keys(GLOSSARY)
      .filter((id) => id.startsWith('forecast.'))
      .filter((id) => !rendered.has(id))
      .sort();
    expect(unrendered).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D16 — THE FIGURE ELEMENT, NEVER A STRING SEARCH
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D16 vs D17 — the balance guard is built on the FIGURE, because the string is legal', () => {
  // ── WHY THIS CANNOT BE A DENYLIST, RESTATED WHERE THE GUARD LIVES ────────────────────────────
  //
  // D16 forbids a figure labelled `יתרה צפויה` when the balance is null. D17's APPROVED gap copy is
  // `לא ניתן להציג יתרה צפויה — חסרים…` — the same string, rendered exactly when the balance IS
  // null. A denylist over the phrase fails the plan's own sentence (T7a review, finding 4), which is
  // the A21 defect — testing the string instead of the picture — arriving in a different guard.
  //
  // The seam is that `data-testid="card.forecast.balance"` / `screen.forecast.balance` exists ONLY
  // where the figure is rendered. So the rule is a BICONDITIONAL over the element, checked in both
  // directions across every state, and it is deliberately not "the phrase is absent".
  const BALANCE_TESTIDS = { screen: 'screen.forecast.balance', card: 'card.forecast.balance' } as const;

  it('!! the balance FIGURE exists exactly when a balance exists — both directions, every state', () => {
    for (const state of FORECAST_STATES) {
      const expected = state.value.projectedBalanceILS !== null;

      const screenContainer = renderScreenState(state.value);
      expect(screenContainer.querySelector(`[data-testid="${BALANCE_TESTIDS.screen}"]`) !== null, `screen / ${state.name}`).toBe(expected);

      const cardContainer = renderCardState(state.value, 'family');
      expect(cardContainer.querySelector(`[data-testid="${BALANCE_TESTIDS.card}"]`) !== null, `card / ${state.name}`).toBe(expected);
    }
  });

  it('!! and the phrase D16 names is NOT banned — D17`s gap copy contains it and must render', () => {
    // The half that proves this is a picture guard and not a denylist wearing one's name. If anybody
    // ever converts D16 back into a string search, this fails.
    const suppressedState = FORECAST_STATES.find((s) => s.value.projectedBalanceILS === null);
    expect(suppressedState).toBeDefined();
    const container = renderScreenState((suppressedState as { value: UseForecastResult }).value);
    expect(container.querySelector('[data-testid="screen.forecast.gap"]')?.textContent).toContain('יתרה צפויה');
    expect(container.querySelector(`[data-testid="${BALANCE_TESTIDS.screen}"]`)).toBeNull();
  });

  it('!! no ₪ figure is rendered at GLANCE SCALE while the balance is null — D26`s count, not ₪0', () => {
    // The failure D16 exists to prevent is not the phrase, it is a NUMBER in the glance position
    // that a reader takes for a balance. Checked as the picture: whatever occupies that position
    // when there is no balance must not be money.
    const suppressed = FORECAST_STATES.find((s) => s.value.projectedBalanceILS === null) as { value: UseForecastResult };
    for (const container of [renderScreenState(suppressed.value), renderCardState(suppressed.value, 'family')]) {
      const glance = [...container.querySelectorAll('[class*="text-3xl"], [class*="text-4xl"], [class*="text-2xl"]')];
      for (const element of glance) {
        expect(directTextOf(element), describeElement(element)).not.toContain(ILS_SIGN);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// F10 — THE PAIRING GUARD, CONVERTED FROM SOURCE PRESENCE TO RENDER PRESENCE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F10 — wherever an allowance row is DRAWN, the advice boundary is DRAWN with it', () => {
  const LEAD = 'screen.forecast.allowanceLead';
  const NOTICE = 'screen.forecast.adviceBoundary';

  it('!! the pairing holds in the DOM, in every state — not merely in the imports', () => {
    // `adviceBoundary.test.ts` pins that any module REACHING FOR `allowanceLeadHe` also reaches for
    // `ADVICE_BOUNDARY_NOTICE_HE`. That is source presence and its own header says so: it cannot
    // tell a screen that renders the notice from one that imports it and puts it behind a collapsed
    // panel. This is the same rule about the DOM.
    for (const state of FORECAST_STATES) {
      const container = renderScreenState(state.value);
      if (container.querySelector(`[data-testid="${LEAD}"]`) === null) continue;
      expect(container.querySelector(`[data-testid="${NOTICE}"]`), state.name).not.toBeNull();
    }
  });

  it('!! and it is NOT VACUOUS — some state actually draws a lead row', () => {
    // The source-presence guard was true on an EMPTY SET for two whole tasks and said so in its own
    // comment. A render-presence version could be born in the same condition and nobody would know,
    // so the corpus is asserted to contain the state the rule is about.
    const drawing = FORECAST_STATES.filter(
      (state) => renderScreenState(state.value).querySelector(`[data-testid="${LEAD}"]`) !== null
    );
    expect(drawing.map((s) => s.name)).toEqual(['full picture', 'allowance rows — a reachable shortfall']);
  });

  it('!! the notice is UNCONDITIONAL within its section — it survives every allowance outcome', () => {
    // The pairing rule alone would be satisfied by rendering the notice only in the branch that
    // draws a lead row. §9's boundary is about the SURFACE: a family reading the refusal, or the
    // target-met line, is reading advice-shaped copy too.
    for (const state of FORECAST_STATES) {
      const container = renderScreenState(state.value);
      expect(container.querySelector(`[data-testid="${NOTICE}"]`), state.name).not.toBeNull();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §7 — "ONE MONEY FORMATTER … `tabular-nums` ON EVERY NUMERIC CELL"
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! §7 — every ₪ figure the forecast draws is set in LINING FIGURES', () => {
  it('!! no forecast surface renders money in proportional figures, in any state', () => {
    // Held by NOTHING before this: §7 states the rule, `GLANCE_CLASS` carries it on two figures, and
    // every other cell was a matter of whether the author remembered. Digits that do not line up are
    // the same defect the ONE FORMATTER exists to close, one layer out — a column of shekels a
    // reader cannot compare down.
    for (const { name, container } of everySurfaceRender()) {
      expect(misalignedMoneyFigures(container).map(describeElement), name).toEqual([]);
    }
  });

  it('!! the check is non-vacuous, and the renders with NO money are named rather than skipped', () => {
    // A `tabular-nums` ban passes trivially over a render with no digits in it, so the corpus has to
    // say how much money it actually draws — and which renders draw none, since "none" is a real
    // state here rather than a broken fixture.
    const byRender = everySurfaceRender().map(({ name, container }) => ({
      name,
      figures: moneyFigureElements(container).length,
    }));
    expect(byRender.reduce((sum, r) => sum + r.figures, 0)).toBeGreaterThan(50);
    // The ONLY renders with no ₪ at all are the two day-one CARDS. That is D26's picture, not a gap
    // in the fixture: with the balance suppressed the card renders the COUNT of missing inputs and
    // a list of links, and never ₪0. Pinned, so a card that starts drawing money in that state — the
    // exact regression D16 exists to prevent — turns this line red.
    expect(byRender.filter((r) => r.figures === 0).map((r) => r.name)).toEqual([
      'card family / day one — balance suppressed, gap months',
      'card own / day one — balance suppressed, gap months',
    ]);
  });
});
