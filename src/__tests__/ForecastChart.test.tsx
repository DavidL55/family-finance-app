// src/__tests__/ForecastChart.test.tsx — Stage 7 T7b review, F2. THE ADAPTER, GUARDED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING THIS FILE EXISTS FOR: THE MODEL WAS GUARDED, THE ADAPTER WAS NOT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `forecastView.ts` — which segments exist, what the axis may see, which chip a month carries — has
// a table-driven suite and survived every mutation aimed at it. `ForecastChart.tsx` is the twenty
// lines that turn that model into the props recharts is handed, and FIVE mutations of it survived
// the whole 2,607-test suite. Four of them are D39/D40 rulings:
//
//   · `estimated: bar.estimatedILS ?? undefined` → `?? 0`. A21's "an omitted segment reads as zero"
//     arriving THROUGH THE ADAPTER, on D40's own picture — and `ChartRow.estimated`'s comment names
//     that exact hazard while nothing held it. A comment asserting a property is a defect.
//   · the two luminance steps collapsed to ONE colour — D39's whole encoding gone.
//   · the two steps SWAPPED, so the estimated portion is drawn as the darker, settled-looking one.
//   · `aria-hidden` removed from the container — the PRECONDITION the declared D39 departure rests
//     on. The month list is the accessible representation *because* the chart is hidden; unhidden,
//     a screen reader reads an unlabelled SVG and the same figures twice.
//   · `<ErrorBar direction="y">` → `"x"`, which draws D39's whisker sideways.
//
// And `bandOffsets` — the arithmetic that positions the whisker — was asserted NOWHERE IN THE TREE.
//
// ── HOW THE COLOURS ARE CHECKED, AND WHY NOT BY LITERAL ───────────────────────────────────────
//
// No hex is written down below. The fills are read OFF THE RECORDED PROPS, parsed, and compared by
// WCAG relative luminance — the same measured-rather-than-transcribed discipline
// `ForecastCard.contrast.test.tsx` was rewritten into after T7a-review F4, where four assertions
// full of transcribed tokens proved a fact about the Tailwind theme and nothing about the
// component. "Two steps of one hue, committed darker" is a RELATION between two values, so a
// relation is what is asserted; transcribing `#0f766e` would pass against a component that had
// stopped using it.
//
// ── WHY A RECORDING STUB AND NOT REAL RECHARTS ────────────────────────────────────────────────
//
// `ResponsiveContainer` measures 0×0 in jsdom and renders nothing at all, so real recharts here
// would assert nothing while looking as though it did. The stub records the props each element is
// handed, which is the only checkable claim: what the library is told to draw.
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { luminance, type RGB } from './helpers/tailwindContrast';
import type { ForecastMonthBar } from '../utils/forecastView';
import { GAP_MARKER_AXIS_FRACTION } from '../utils/forecastView';

const H = vi.hoisted(() => ({ chartProps: [] as Array<{ name: string; props: Record<string, unknown> }> }));

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

import { ForecastChart } from '../components/ForecastChart';

/** The row shape the adapter produces. Declared here so the assertions below are not `unknown`. */
interface RecordedRow {
  period: string;
  monthLabel: string;
  committed: number;
  estimated: number | undefined;
  bandOffsets: [number, number] | undefined;
  gapMarker: number;
  gap: boolean;
  confidenceLabel: string | null;
}

function bar(over: Partial<ForecastMonthBar> = {}): ForecastMonthBar {
  return {
    period: '2026-09',
    certainILS: 4200,
    estimatedILS: 2900,
    totalILS: 7100,
    gap: false,
    band: null,
    bandFloorILS: 4200,
    bandBasis: 'observed-range',
    historyDepthMonths: null,
    confidence: 'well-based',
    axisContributionILS: 7100,
    ...over,
  };
}

/** A gap month: no history and nothing non-contractual, so the estimate is ABSENT rather than 0. */
function gapBar(over: Partial<ForecastMonthBar> = {}): ForecastMonthBar {
  return bar({
    estimatedILS: null,
    totalILS: 4200,
    gap: true,
    band: null,
    bandBasis: null,
    confidence: null,
    axisContributionILS: 4200,
    ...over,
  });
}

const monthNameOf = (period: string): string => `חודש ${period}`;

function renderChart(bars: ForecastMonthBar[]): void {
  render(<ForecastChart bars={bars} monthNameOf={monthNameOf} />);
}

function propsOf(name: string): Record<string, unknown> {
  const entries = H.chartProps.filter((e) => e.name === name);
  expect(entries.length, `no <${name}> rendered`).toBeGreaterThan(0);
  return entries[entries.length - 1].props;
}

function everyPropsOf(name: string): Array<Record<string, unknown>> {
  return H.chartProps.filter((e) => e.name === name).map((e) => e.props);
}

