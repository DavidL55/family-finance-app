// D7 — a shared member-chip identity picker, NOT a bare <select>. The Stage 5 controller's binding
// requirement (task-3 dispatch) overrides the plan's own illustrative snippet, which sketched a
// bare <select>: "a bare select loses the color/identity system the rest of the app trained users
// on" (MemberChip — see MemberMultiSelect.tsx's identical reuse of the same primitive). These
// tests assert the chip-based contract, not the snippet's select-based one.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OwnerPicker } from '../components/OwnerPicker';

const members = [
  { id: 'david-levy', name: 'דויד', color: '#111', role: 'הורה', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'omer-levy', name: 'עומר', color: '#222', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' },
] as any[];

describe('OwnerPicker (D7)', () => {
  it("editLevel 'own': renders a fixed, non-interactive chip naming the acting member — no select, no clickable chip", () => {
    render(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="own" actingMemberId="omer-levy" />);
    expect(screen.getByText('עומר')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it("editLevel 'family': renders a chip per member; the current value's chip is marked selected", () => {
    render(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="family" actingMemberId="david-levy" />);
    expect(screen.getByRole('button', { name: /עומר/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /דויד/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it("editLevel 'family': clicking a different member's chip calls onChange with their id", () => {
    const onChange = vi.fn();
    render(<OwnerPicker members={members} value="omer-levy" onChange={onChange} editLevel="family" actingMemberId="david-levy" />);
    fireEvent.click(screen.getByRole('button', { name: /דויד/ }));
    expect(onChange).toHaveBeenCalledWith('david-levy');
  });

  it("editLevel 'none': renders the fixed chip, no interactive chips (matches 'own' — read-only either way)", () => {
    render(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="none" actingMemberId="omer-levy" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('the picker is labelled בעלים for accessibility, in both read-only and interactive shapes', () => {
    const { rerender } = render(
      <OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="own" actingMemberId="omer-levy" />
    );
    expect(screen.getByText('בעלים')).toBeInTheDocument();
    rerender(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="family" actingMemberId="david-levy" />);
    expect(screen.getByText('בעלים')).toBeInTheDocument();
  });
});
