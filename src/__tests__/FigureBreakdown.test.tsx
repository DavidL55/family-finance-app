// src/__tests__/FigureBreakdown.test.tsx — Stage 8 S1. The accordion under a composite figure.
//
// David's rule 2 (spec 2026-08-29-glanceable-screens): a figure that is a SUM opens in place to
// show its components; a figure with nothing to break down renders as a plain figure — never a
// dead accordion. Interaction is a real <button> (keyboard + touch, not hover-only — Ofra).
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FigureBreakdown } from '../components/FigureBreakdown';
import { formatILS } from '../config/money';

const ITEMS = [
  { label: 'משכורת לילית', amountILS: 12294 },
  { label: 'העברת מייסדים אניצ\'אי', amountILS: 10000 },
  { label: 'קצבת ילדים', amountILS: 173 },
];

function renderOne(items = ITEMS) {
  return render(
    <FigureBreakdown id="test.income" figure={<span>₪22,467</span>} items={items} />
  );
}

describe('FigureBreakdown — הערסל מתחת למספר', () => {
  it('closed by default: the figure shows, the components do not', () => {
    renderOne();
    expect(screen.getByText('₪22,467')).toBeTruthy();
    expect(screen.queryByText('משכורת לילית')).toBeNull();
    expect(screen.getByRole('button', { name: /₪22,467/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('click opens: every component with its formatted amount; click again closes', () => {
    renderOne();
    const btn = screen.getByRole('button', { name: /₪22,467/ });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('משכורת לילית')).toBeTruthy();
    // formatILS spelling, with tabular alignment — the project's one money formatter
    expect(screen.getByText('₪12,294.00')).toBeTruthy();
    expect(screen.getByText('₪10,000.00')).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('משכורת לילית')).toBeNull();
  });

  it('items are sorted largest first — the reader sees what dominates the number', () => {
    renderOne([
      { label: 'קטן', amountILS: 5 },
      { label: 'גדול', amountILS: 500 },
      { label: 'בינוני', amountILS: 50 },
    ]);
    fireEvent.click(screen.getByRole('button'));
    const labels = screen.getAllByTestId('breakdown.item.label').map((e) => e.textContent);
    expect(labels).toEqual(['גדול', 'בינוני', 'קטן']);
  });

  it('EMPTY items: a plain figure, NO button role — never a dead accordion', () => {
    renderOne([]);
    expect(screen.getByText('₪22,467')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a negative component renders as a credit, sign visible', () => {
    renderOne([{ label: 'זיכוי', amountILS: -150 }, { label: 'חיוב', amountILS: 300 }]);
    fireEvent.click(screen.getByRole('button'));
    // he-IL inserts an invisible LTR mark before the minus, so the assertion goes through the
    // app's ONE formatter rather than a hand-typed literal that can never match it.
    expect(screen.getByText(formatILS(-150))).toBeTruthy();
  });
});

describe('FigureBreakdown — footer link', () => {
  it('renders the footer inside the OPEN panel only — the drill link moves into the accordion', () => {
    render(
      <FigureBreakdown
        id="test.expenses"
        figure={<span>₪12,000</span>}
        items={[{ label: 'מזון', amountILS: 12000 }]}
        footer={<a href="#all">לכל הפירוט</a>}
      />
    );
    expect(screen.queryByText('לכל הפירוט')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /₪12,000/ }));
    expect(screen.getByText('לכל הפירוט')).toBeTruthy();
  });
});

describe('FigureBreakdown — empty items WITH a footer', () => {
  it('keeps the footer link reachable inline — an empty month must not orphan the drill path (D8)', () => {
    render(
      <FigureBreakdown id="test.empty" figure={<span>₪0</span>} items={[]}
        footer={<a href="#all">לכל הפירוט</a>} />
    );
    // no accordion for nothing…
    expect(screen.queryByRole('button', { name: /₪0/ })).toBeNull();
    // …but the path to the full screen survives, visible immediately
    expect(screen.getByText('לכל הפירוט')).toBeTruthy();
  });
});
