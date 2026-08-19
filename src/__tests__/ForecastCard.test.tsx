// src/__tests__/ForecastCard.test.tsx — Stage 7 T7a. D38's card.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS SUITE CAN AND CANNOT ESTABLISH — SAID FIRST, BECAUSE IT BOUNDS EVERY LINE BELOW
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// There is NO browser and NO screenshot tooling in this project. Everything here is an assertion
// about class strings, DOM order and rendered text. It can prove that the forecast figure carries a
// smaller type scale than the net-worth figure; it CANNOT prove that the resulting hierarchy reads
// correctly on a phone, in Hebrew, to a tired parent. D38–D42 were settled on paper precisely
// because that second question has no mechanical answer here, and pretending otherwise would be the
// A21 defect — testing the string instead of the picture.
//
// So the scale claim is asserted RELATIVELY, against `Dashboard.tsx`'s own source: "one step
// smaller than net worth" is a property two files can be held to, while "large enough" is not.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC_ROOT } from './helpers/extractionSurfaces';
import { ForecastCard, FORECAST_INPUT_DESTINATION } from '../components/ForecastCard';
import {
  BALANCE_VERDICT_LABEL_HE,
  FORECAST_ANCHOR_CLAMPED_HE,
  FORECAST_INPUT_LABEL_HE,
  FORECAST_OWN_NO_INCOME_HE,
  FORECAST_OWN_OUTGOING_LABEL_HE,
} from '../utils/forecastCopy';
import { NEAR_ZERO_ILS } from '../utils/forecast';
import type { UseForecastResult } from '../hooks/useForecast';
import type { ForecastResult } from '../utils/forecast';

const HORIZON = ['2026-09', '2026-10', '2026-11'];

/** The Dashboard's own source — every claim about SLOT and POSITION is read from it, not restated. */
const dashboard = readFileSync(join(SRC_ROOT, 'components/Dashboard.tsx'), 'utf8');

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
    status: 'ready',
    reload: vi.fn(),
    ...over,
  };
}

