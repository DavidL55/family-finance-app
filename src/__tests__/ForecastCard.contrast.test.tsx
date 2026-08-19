// src/__tests__/ForecastCard.contrast.test.tsx — Stage 7, T7a review F4.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING: THE GUARD MEASURED THE PALETTE, NOT THE CARD
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// `ForecastCard.test.tsx` held D38's colour rule with four assertions of this shape:
//
//     expect(ratio('teal-700', 'white')).toBeGreaterThanOrEqual(AA_NORMAL);
//     expect(ratio('amber-800', 'amber-50')).toBeGreaterThanOrEqual(AA_NORMAL);
//
// Every token in them is a STRING LITERAL TRANSCRIBED INTO THE TEST. They prove that the installed
// Tailwind theme pairs those colours legibly — a true and useful fact, and one that has nothing to
// do with this component. Two mutations of `VERDICT_CLASS` survived the full suite:
//
//     negative:  'text-amber-800'  →  'text-red-600'
//     positive:  'text-teal-700'   →  'text-slate-400'
//
// Neither literal in the test moved, so neither assertion could notice. The second is the sharper
// one: `slate-400` on white is 2.63:1, and the app would have shipped its healthiest state in text
// that fails AA by a factor of nearly two, under a guard whose entire subject is contrast.
//
// ── AND A RATIO ALONE WOULD STILL NOT HOLD D38 ────────────────────────────────────────────────
//
// D38 rules the negative state "amber ground, not red-as-alarm": a projected shortfall three months
// out is a thing to look at, not an emergency, and red is this app's register for a FAILED READ.
// That ruling was carried by a COMMENT. It cannot be recovered from a measurement, because
// `red-600` on `amber-50` is 4.60:1 and PASSES — the mutant is legible and wrong. So the family is
// asserted by name, beside the ratio, and the two answer different questions.
//
// ── WHAT THIS FILE DOES INSTEAD ───────────────────────────────────────────────────────────────
//
// It RENDERS the card in each of its seven states and walks the resulting DOM. For every element
// that sizes text it reads the colour token OFF THE RENDERED ELEMENT and the background token off
// the nearest ancestor that paints one, and measures that pair against the installed theme. No
// token is written down anywhere below. `AiExtractionSurfaces.contrast.test.ts` is the repo's
// precedent — read the colour out of the component, throw if it cannot be parsed — and this is
// that pattern with the DOM standing in for the source, which is stronger: it holds the class the
// component actually renders rather than the one it declares.
//
// `ForecastCard.tsx:74` named `ForecastCard.contrast.test.ts` as the place this measurement lived.
// THAT FILE DID NOT EXIST. This is it, one letter different because it renders JSX.
//
// !! IT FOUND TWO PRE-EXISTING AA FAILURES ON ITS FIRST RUN, which is the whole argument for
// measuring the thing rather than a description of it: the loading placeholder at `text-slate-400`
// on white (2.63:1) and the error panel at `text-red-600` on `bg-red-50` (4.36:1). Both fixed in
// `ForecastCard.tsx`, both with the measurement in the comment.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AA_NORMAL, PALETTE, SETS_TEXT_SIZE, ratio } from './helpers/tailwindContrast';
import { ForecastCard } from '../components/ForecastCard';
import type { UseForecastResult } from '../hooks/useForecast';
import type { ForecastInputKey, ForecastResult } from '../utils/forecast';

const HORIZON = ['2026-09', '2026-10', '2026-11'];
const noop = (): void => {};