function rows(): RecordedRow[] {
  return propsOf('BarChart').data as RecordedRow[];
}

/**
 * `#rrggbb` → the 0..1 triple `luminance` takes. THROWS on anything else rather than returning a
 * default: a colour this cannot parse is a colour the assertion below would silently pass on, which
 * is the `AiExtractionSurfaces.contrast.test.ts` precedent's own rule.
 */
function rgbOfHex(hex: unknown): RGB {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (match === null) throw new Error(`fill is not a 6-digit hex colour: ${String(hex)}`);
  const packed = Number.parseInt(match[1], 16);
  return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255];
}

/** The one `<Bar>` carrying a given `dataKey`, by name rather than by position in the JSX. */
function barPropsFor(dataKey: string): Record<string, unknown> {
  const found = everyPropsOf('Bar').filter((p) => p.dataKey === dataKey);
  expect(found, `expected exactly one <Bar dataKey="${dataKey}">`).toHaveLength(1);
  return found[0];
}

beforeEach(() => {
  H.chartProps = [];
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D40 — THE ABSENT ESTIMATE, THROUGH THE ADAPTER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D40 — a gap month`s estimate reaches recharts ABSENT, never as 0', () => {
  it('!! `estimated` is `undefined` for a gap month and a NUMBER for a month with one', () => {
    // THE MUTANT: `bar.estimatedILS ?? undefined` → `?? 0`. Recharts draws nothing for an undefined
    // segment and a zero-height segment for `0` — indistinguishable in a picture, and the second is
    // the assertion "this month's variable spend is nothing", made about a month we know nothing
    // about. Both months are in ONE render: a corpus of gap months alone would pass against an
    // adapter that always emitted `undefined`.
    renderChart([gapBar({ period: '2026-09' }), bar({ period: '2026-10' })]);
    const [gap, real] = rows();
    expect(gap.gap).toBe(true);
    expect(gap.estimated).toBeUndefined();
    expect(real.gap).toBe(false);
    expect(real.estimated).toBe(2900);
  });

  it('the gap MARKER is the only thing a gap month contributes, and it is a fraction of the axis', () => {
    renderChart([gapBar({ period: '2026-09' }), bar({ period: '2026-10' })]);
    const [gap, real] = rows();
    // Axis max is the tallest `axisContributionILS` — 7100 from the non-gap month.
    expect(gap.gapMarker).toBe(Math.round(7100 * GAP_MARKER_AXIS_FRACTION));
    expect(real.gapMarker).toBe(0);
  });

  it('the committed portion is passed at its TRUE height on a gap month — D40`s other half', () => {
    renderChart([gapBar({ certainILS: 4200 })]);
    expect(rows()[0].committed).toBe(4200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D39 — THE WHISKER'S ARITHMETIC, WHICH WAS ASSERTED NOWHERE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D39 — `bandOffsets` are OFFSETS from the estimate, in [down, up] order', () => {
  it('!! computes [estimate − low, high − estimate] rather than passing the band through', () => {
    // `ErrorBar` takes OFFSETS, not absolute values. Handing it `[lowILS, highILS]` would draw a
    // whisker from ₪2,000 below the estimate to ₪4,100 above it — an error bar an order of
    // magnitude too long, and nothing in the tree said which of the two it is.
    renderChart([bar({ estimatedILS: 2900, band: { lowILS: 2000, midILS: 2900, highILS: 4100 } })]);
    expect(rows()[0].bandOffsets).toEqual([900, 1200]);
  });

  it('!! CLAMPS at zero rather than passing a negative offset to the library', () => {
    // An inverted band (low above the estimate) is not constructible from `forecastView.ts` today,
    // and that is exactly why the clamp needs its own assertion: it is the branch no fixture
    // reaches, so deleting it would change nothing anybody measured. A negative offset makes
    // recharts draw the whisker on the wrong side of its anchor.
    renderChart([bar({ estimatedILS: 2900, band: { lowILS: 3500, midILS: 2900, highILS: 2400 } })]);
    expect(rows()[0].bandOffsets).toEqual([0, 0]);
  });

  it('is `undefined` — not `[0, 0]` — when the month carries no band', () => {
    renderChart([bar({ band: null })]);
    expect(rows()[0].bandOffsets).toBeUndefined();
  });

  it('is `undefined` on a gap month, where there is no estimate to hang it from', () => {
    renderChart([gapBar({ band: { lowILS: 1, midILS: 2, highILS: 3 } })]);
    expect(rows()[0].bandOffsets).toBeUndefined();
  });

  it('!! the whisker is declared INSIDE the estimated bar, on `bandOffsets`, along Y', () => {
    // `direction="x"` draws D39's vertical uncertainty sideways across the time axis — a picture
    // that says the MONTH is uncertain rather than the amount. And the ErrorBar must be a child of
    // the ESTIMATED bar, which is what anchors its baseline at the top of the committed segment
    // (D3: "everything below this is not in question").
    renderChart([bar({ band: { lowILS: 2000, midILS: 2900, highILS: 4100 } })]);
    const errorBar = propsOf('ErrorBar');
    expect(errorBar.direction).toBe('y');
    expect(errorBar.dataKey).toBe('bandOffsets');
    const estimatedBar = barPropsFor('estimated');
    const children = React.Children.toArray(estimatedBar.children as React.ReactNode);
    const anchored = children.some(
      (child) => React.isValidElement<{ dataKey?: string }>(child) && child.props.dataKey === 'bandOffsets'
    );
    expect(anchored, 'the ErrorBar must be a CHILD of the estimated <Bar>, not a sibling').toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D39 — TWO LUMINANCE STEPS OF ONE HUE, AND WHICH WAY ROUND THEY GO
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D39 — the two steps are two, and the COMMITTED one is the darker', () => {
  it('!! the committed and estimated fills are DIFFERENT colours', () => {
    // Collapsed to one colour, the bar still stacks and still totals correctly — and the whole of
    // D39's encoding is gone, silently, in a picture no test in this project can look at.
    renderChart([bar()]);
    expect(barPropsFor('committed').fill).not.toBe(barPropsFor('estimated').fill);
  });

  it('!! the COMMITTED fill is darker than the estimated one — measured, never transcribed', () => {
    // Darker reads as denser and more settled, and the settled part is the contractual one. Swapped,
    // the estimate is the portion that LOOKS certain — the misread D3 spends the whole ruling on.
    renderChart([bar()]);
    const committed = luminance(rgbOfHex(barPropsFor('committed').fill));
    const estimated = luminance(rgbOfHex(barPropsFor('estimated').fill));
    expect(committed).toBeLessThan(estimated);
  });

  it('!! the stack order is committed → estimated → gap marker, bottom to top', () => {
    // Position is the other half of the encoding: the committed segment sits at the BASE, and D40's
    // marker terminates the column in place of an estimate that does not exist. Reordering the JSX
    // reorders the stack.
    renderChart([bar()]);
    expect(everyPropsOf('Bar').map((p) => p.dataKey)).toEqual(['committed', 'estimated', 'gapMarker']);
    expect(everyPropsOf('Bar').every((p) => p.stackId === 'month')).toBe(true);
  });

  it('the gap marker is drawn by its own shape, OUTSIDE the two-step series — it has no fill', () => {
    // Giving it a fill would enrol it in the quantity encoding the other two segments carry.
    renderChart([gapBar()]);
    expect(barPropsFor('gapMarker').fill).toBeUndefined();
    expect(barPropsFor('gapMarker').shape).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE PRECONDITION THE DECLARED D39 DEPARTURE RESTS ON
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the chart is `aria-hidden` — the DECLARED departure`s precondition, not a detail', () => {
  it('!! hides the chart from assistive technology, so the month list is the one representation', () => {
    // D39 asks for a per-bar accessible name. It is delivered on the month list in ordinary DOM
    // instead, and that substitution is only sound while the chart itself is hidden: unhidden, a
    // screen reader meets an unlabelled third-party SVG AND the list, and reads the horizon twice.
    // Removing this attribute survived the whole suite.
    renderChart([bar()]);
    expect(screen.getByTestId('screen.forecast.chart').getAttribute('aria-hidden')).toBe('true');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D42 — WHAT THE ADAPTER PASSES THE AXES, ASSERTED AT THE COMPONENT ITSELF
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D42 — the axis flips, the box does not, and the tooltip gets its own direction', () => {
  it('passes `reversed` to the time axis and puts the value scale on the right', () => {
    renderChart([bar()]);
    expect(propsOf('XAxis').reversed).toBe(true);
    expect(propsOf('YAxis').orientation).toBe('right');
  });

  it('!! the Y domain is the axis maximum computed HERE, so the band cannot be silently clipped', () => {
    // A clipped whisker draws the estimate as more certain than it is. The domain is derived from
    // `axisContributionILS`, which for a banded month is the top of the whisker rather than the
    // stack.
    renderChart([bar({ axisContributionILS: 9300 }), gapBar({ period: '2026-10' })]);
    expect(propsOf('YAxis').domain).toEqual([0, 9300]);
  });

  it('the container stays `dir="ltr"` — recharts` layout math assumes it', () => {
    renderChart([bar()]);
    expect(screen.getByTestId('screen.forecast.chart').getAttribute('dir')).toBe('ltr');
  });

  it('the month label is produced by the INJECTED namer, so this file spells no month', () => {
    renderChart([bar({ period: '2026-09' })]);
    expect(rows()[0].monthLabel).toBe(monthNameOf('2026-09'));
  });
});
