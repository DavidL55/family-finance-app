// Stage 5 Task 5 — NetWorthScreen. useNetWorth is mocked directly (its own suite covers the real
// fetch/compute logic) so this stays a focused unit test of the screen's own render branches,
// scope derivation, and D8 drill-down wiring.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NetWorthScreen from '../components/NetWorthScreen';
import type { NetWorthResult } from '../utils/netWorth';

const { mockUseNetWorth, mockNavigateTo } = vi.hoisted(() => ({
  mockUseNetWorth: vi.fn(),
  mockNavigateTo: vi.fn(),
}));
vi.mock('../hooks/useNetWorth', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useNetWorth')>('../hooks/useNetWorth');
  return { ...actual, useNetWorth: mockUseNetWorth };
});
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigateTo: mockNavigateTo }),
}));

let mockMemberFilter: { mode: 'all' } | { mode: 'members'; memberIds: string[]; groupId: null } = { mode: 'all' };
vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: () => ({ filters: { member: mockMemberFilter } }),
}));

const READY_RESULT: NetWorthResult = {
  scope: 'family',
  assets: [
    { label: 'חשבונות ומזומן', amount: 10000, source: 'accounts', asOf: 'x' },
    { label: 'השקעות ופנסיה', amount: 5000, source: 'investments', asOf: 'x' },
    { label: 'נדל״ן', amount: 2000000, source: 'realEstate', asOf: 'x' },
  ],
  liabilities: [{ label: 'הלוואות וחובות', amount: 800000, source: 'loans', asOf: 'x' }],
  totalAssets: 2015000,
  totalLiabilities: 800000,
  netWorth: 1215000,
  computedAt: 'x',
};

function baseHookState(overrides: Partial<ReturnType<typeof mockUseNetWorth>> = {}) {
  return {
    status: 'ready',
    result: READY_RESULT,
    error: null,
    accountsCount: 1,
    loansCount: 1,
    isIncomplete: false,
    legacyCashHint: null,
    legacyMortgageHint: null,
    reload: vi.fn(),
    ...overrides,
  };
}

const SESSION = { memberId: 'david-levy', role: 'super-admin' as const };

describe('NetWorthScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemberFilter = { mode: 'all' };
  });

  it('loading state renders before the hook resolves', () => {
    mockUseNetWorth.mockReturnValue(baseHookState({ status: 'loading', result: null }));
    render(
      <NetWorthScreen
        session={SESSION}
        accountsViewLevel="family"
        loansViewLevel="family"
        investmentsViewLevel="family"
      />
    );
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('permission-denied renders the calm access message, never the red error banner (S2)', () => {
    mockUseNetWorth.mockReturnValue(baseHookState({ status: 'permission-denied', result: null }));
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel={undefined} loansViewLevel={undefined} investmentsViewLevel={undefined} />
    );
    expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument();
  });

  it('a load failure renders the explicit error message', () => {
    mockUseNetWorth.mockReturnValue(baseHookState({ status: 'error', result: null, error: 'טעינה נכשלה' }));
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(screen.getByText('טעינה נכשלה')).toBeInTheDocument();
  });

  it('renders the headline net worth and the totals pills once ready', () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(screen.getByText('₪1,215,000')).toBeInTheDocument();
    expect(screen.getByText(/נכסים: ₪2,015,000/)).toBeInTheDocument();
    expect(screen.getByText(/חובות: ₪800,000/)).toBeInTheDocument();
  });

  it('clicking the accounts line navigates to the accounts screen (D8 drill-down)', async () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    await waitFor(() => screen.getByText('חשבונות ומזומן'));
    fireEvent.click(screen.getByText('חשבונות ומזומן'));
    expect(mockNavigateTo).toHaveBeenCalledWith('accounts');
  });

  it('clicking the investments line navigates to the investments screen (D8 drill-down)', async () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    await waitFor(() => screen.getByText('השקעות ופנסיה'));
    fireEvent.click(screen.getByText('השקעות ופנסיה'));
    expect(mockNavigateTo).toHaveBeenCalledWith('investments');
  });

  it('clicking the loans line navigates to the loans screen (D8 drill-down)', async () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    await waitFor(() => screen.getByText('הלוואות וחובות'));
    fireEvent.click(screen.getByText('הלוואות וחובות'));
    expect(mockNavigateTo).toHaveBeenCalledWith('loans');
  });

  it('the real-estate line has no click handler — no screen exists for it yet (disclosed, not fake-clickable)', async () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    await waitFor(() => screen.getByText('נדל״ן'));
    expect(screen.getByText('נדל״ן').closest('button')).toBeNull();
  });

  it('renders NetWorthIncompleteNotice when useNetWorth reports isIncomplete (B1 fix)', async () => {
    mockUseNetWorth.mockReturnValue(
      baseHookState({ isIncomplete: true, legacyCashHint: { bucket: 'liquid', value: 42000 } })
    );
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    await waitFor(() => expect(screen.getByText(/מצאנו ₪/)).toBeInTheDocument());
  });

  it('does NOT render NetWorthIncompleteNotice content when isIncomplete is false', () => {
    mockUseNetWorth.mockReturnValue(baseHookState({ isIncomplete: false }));
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(screen.queryByText(/מצאנו ₪/)).not.toBeInTheDocument();
  });

  it('renders the ScopeBadge when exactly one member is selected in the global filter (own scope)', async () => {
    mockMemberFilter = { mode: 'members', memberIds: ['omer-levy'], groupId: null };
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    await waitFor(() => expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument());
  });

  it('does NOT render the ScopeBadge when the member filter is "all" and the viewer has family-level access', () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(screen.queryByText('מוצג: הנתונים שלך בלבד')).not.toBeInTheDocument();
  });

  it('every rendered line carries its own <Explain> trigger (spec "כל מספר")', () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    const { container } = render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(container.querySelector('[data-tour-id="explain.netWorth.assets.accounts"]')).toBeTruthy();
    expect(container.querySelector('[data-tour-id="explain.netWorth.assets.investments"]')).toBeTruthy();
    expect(container.querySelector('[data-tour-id="explain.netWorth.assets.realEstate"]')).toBeTruthy();
    expect(container.querySelector('[data-tour-id="explain.netWorth.liabilities.loans"]')).toBeTruthy();
    expect(container.querySelector('[data-tour-id="explain.dashboard.netWorth"]')).toBeTruthy();
  });

  it('data-tour-id is present on the list container', () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    const { container } = render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(container.querySelector('[data-tour-id="screen.net-worth.list"]')).not.toBeNull();
  });

  it('calls useNetWorth with scope "own" and the selected member id when exactly one member is selected (D3)', () => {
    mockMemberFilter = { mode: 'members', memberIds: ['omer-levy'], groupId: null };
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(mockUseNetWorth).toHaveBeenCalledWith('own', 'omer-levy', true);
  });

  it('calls useNetWorth with scope "family" and the viewer\'s own id when the whole family has family-level access and nobody specific is selected', () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen session={SESSION} accountsViewLevel="family" loansViewLevel="family" investmentsViewLevel="family" />
    );
    expect(mockUseNetWorth).toHaveBeenCalledWith('family', 'david-levy', true);
  });

  it("investmentsReadable is false for a 'member' role without a family-level investments grant", () => {
    mockUseNetWorth.mockReturnValue(baseHookState());
    render(
      <NetWorthScreen
        session={{ memberId: 'omer-levy', role: 'member' }}
        accountsViewLevel="own"
        loansViewLevel="own"
        investmentsViewLevel="own"
      />
    );
    expect(mockUseNetWorth).toHaveBeenCalledWith('own', 'omer-levy', false);
  });
});
