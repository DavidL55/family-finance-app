// src/components/ForecastChart.tsx — Stage 7 T7b. D39, D40 and D42, drawn.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THIS FILE CONTAINS NO ARITHMETIC
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Every figure it draws arrives already computed by `forecastView.ts`, which has its own
// table-driven tests. That is deliberate and it is D40's doing: "the gap is not a bar" is a claim
// about a PICTURE, and A21 records that all three obvious wrong renderings pass a string-level
// guard. A component that also decided the shape would be a component whose decisions could only be
// checked by looking at it, and there is no browser in this project to look with.
//
// ── !! WHAT THIS COMPONENT IS NOT: THE ACCESSIBLE REPRESENTATION ──────────────────────────────
//
// D39 asks for an accessible name on each bar group. It is delivered ONE LEVEL UP instead, on the
// month list `ForecastScreen` renders beneath this chart, and that is a considered departure rather
// than an omission. An `aria-label` on an SVG `<rect>` inside a third-party chart library is
// reachable by a screen reader only through that library's own DOM, which this project cannot
// verify and does not control across upgrades. The month list is ordinary DOM, carries the same
// sentence (`forecastMonthAccessibleNameHe` / `forecastMonthGapAccessibleNameHe`), and holds every
// figure with its own `<Explain>`. So this chart is marked `aria-hidden`, and the data it pictures
// is available in text beside it — which is the stronger form of the same promise.
//
// ── D42, AND WHY THE BOX DOES NOT FLIP ────────────────────────────────────────────────────────
//
// The container stays `dir="ltr"`. Recharts' internal layout math — label placement, tooltip
// anchoring, `ResponsiveContainer` measurement — assumes LTR, and flipping the container is what
// makes labels drift; the existing precedent (`Dashboard.tsx`, `InvestmentsPortfolio.tsx`) is right
// about why it exists. What flips is the AXIS: `<XAxis reversed />` puts the nearest month at the
// RIGHT edge, where a Hebrew reader starts, and `<YAxis orientation="right" />` puts the value
// scale on the same side as the reading origin. The tooltip gets its own `dir="rtl"` wrapper.
//
// The existing CATEGORY bar charts are deliberately untouched: a category axis has no
// reading-direction semantics, so `dir="ltr"` with an unreversed axis remains correct for them.
import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatILS } from '../config/money';
import {
  forecastAxisMaxILS,
  gapMarkerHeightILS,
  type ForecastMonthBar,
} from '../utils/forecastView';
import {
  MONTH_CONFIDENCE_LABEL_HE,
  STATISTICAL_GAP_REASON_HE,
  forecastCommittedHe,
} from '../utils/forecastCopy';

/**
 * D39's two luminance steps of ONE hue. The committed segment is the darker one, which is the right
 * way round: darker reads as denser and more settled, and the settled part is the one that is
 * contractual. Hatch was rejected outright (A22) — it fails at mobile bar sizes, its RTL direction
 * was never decided, and a texture has no accessible name.
 */
const COMMITTED_FILL = '#0f766e'; // teal-700
const ESTIMATED_FILL = '#5eead4'; // teal-300
/**
 * The gap marker is drawn OUTSIDE the two-step series on purpose. It is not a third luminance step
 * of the same hue — that would enrol it in the quantity encoding the other two segments carry.
 */
const GAP_MARKER_STROKE = '#94a3b8'; // slate-400

/** The row shape recharts is handed. One flat object per month; no nested reads inside the chart. */
interface ChartRow {
  period: string;
  monthLabel: string;
  committed: number;
  /** `undefined`, not 0, for a gap month — recharts draws nothing for an undefined segment. */
  estimated: number | undefined;
  /** `[downwards, upwards]` offsets from the top of the estimated segment. `undefined` = no band. */
  bandOffsets: [number, number] | undefined;
  /** D40's mark. `0` on every month that has an estimate, so the marker exists only where it does. */
  gapMarker: number;
  gap: boolean;
  confidenceLabel: string | null;
}

export interface ForecastChartProps {
  bars: ForecastMonthBar[];
  /** Turns `'2026-09'` into `'ספטמבר'`. Injected so this file spells no month name (T6's ban). */
  monthNameOf: (period: string) => string;
}

/**
 * D40's ragged terminating edge, plus the `?` that says the height means nothing.
 *
 * A dashed OUTLINE with no fill and a torn top edge, at a height that is identical on every gap bar
 * in the horizon — the one property a reader can actually perceive as "this is not reporting the
 * data". The three renderings A21 rejects are all avoided here by construction: it is not omitted
 * (it is visible), it is not a plain dashed rectangle at the value height (its height is constant),
 * and it is not a full-height grey column.
 */
