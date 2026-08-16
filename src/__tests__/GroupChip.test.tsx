import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupChip } from '../components/GroupChip';

describe('GroupChip', () => {
  it('renders the name and the member count', () => {
    render(<GroupChip name="הילדים" memberCount={3} />);
    expect(screen.getByText('הילדים')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('renders as a static span with no onClick', () => {
    render(<GroupChip name="הילדים" memberCount={3} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the amount only when provided', () => {
    const { rerender } = render(<GroupChip name="הילדים" memberCount={3} />);
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();

    rerender(<GroupChip name="הילדים" memberCount={3} amount={500} />);
    expect(screen.getByText(/₪500/)).toBeInTheDocument();
  });

  it('renders as a clickable button and fires onClick when one is given', () => {
    const onClick = vi.fn();
    render(<GroupChip name="הילדים" memberCount={3} onClick={onClick} selected />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