function forecastResult(): ForecastResult {
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
    projectedExpenseILS: 3200,
    committedILS: 8900,
    suppressed: [],
    suppressedOutflow: [],
    target: null,
    historyRefusalHe: null,
    unusableRowCount: 0,
    assumptions: [],
    status: 'ready',
    reload: noop,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the two readers — pure over a class string, and both REFUSE rather than returning null
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A Tailwind palette family-and-step, e.g. `slate-600`. `white` is handled separately. */
const PALETTE_TOKEN = /^(?:text|bg)-([a-z]+-\d{2,3})$/;

/**
 * The ONE colour token an element paints its text in, read off the rendered class list.
 *
 * THROWS on two or more, and returns `null` on none. The asymmetry is deliberate and it is the
 * `noticeColourToken` precedent next door: an element with no colour class inherits one and is not
 * this guard's business, while an element with TWO means the guard can no longer tell which colour
 * the family actually sees — and a guard that cannot tell must fail loudly rather than pick.
 */
export function textColourToken(className: string): string | null {
  const tokens = className
    .split(/\s+/)
    .map((cl) => PALETTE_TOKEN.exec(cl))
    .filter((m): m is RegExpExecArray => m !== null && m[0].startsWith('text-'))
    .map((m) => m[1]);
  if (tokens.length > 1) {
    throw new Error(
      `[textColourToken] ${tokens.length} colour tokens on one element ([${tokens.join(', ')}]): ` +
        'this guard can no longer tell which colour the card renders in.'
    );
  }
  return tokens[0] ?? null;
}

/**
 * The ground an element paints, if it paints one. `bg-white` is a palette entry of its own.
 *
 * A `bg-gradient-*` or an arbitrary value returns `null` and the walk keeps climbing — which fails
 * OPEN, and is stated rather than hidden: this card paints flat grounds only, and the assertion at
 * the end of this file is what keeps that true by counting the pairs actually measured.
 */
export function groundToken(className: string): string | null {
  for (const cl of className.split(/\s+/)) {
    if (cl === 'bg-white') return 'white';
    const match = PALETTE_TOKEN.exec(cl);
    if (match && match[0].startsWith('bg-') && PALETTE[match[1]]) return match[1];
  }
  return null;
}

interface MeasuredPair {
  token: string;
  ground: string;
  text: string;
}

/**
 * Every (colour, ground) pair the rendered card actually produces.
 *
 * The ground is the NEAREST ANCESTOR-OR-SELF that paints one, because that is what a reader's eye
 * resolves — the gap links are `text-indigo-700` on their own `bg-indigo-50` pill, sitting inside a
 * white panel, and measuring them against the panel would report a pairing nobody sees. `white` is
 * the fallback: the Dashboard's own ground behind an unpainted card.
 *
 * Only elements that SIZE text are measured, per WCAG 1.4.3 and the shared `SETS_TEXT_SIZE`
 * predicate — an icon carrying `w-5 h-5 text-slate-400` contributes no readable text and no pair.
 */
function measuredPairs(root: HTMLElement): MeasuredPair[] {
  const pairs: MeasuredPair[] = [];
  const walk = (element: Element, inheritedGround: string): void => {
    const className = typeof element.className === 'string' ? element.className : '';
    const ground = groundToken(className) ?? inheritedGround;
    const token = textColourToken(className);
    if (token !== null && SETS_TEXT_SIZE.test(className)) {
      pairs.push({ token, ground, text: (element.textContent ?? '').slice(0, 40) });
    }
    for (const child of Array.from(element.children)) walk(child, ground);
  };
  walk(root, 'white');
  return pairs;
}

/** Renders one state and returns every pair in it. The card is the whole rendered tree. */
function pairsFor(over: Partial<UseForecastResult>, scope: 'own' | 'family'): MeasuredPair[] {
  const { container, unmount } = render(
    <ForecastCard forecast={forecast(over)} scope={scope} onNavigate={noop} />
  );
  const pairs = measuredPairs(container);
  unmount();
  return pairs;
}

const SUPPRESSED_FIVE: ForecastInputKey[] = [
  'accounts',
  'incomes',
  'recurring',
  'loans',
  'insurances',
];

/** Every state this card has, named, so the sweep below cannot quietly stop covering one. */
const STATES: Array<[string, Partial<UseForecastResult>, 'own' | 'family']> = [
  ['family / positive', { projectedBalanceILS: 12400 }, 'family'],
  ['family / near-zero', { projectedBalanceILS: 40 }, 'family'],
  ['family / negative', { projectedBalanceILS: -3100 }, 'family'],
  ['family / gap', { projectedBalanceILS: null, suppressed: SUPPRESSED_FIVE }, 'family'],
  ['own / figure', { projectedExpenseILS: 3200 }, 'own'],
  ['own / gap', { projectedExpenseILS: null, suppressedOutflow: ['recurring', 'history'] }, 'own'],
  ['loading', { status: 'loading' }, 'family'],
  ['error', { status: 'error' }, 'family'],
  ['denied', { status: 'permission-denied' }, 'family'],
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1 — every colour this card RENDERS clears AA on the ground it renders it on
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F4 — the card`s own colours, measured on the card', () => {
  it.each(STATES)('%s', (name, over, scope) => {
    const pairs = pairsFor(over, scope);
    // Non-vacuity per state, and it is not decoration: a state whose walk finds nothing would pass
    // this test silently, which is the shape of every shadowed guard this stage has counted.
    expect(pairs.length, `${name} produced no measurable text`).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(
        ratio(pair.token, pair.ground),
        `${name}: text-${pair.token} on ${pair.ground} — "${pair.text}"`
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('!! and the sweep really is reading the card — the verdict colours are among what it measured', () => {
    // The assertion that stops this file becoming the thing it replaced. If `measuredPairs` ever
    // stopped seeing the figure, every test above would pass over whatever was left. So the three
    // verdict colours are checked to be PRESENT in the sweep, without being written down: they are
    // read off the rendered figure element and looked for in the walk's output.
    for (const [name, over, scope] of STATES.slice(0, 3)) {
      const { unmount } = render(
        <ForecastCard forecast={forecast(over)} scope={scope} onNavigate={noop} />
      );
      const figureToken = textColourToken(screen.getByTestId('card.forecast.balance').className);
      expect(figureToken, `${name}: the figure carries no parseable colour token`).not.toBeNull();
      const pairs = measuredPairs(screen.getByTestId('card.forecast'));
      expect(pairs.map((p) => p.token), name).toContain(figureToken);
      unmount();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2 — D38's negative state: AMBER GROUND, NOT RED-AS-ALARM
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F4 — D38`s amber ruling, which was held by a comment and by nothing else', () => {
  it('!! the negative figure is AMBER, and it is not RED — a ratio cannot say this', () => {
    // `red-600` on `amber-50` measures 4.60:1 and clears AA, so the surviving mutant was LEGIBLE
    // and wrong. The ruling is about register, not luminance: red is what this app uses for a
    // failed read (see the error panel two states down), and a shortfall three months out is a
    // thing to look at rather than a fault. Asserted on the family, off the rendered element.
    render(<ForecastCard forecast={forecast({ projectedBalanceILS: -3100 })} scope="family" onNavigate={noop} />);
    const figureToken = textColourToken(screen.getByTestId('card.forecast.balance').className);
    expect(figureToken).toMatch(/^amber-/);
    // The verdict SENTENCE beside it carries the same register — one of them drifting is the state
    // where the number and its label disagree about how alarmed to be.
    expect(textColourToken(screen.getByTestId('card.forecast.verdict').className)).toMatch(/^amber-/);
    // …and the PANEL is the amber ground the ruling names, which is the half a colour-only check
    // would miss: amber text on a white card is not "an amber ground".
    expect(groundToken(screen.getByTestId('card.forecast').className)).toMatch(/^amber-/);
  });

  it('!! and RED is reserved for the failed read, so the two registers stay distinguishable', () => {
    // The other side of the same ruling. If the error panel stopped being red the negative state's
    // "not red" assertion above would be holding a distinction the app no longer draws.
    render(<ForecastCard forecast={forecast({ status: 'error' })} scope="family" onNavigate={noop} />);
    const panel = screen.getByTestId('card.forecast.error');
    expect(textColourToken(panel.className)).toMatch(/^red-/);
    expect(groundToken(panel.className)).toMatch(/^red-/);
  });

  it('the positive and near-zero states are NEITHER red nor amber — three states, three registers', () => {
    for (const [name, balance] of [['positive', 12400], ['near-zero', 40]] as const) {
      const { unmount } = render(
        <ForecastCard forecast={forecast({ projectedBalanceILS: balance })} scope="family" onNavigate={noop} />
      );
      const token = textColourToken(screen.getByTestId('card.forecast.balance').className);
      expect(token, name).not.toMatch(/^(?:red|amber|orange|rose)-/);
      // …and the panel under them is not the alarm ground either.
      expect(groundToken(screen.getByTestId('card.forecast').className), name).not.toMatch(
        /^(?:red|amber|orange|rose)-/
      );
      unmount();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3 — the readers themselves, proven on synthetic strings, because the real card passes
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('the two readers fire, and they refuse rather than guessing', () => {
  it('reads the one colour token off a real class list', () => {
    expect(textColourToken('text-2xl md:text-3xl font-bold tabular-nums text-teal-700')).toBe('teal-700');
    expect(textColourToken('text-sm font-medium text-amber-800')).toBe('amber-800');
  });

  it('!! THROWS on two colour tokens rather than picking one — the guard must not guess', () => {
    // The state this protects against is a conditional class string that ends up carrying both the
    // old token and the new one. Reporting either would be a coin flip described as a measurement.
    expect(() => textColourToken('text-sm text-teal-700 text-red-600')).toThrow(/2 colour tokens/);
  });

  it('returns null for an element that paints no colour, so inherited text is not invented', () => {
    expect(textColourToken('flex items-center justify-between gap-2 mb-3')).toBeNull();
    // A SIZE is not a colour, and a colour is not a size — the two utilities share a prefix and
    // that is the whole reason this reader anchors on the family-and-step shape.
    expect(textColourToken('text-xs')).toBeNull();
    expect(textColourToken('text-center')).toBeNull();
  });

  it('reads a ground, treats `bg-white` as a palette entry, and ignores a colour it cannot resolve', () => {
    expect(groundToken('rounded-2xl border p-5 bg-amber-50 border-amber-200')).toBe('amber-50');
    expect(groundToken('bg-white border-slate-200')).toBe('white');
    expect(groundToken('rounded-2xl border p-5')).toBeNull();
    // A token outside the installed theme is NOT accepted as a ground — it would index `PALETTE`
    // as `undefined` and take `ratio` down with a message about colour space rather than about a
    // missing token.
    expect(groundToken('bg-notacolour-500')).toBeNull();
  });

  it('!! the size predicate is what keeps ICONS out of the measurement, and it is the shared one', () => {
    // The Compass glyph on the family card is `w-5 h-5 text-slate-400` — 2.63:1 on white, and not
    // text. WCAG 1.4.3 is about text; a decorative `aria-hidden` icon is held to 1.4.11 instead,
    // which is a different threshold and not this file's subject.
    expect(SETS_TEXT_SIZE.test('w-5 h-5 text-slate-400')).toBe(false);
    expect(SETS_TEXT_SIZE.test('text-sm text-slate-600')).toBe(true);
  });
});