function RaggedGap(props: { x?: number; y?: number; width?: number; height?: number }): React.JSX.Element | null {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  if (width <= 0 || height <= 0) return null;
  const teeth = 6;
  const step = width / teeth;
  const points: string[] = [`${x},${y + height}`];
  for (let i = 0; i < teeth; i++) {
    points.push(`${x + i * step},${y + (i % 2 === 0 ? 0 : height * 0.35)}`);
    points.push(`${x + (i + 0.5) * step},${y + (i % 2 === 0 ? height * 0.35 : 0)}`);
  }
  points.push(`${x + width},${y + height}`);
  return (
    <g>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={GAP_MARKER_STROKE}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={x + width / 2}
        y={y + height / 2 + 4}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill={GAP_MARKER_STROKE}
      >
        ?
      </text>
    </g>
  );
}

/** The tooltip, in its OWN RTL wrapper — D42's one exception to the LTR container. */
function ForecastTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div
      dir="rtl"
      data-testid="screen.forecast.chart.tooltip"
      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
    >
      <p className="font-semibold text-slate-900">{row.monthLabel}</p>
      <p className="tabular-nums">{forecastCommittedHe(formatILS(row.committed))}</p>
      {row.gap ? (
        <p>{STATISTICAL_GAP_REASON_HE['no-history']}</p>
      ) : (
        <p className="tabular-nums">{formatILS((row.estimated ?? 0) + row.committed)}</p>
      )}
      {row.confidenceLabel !== null && <p className="text-slate-500">{row.confidenceLabel}</p>}
    </div>
  );
}

export function ForecastChart({ bars, monthNameOf }: ForecastChartProps): React.JSX.Element {
  const axisMaxILS = forecastAxisMaxILS(bars);
  const rows: ChartRow[] = bars.map((bar) => ({
    period: bar.period,
    monthLabel: monthNameOf(bar.period),
    committed: bar.certainILS,
    estimated: bar.estimatedILS ?? undefined,
    bandOffsets:
      bar.band === null || bar.estimatedILS === null
        ? undefined
        : [
            Math.max(bar.estimatedILS - bar.band.lowILS, 0),
            Math.max(bar.band.highILS - bar.estimatedILS, 0),
          ],
    gapMarker: gapMarkerHeightILS(axisMaxILS, bar.gap),
    gap: bar.gap,
    confidenceLabel: bar.confidence === null ? null : MONTH_CONFIDENCE_LABEL_HE[bar.confidence],
  }));

  return (
    // `dir="ltr"` — see the header. The reason is written here too because the next person to touch
    // this file will be looking at THIS line and wondering why an RTL app has an LTR box in it.
    <div
      className="h-72 w-full"
      dir="ltr"
      aria-hidden="true"
      data-testid="screen.forecast.chart"
      data-tour-id="screen.forecast.chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 56, left: 8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          {/* D42 — REVERSED, so time runs right to left and the nearest month is where a Hebrew
              reader starts. This is the first time-series chart in the app; there was no precedent
              to inherit, and the category-bar precedent is right for categories and wrong here. */}
          <XAxis
            dataKey="monthLabel"
            reversed
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
          />
          {/* …and the value scale moves to the same side as the reading origin. */}
          <YAxis
            orientation="right"
            domain={[0, axisMaxILS]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
          />
          <Tooltip cursor={{ fill: '#f1f5f9' }} content={<ForecastTooltip />} />
          <Bar dataKey="committed" stackId="month" fill={COMMITTED_FILL} radius={[0, 0, 4, 4]} isAnimationActive={false} />
          <Bar dataKey="estimated" stackId="month" fill={ESTIMATED_FILL} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {/* D39 — the whisker sits on the ESTIMATED segment only. Because it is declared inside
                THIS bar and not the stack, its baseline is the top of the committed segment, which
                is itself the visual assertion "everything below this is not in question" (D3). */}
            <ErrorBar dataKey="bandOffsets" width={6} strokeWidth={1.5} stroke="#0f172a" direction="y" />
          </Bar>
          {/* D40 — and it is stacked LAST so it terminates the column, above the committed portion
              and in place of an estimate that does not exist. */}
          <Bar dataKey="gapMarker" stackId="month" shape={<RaggedGap />} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
