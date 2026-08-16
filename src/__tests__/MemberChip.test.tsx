import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberChip } from '../components/MemberChip';

describe('MemberChip', () => {
  it('renders the name and a color dot', () => {
    render(<MemberChip name="עומר" color="#1F4E78" />);
    expect(screen.getByText('עומר')).toBeInTheDocument();
  });
  it('renders as a static span with no onClick (not interactive when not needed)', () => {
    render(<MemberChip name="עומר" color="#1F4E78" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('renders as a clickable button and fires onClick when one is given', () => {
    const onClick = vi.fn();
    render(<MemberChip name="עומר" color="#1F4E78" onClick={onClick} selected />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
