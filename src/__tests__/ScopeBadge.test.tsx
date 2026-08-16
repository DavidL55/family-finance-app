import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScopeBadge } from '../components/ScopeBadge';

describe('ScopeBadge (D14/I5)', () => {
  it('renders the restricted-view pill when scope is "own"', () => {
    render(<ScopeBadge scope="own" />);
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
  });
  it('renders nothing for "family"', () => {
    const { container } = render(<ScopeBadge scope="family" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing for "none"', () => {
    const { container } = render(<ScopeBadge scope="none" />);
    expect(container).toBeEmptyDOMElement();
  });
});
