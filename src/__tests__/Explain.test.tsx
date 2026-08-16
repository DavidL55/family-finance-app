import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Explain } from '../components/Explain';

describe('Explain', () => {
  it('renders an always-present, always-clickable ⓘ trigger for a known id', () => {
    render(<Explain id="dashboard.totalIncome" />);
    expect(screen.getByRole('button', { name: /הסבר/ })).toBeInTheDocument();
  });
  it('renders nothing for an unknown id (never a broken info button)', () => {
    const { container } = render(<Explain id="nonexistent.id" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('clicking the trigger opens the card WITHOUT any hover (mobile/tap path)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('סך הכנסות');
  });
  it('clicking again closes it (toggle)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('hover opens it on its own, without any click (desktop path)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
  it('a click-pinned card stays open after the mouse leaves', () => {
    render(<Explain id="dashboard.totalIncome" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.mouseLeave(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
  it('Escape closes an open card', () => {
    render(<Explain id="dashboard.totalIncome" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  // Ofra ruling — the ⓘ glyph itself is small, but its tap target must not be (WCAG-adjacent
  // "don't make people aim precisely on mobile" concern, same convention Dashboard's other icon
  // buttons already use, e.g. the manage-members button: min-w-[44px] min-h-[44px]).
  it('the trigger has a >=44x44 hit area even though the glyph is small', () => {
    render(<Explain id="dashboard.totalIncome" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/min-w-\[44px\]/);
    expect(btn.className).toMatch(/min-h-\[44px\]/);
  });
  // D12 — Stage 10's guided tour needs a stable selector per glossary id.
  it('carries a stable data-tour-id for the Stage 10 guided tour (D12)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    expect(screen.getByRole('button')).toHaveAttribute('data-tour-id', 'explain.dashboard.totalIncome');
  });
});
