import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NetWorthIncompleteNotice } from '../components/NetWorthIncompleteNotice';

const { mockNavigateTo } = vi.hoisted(() => ({ mockNavigateTo: vi.fn() }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ navigateTo: mockNavigateTo }) }));

describe('NetWorthIncompleteNotice (D3 amendment — B1/P2)', () => {
  it('offers a pre-fill-and-open-Accounts button when a legacy cash hint exists', () => {
    render(<NetWorthIncompleteNotice legacyCashHint={{ bucket: 'liquid', value: 42000 }} legacyMortgageHint={null} />);
    expect(screen.getByText(/מצאנו ₪42,000 ביתרת המזומן הישנה/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('להוסיף כחשבון?'));
    expect(mockNavigateTo).toHaveBeenCalledWith('accounts', {
      prefillCreate: { name: 'מזומן (מיובא)', type: 'cash', balance: 42000 },
    });
  });
  it('offers a pre-fill-and-open-Loans button when a legacy mortgage hint exists', () => {
    render(<NetWorthIncompleteNotice legacyCashHint={null} legacyMortgageHint={{ bucket: 'mortgage', value: 900000 }} />);
    fireEvent.click(screen.getByText('להוסיף כהלוואה?'));
    expect(mockNavigateTo).toHaveBeenCalledWith('loans', {
      prefillCreate: { name: 'משכנתא (מיובא)', loanType: 'mortgage', principal: 900000, balance: 900000 },
    });
  });
  it('renders nothing when neither hint exists (both collections empty but nothing legacy to offer, or both already populated)', () => {
    const { container } = render(<NetWorthIncompleteNotice legacyCashHint={null} legacyMortgageHint={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders both hints together when both a cash and a mortgage hint exist', () => {
    render(
      <NetWorthIncompleteNotice
        legacyCashHint={{ bucket: 'liquid', value: 10000 }}
        legacyMortgageHint={{ bucket: 'mortgage', value: 500000 }}
      />
    );
    expect(screen.getByText('להוסיף כחשבון?')).toBeInTheDocument();
    expect(screen.getByText('להוסיף כהלוואה?')).toBeInTheDocument();
  });
});