const noop = (): void => undefined;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D38 — the five things the card carries
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D38 — the family card carries the label, the figure, the reference, the verdict and the horizon', () => {
  it('renders all five, in that DOM order', () => {
    render(<ForecastCard forecast={forecast()} scope="family" onNavigate={noop} />);
    const card = screen.getByTestId('card.forecast');
    // The LABEL names the LAST horizon month — the month the figure is about. A label naming the
    // first month beside a three-month figure is the "% of what?" problem one dimension over.
    expect(card.textContent).toContain('צפוי להישאר בסוף נובמבר');
    expect(screen.getByTestId('card.forecast.balance').textContent).toContain('12,400');
    expect(screen.getByTestId('card.forecast.verdict').textContent).toBe(BALANCE_VERDICT_LABEL_HE.positive);
    expect(screen.getByTestId('card.forecast.reference').textContent).toContain('48,000');
    expect(screen.getByTestId('card.forecast.committed').textContent).toContain('8,900');
    expect(screen.getByTestId('card.forecast.horizon').textContent).toBe('3 חודשים קדימה, מספטמבר');

    const order = ['card.forecast.balance', 'card.forecast.verdict', 'card.forecast.reference', 'card.forecast.committed', 'card.forecast.horizon'];
    const positions = order.map((id) => card.innerHTML.indexOf(`data-testid="${id}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('!! the NEGATIVE state is DESIGNED, not an absence — amber ground, a minus, and a WORD', () => {
    // The most important thing this card can ever render, and v1 never mentioned it. Colour is
    // never the only signal: the shortfall is stated in words and in shekels beside it.
    render(<ForecastCard forecast={forecast({ projectedBalanceILS: -3100 })} scope="family" onNavigate={noop} />);
    const card = screen.getByTestId('card.forecast');
    expect(card.className).toContain('bg-amber-50');
    expect(screen.getByTestId('card.forecast.balance').textContent).toContain('-');
    expect(screen.getByTestId('card.forecast.verdict').textContent).toBe('צפוי חוסר של ₪3,100.00');
    // NOT red. Red is the register this app uses for a failed read, and a shortfall three months
    // out is a thing to look at rather than an emergency.
    expect(card.className).not.toContain('bg-red');
  });

  it('the NEAR-ZERO state has its own word, so the neutral colour is not the only cue', () => {
    render(<ForecastCard forecast={forecast({ projectedBalanceILS: 40 })} scope="family" onNavigate={noop} />);
    expect(screen.getByTestId('card.forecast.verdict').textContent).toBe('כמעט מאוזן');
    expect(NEAR_ZERO_ILS).toBe(100);
  });

  it('!! the REFERENCE is ABSENT rather than ₪0 when nothing projects income', () => {
    // "₪0 never means unknown". A denominator of ₪0 answers "% of what?" with a number that is not
    // one, and the hook already refuses to invent it.
    render(
      <ForecastCard forecast={forecast({ projectedIncomeILS: null })} scope="family" onNavigate={noop} />
    );
    expect(screen.queryByTestId('card.forecast.reference')).toBeNull();
    expect(screen.getByTestId('card.forecast.balance')).toBeTruthy();
  });

  it('D32(a) — the clamp sentence renders only when the clamp actually fired', () => {
    const { rerender } = render(<ForecastCard forecast={forecast()} scope="family" onNavigate={noop} />);
    expect(screen.queryByTestId('card.forecast.clamped')).toBeNull();
    rerender(
      <ForecastCard
        forecast={forecast({ result: forecastResult({ anchorClamped: true }) })}
        scope="family"
        onNavigate={noop}
      />
    );
    expect(screen.getByTestId('card.forecast.clamped').textContent).toBe(FORECAST_ANCHOR_CLAMPED_HE);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D16/D17 — the gap, which is a PATH and not an apology
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D17/D26 — the named gap, and the glance position that still holds a number', () => {
  const dayOne = forecast({
    projectedBalanceILS: null,
    projectedIncomeILS: null,
    suppressed: ['accounts', 'incomes', 'recurring'],
  });

  it('!! NO FIGURE IS LABELLED AS THE BALANCE when the balance is null — the picture, not the string', () => {
    // D16 forbids a figure labelled `יתרה צפויה` when no balance could be computed. That is tested
    // as the ABSENCE OF THE FIGURE ELEMENT, because D17's own gap sentence legitimately contains
    // the phrase while saying the figure cannot be shown — a string search would have failed the
    // plan's own approved copy, which is the A21 defect (testing the string, not the picture).
    render(<ForecastCard forecast={dayOne} scope="family" onNavigate={noop} />);
    expect(screen.queryByTestId('card.forecast.balance')).toBeNull();
    expect(screen.queryByTestId('card.forecast.verdict')).toBeNull();
    expect(screen.getByTestId('card.forecast.gap').textContent).toContain('לא ניתן להציג יתרה צפויה');
  });

  it('!! the GLANCE POSITION HOLDS A NUMBER — the count of missing inputs, never ₪0 and never a caveat', () => {
    render(<ForecastCard forecast={dayOne} scope="family" onNavigate={noop} />);
    const glance = screen.getByTestId('card.forecast.gapCount');
    expect(glance.textContent).toBe('3');
    // …at the same type scale the figure would have had, so the card's shape does not collapse.
    expect(glance.className).toContain('text-2xl');
    expect(glance.className).toContain('md:text-3xl');
    // And no ₪0 anywhere on the card: "₪0 never means unknown".
    expect(screen.getByTestId('card.forecast').textContent).not.toContain('₪0.00');
  });

  it('the sentence and the list CANNOT DISAGREE — both come off the same array', () => {
    render(<ForecastCard forecast={dayOne} scope="family" onNavigate={noop} />);
    const sentence = screen.getByTestId('card.forecast.gap').textContent ?? '';
    expect(sentence).toContain('חסרים 3 נתונים');
    for (const key of ['accounts', 'incomes', 'recurring'] as const) {
      expect(sentence).toContain(FORECAST_INPUT_LABEL_HE[key]);
    }
  });

  it('!! every named gap is a PATH — it deep-links to the screen that creates the missing input', () => {
    const onNavigate = vi.fn();
    render(<ForecastCard forecast={dayOne} scope="family" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('card.forecast.gapLink.accounts'));
    expect(onNavigate).toHaveBeenCalledWith('accounts');
    fireEvent.click(screen.getByTestId('card.forecast.gapLink.recurring'));
    expect(onNavigate).toHaveBeenCalledWith('recurring');
  });

  it('!! `incomes` gets a NOTE and not a dead link, because the app has no incomes screen', () => {
    // finding 1.3.11 — `MODULE_REGISTRY` has no incomes tab at all. A link to nothing is worse than
    // no link, so the gap says where income IS edited: this very screen.
    render(<ForecastCard forecast={dayOne} scope="family" onNavigate={noop} />);
    expect(screen.queryByTestId('card.forecast.gapLink.incomes')).toBeNull();
    expect(screen.getByTestId('card.forecast.gapNote.incomes').textContent).toContain('לוח התצוגה');
    expect(FORECAST_INPUT_DESTINATION.incomes).toBeNull();
  });

  it('every OTHER input has a destination, so the note above is the exception and not the rule', () => {
    for (const [key, destination] of Object.entries(FORECAST_INPUT_DESTINATION)) {
      if (key === 'incomes') continue;
      expect(destination, key).not.toBeNull();
    }
  });

  it('the sentence agrees for ONE missing input too — the singular is a different Hebrew sentence', () => {
    render(
      <ForecastCard
        forecast={forecast({ projectedBalanceILS: null, suppressed: ['loans'] })}
        scope="family"
        onNavigate={noop}
      />
    );
    // !! THE VERB AGREES. `חסרים נתון אחד` — plural verb, singular noun — is what the first draft
    // of `balanceGapHe` rendered, because the verb sat outside the count word. This assertion is
    // what found it.
    expect(screen.getByTestId('card.forecast.gap').textContent).toContain('חסר נתון אחד');
    expect(screen.getByTestId('card.forecast.gap').textContent).not.toContain('חסרים נתון');
    expect(screen.getByTestId('card.forecast.gapCount').textContent).toBe('1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D38/D29(d) — the `'own'` card, which must NOT reuse the family slot
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("!! D38 — the `'own'` card is a different panel with opposite sign semantics", () => {
  it('!! it does NOT render into the family card`s panel', () => {
    render(<ForecastCard forecast={forecast()} scope="own" onNavigate={noop} />);
    // The single most dangerous misread in this stage: the family figure is money that will be
    // LEFT, this is money that will GO OUT, and the same number in the same place means opposite
    // things. Different testid, different panel, and an explicit prefix inside the glance line.
    expect(screen.queryByTestId('card.forecast')).toBeNull();
    expect(screen.getByTestId('card.forecast.own')).toBeTruthy();
  });

  it('!! v2.2/A1 — D38`s DIFFERENT-POSITION clause is struck, and the exclusivity is why', () => {
    // ── T7a-REVIEW F7, AND IT IS A DECLARED DEPARTURE RATHER THAN AN EDIT ──────────────────────
    //
    // D38 required the `'own'` card in a different POSITION — "below the family row, not in it".
    // The tree renders BOTH scopes into ONE slot and branches on `scope` inside the component, and
    // that claim lived in a code comment on `ForecastCard.tsx`. The review's ruling: the shipped
    // design is arguably BETTER than D38, WHICH IS EXACTLY WHY IT SHOULD HAVE BEEN DECLARED. It is
    // now declared, in the plan, at §v2.2 — and held here rather than in a comment, which is what
    // the comment was doing wrong in the first place.
    //
    // THE SUBSTANTIVE HALF: `forecastCardScopeOf` returns `'own' | 'family'` and the two are
    // MUTUALLY EXCLUSIVE BY CONSTRUCTION, so a reader never sees them adjacent — in any session,
    // on any account. Position only distinguishes things a reader can compare, and there is
    // nothing here to compare against. The three signals that DO carry the sign semantics are all
    // on the card, and all three are asserted in this block.
    for (const [scope, present, absent] of [
      ['own', 'card.forecast.own', 'card.forecast'],
      ['family', 'card.forecast', 'card.forecast.own'],
    ] as const) {
      const { unmount } = render(<ForecastCard forecast={forecast()} scope={scope} onNavigate={noop} />);
      expect(screen.getByTestId(present), scope).toBeTruthy();
      expect(screen.queryByTestId(absent), scope).toBeNull();
      unmount();
    }
    // …and there is exactly ONE slot on the Dashboard, so "different position" is not a property
    // anything on that screen could express. A second slot re-opens the departure, loudly.
    expect(dashboard.split('<ForecastCard').length - 1).toBe(1);
  });

  it('the label is part of the GLANCE LINE, not a caption above it', () => {
    render(<ForecastCard forecast={forecast()} scope="own" onNavigate={noop} />);
    const figure = screen.getByTestId('card.forecast.own.figure');
    expect(figure.textContent).toContain(FORECAST_OWN_OUTGOING_LABEL_HE);
    expect(figure.textContent).toContain('35,600');
    expect(figure.className).toContain('text-2xl');
  });

  it('carries the restricted-view badge AND the sentence that says what is missing', () => {
    render(<ForecastCard forecast={forecast()} scope="own" onNavigate={noop} />);
    expect(screen.getByTestId('card.forecast.own').textContent).toContain('מוצג: הנתונים שלך בלבד');
    expect(screen.getByTestId('card.forecast.own.noIncome').textContent).toBe(FORECAST_OWN_NO_INCOME_HE);
  });

  it('!! renders NO balance and NO income reference — D29(d), and not by accident', () => {
    render(<ForecastCard forecast={forecast()} scope="own" onNavigate={noop} />);
    expect(screen.queryByTestId('card.forecast.balance')).toBeNull();
    expect(screen.queryByTestId('card.forecast.reference')).toBeNull();
    expect(screen.getByTestId('card.forecast.own').textContent).not.toContain('48,000');
  });

  it('!! a personal target is NAMED, never SUBTRACTED from the outgoing figure', () => {
    render(
      <ForecastCard
        forecast={forecast({
          target: {
            status: 'target',
            source: 'personalTarget',
            amountILS: 3000,
            isFamilyScoped: false,
            goalsExcludedCount: 0,
            beyondHorizonCount: 0,
          },
        })}
        scope="own"
        onNavigate={noop}
      />
    );
    const target = screen.getByTestId('card.forecast.own.target');
    expect(target.textContent).toContain('יעד חיסכון אישי');
    expect(target.textContent).toContain('3,000');
    // The glance figure is untouched by the target: a savings target and a projected outgoing have
    // opposite shapes, and subtracting one from the other is the misread D29(d) forbids.
    expect(screen.getByTestId('card.forecast.own.figure').textContent).toContain('35,600');
  });

  it('suppresses its own figure by the OUTFLOW rule, with its own named gap', () => {
    render(
      <ForecastCard
        forecast={forecast({ projectedExpenseILS: null, suppressedOutflow: ['recurring', 'history'] })}
        scope="own"
        onNavigate={noop}
      />
    );
    expect(screen.queryByTestId('card.forecast.own.figure')).toBeNull();
    expect(screen.getByTestId('card.forecast.own.gapCount').textContent).toBe('2');
    expect(screen.getByTestId('card.forecast.own.gapLink.history')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The three non-figure states
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('loading, denied and error are three different panels', () => {
  it('a FAILED COMPUTATION is not a DENIAL — they send the family to different places', () => {
    render(<ForecastCard forecast={forecast({ status: 'error', result: null })} scope="family" onNavigate={noop} />);
    expect(screen.getByTestId('card.forecast.error')).toBeTruthy();
    expect(screen.queryByTestId('card.forecast.denied')).toBeNull();
  });

  it('a denial is a calm explanatory state and NOT a rebuke', () => {
    render(
      <ForecastCard forecast={forecast({ status: 'permission-denied', result: null })} scope="family" onNavigate={noop} />
    );
    const denied = screen.getByTestId('card.forecast.denied');
    expect(denied.textContent).toBe('אין גישה לנתונים שהתחזית מחושבת מהם');
    // A26/Ofra M3 — never "אין לך הרשאה", which reads as a rebuke to a child.
    expect(denied.textContent).not.toContain('לך');
  });

  it('loading renders a loading panel and no figure at all', () => {
    render(<ForecastCard forecast={forecast({ status: 'loading' })} scope="family" onNavigate={noop} />);
    expect(screen.getByTestId('card.forecast.loading')).toBeTruthy();
    expect(screen.queryByTestId('card.forecast.balance')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// !! THE SCALE DECISION, HELD AGAINST `Dashboard.tsx` ITSELF
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D38 — the forecast figure loses the scale contest DELIBERATELY', () => {
  it('net worth keeps the largest number on the Dashboard', () => {
    // Read from `Dashboard.tsx` rather than transcribed, so a future change to either side fails
    // here instead of quietly producing two co-equal glance numbers — which is not a hierarchy.
    expect(dashboard).toContain('text-3xl md:text-4xl font-bold');
  });

  it('and the forecast figure is exactly one step smaller', () => {
    render(<ForecastCard forecast={forecast()} scope="family" onNavigate={noop} />);
    const figure = screen.getByTestId('card.forecast.balance');
    expect(figure.className).toContain('text-2xl md:text-3xl font-bold');
    expect(figure.className).not.toContain('text-4xl');
    // `tabular-nums` so a changing figure does not reflow the card on every render.
    expect(figure.className).toContain('tabular-nums');
  });

  it('!! it wins by POSITION instead — the card sits directly beneath the net-worth block', () => {
    // The other half of the ruling, and the half a class name cannot carry. Asserted over
    // `Dashboard.tsx`'s source because the alternative — mounting the whole Dashboard with eight
    // Firestore listeners — tests the harness rather than the layout.
    const netWorthAt = dashboard.indexOf('data-tour-id="card.netWorth"');
    const forecastAt = dashboard.indexOf('<ForecastCard');
    const cashFlowAt = dashboard.indexOf('תזרים מזומנים חודשי');
    expect(netWorthAt).toBeGreaterThan(0);
    expect(forecastAt).toBeGreaterThan(netWorthAt);
    expect(forecastAt).toBeLessThan(cashFlowAt);
  });

  it('!! and it ships WITHOUT an open affordance — the tab lands in T7b', () => {
    // T7a says so explicitly: adding the tab here would either break `tsc --noEmit` (App.tsx's
    // exhaustive `never`) or point a live tab at nothing. The card states its figure and its gaps
    // and does not offer a link that goes nowhere.
    render(<ForecastCard forecast={forecast()} scope="family" onNavigate={noop} />);
    expect(screen.queryByTestId('drill-affordance')).toBeNull();
    expect(screen.getByTestId('card.forecast').querySelector('button')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D38's conditional colour rule
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// !! THE CONTRAST HALF OF THIS BLOCK HAS MOVED TO `ForecastCard.contrast.test.tsx`, AND T7a-REVIEW
// F4 IS WHY. Four assertions used to sit here, each calling `ratio()` on TOKEN STRINGS TRANSCRIBED
// INTO THIS FILE — `ratio('teal-700', 'white')`, `ratio('amber-800', 'amber-50')`. They proved that
// the installed Tailwind theme pairs those colours legibly, which is true and is not a fact about
// this component: `VERDICT_CLASS.negative → 'text-red-600'` and `VERDICT_CLASS.positive →
// 'text-slate-400'` both survived them, because no literal in the test moved.
//
// They are NOT kept here beside the new file. Two guards over one claim, one of them shadowed, is
// the exact shape the moved guard exists to close, and the copy left behind would be the weaker
// one. The new file renders the card and measures what it renders, in all nine states.
//
// What stays here is the half that is about SIGNALS rather than luminance.

describe('!! D38 — colour is never the only signal', () => {
  it('!! the WORD is present in every state, so colour is never the only signal', () => {
    for (const [balance, expected] of [
      [12400, BALANCE_VERDICT_LABEL_HE.positive],
      [40, BALANCE_VERDICT_LABEL_HE['near-zero']],
    ] as const) {
      const { unmount } = render(
        <ForecastCard forecast={forecast({ projectedBalanceILS: balance })} scope="family" onNavigate={noop} />
      );
      expect(screen.getByTestId('card.forecast.verdict').textContent).toBe(expected);
      unmount();
    }
    render(<ForecastCard forecast={forecast({ projectedBalanceILS: -3100 })} scope="family" onNavigate={noop} />);
    expect(screen.getByTestId('card.forecast.verdict').textContent).toContain(
      BALANCE_VERDICT_LABEL_HE.negative
    );
  });
});
