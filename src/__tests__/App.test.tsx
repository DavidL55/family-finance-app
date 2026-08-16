// Controller addition (Task 3 review, folded into Task 4 since App.tsx is already open here for
// the FilterBar mount): NavigationContext.navigateTo(tabId: string) accepts any string, and
// renderContent dispatched purely on activeTab with NO isModuleVisible recheck — permission
// gating only ever existed on the nav BUTTONS, not the render entry point itself. Not exploitable
// today (every current call site passes an id already drawn from the filtered `tabs` array, and
// firestore.rules deny the underlying reads regardless), but Stage 8's insight deep-links and
// Stage 10's guided tours are explicitly designed to call navigateTo programmatically with
// arbitrary ids — this is what closes the gap before either exists.
//
// Every heavy screen/service this file doesn't care about is stubbed so this stays a focused test
// of renderContent's visibility guard, not an integration test of the whole app.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationProvider } from '../contexts/NotificationContext';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';
import type { AuthSession } from '../hooks/useAuthSession';
import type { ResolvedPermissionsState } from '../hooks/useResolvedPermissions';

const { mockUseAuthSession, mockUseResolvedPermissions } = vi.hoisted(() => ({
  mockUseAuthSession: vi.fn(),
  mockUseResolvedPermissions: vi.fn(),
}));

vi.mock('../hooks/useAuthSession', () => ({
  useAuthSession: mockUseAuthSession,
  signOutCurrentUser: vi.fn(),
}));
vi.mock('../hooks/useResolvedPermissions', () => ({ useResolvedPermissions: mockUseResolvedPermissions }));
vi.mock('../hooks/useRecurringCatchup', () => ({ useRecurringCatchup: vi.fn() }));
vi.mock('../services/MembersService', () => ({ ensureSeeded: vi.fn(async () => undefined) }));

// FilterBar/FilterActiveBadge/FilterProvider are Task 4's own well-tested units (see
// FilterBar.test.tsx, FilterActiveBadge.test.tsx, FilterContext.test.tsx) — stubbed here so this
// file stays scoped to the renderContent visibility guard.
vi.mock('../contexts/FilterContext', () => ({
  FilterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/FilterBar', () => ({ default: () => <div data-testid="filter-bar-stub" /> }));
vi.mock('../components/FilterActiveBadge', () => ({ FilterActiveBadge: () => null }));

vi.mock('../components/LoginScreen', () => ({ default: () => <div data-testid="login-screen" /> }));
vi.mock('../components/Dashboard', () => ({ default: () => <div data-testid="dashboard-screen" /> }));
vi.mock('../components/FolderLogic', () => ({ default: () => <div data-testid="folder-screen" /> }));
vi.mock('../components/ExpensesBreakdown', () => ({ default: () => <div data-testid="expenses-screen" /> }));
vi.mock('../components/FuturePlanning', () => ({ default: () => <div data-testid="future-screen" /> }));
vi.mock('../components/InvestmentsPortfolio', () => ({ default: () => <div data-testid="investments-screen" /> }));
vi.mock('../components/CentralExpenseReport', () => ({ default: () => <div data-testid="central-expenses-screen" /> }));
vi.mock('../components/AnnualReport', () => ({ default: () => <div data-testid="annual-screen" /> }));
vi.mock('../components/SyncButton', () => ({ default: () => <div data-testid="sync-button-stub" /> }));
vi.mock('../components/PermissionsManager', () => ({ default: () => <div data-testid="permissions-screen" /> }));

import App from '../App';

function readySession(overrides: Partial<AuthSession> = {}): AuthSession {
  return { status: 'ready', user: null, role: 'member', memberId: 'omer', error: null, ...overrides };
}

function permState(overrides: Partial<ResolvedPermissionsState> = {}): ResolvedPermissionsState {
  return { status: 'ready', resolvedPermissions: {}, error: null, retry: vi.fn(), ...overrides };
}

// Renders App alongside a harness that can call navigateTo directly — simulating Stage 8/10's
// programmatic deep-link/guided-tour call sites, which bypass the nav buttons' own visibility
// filtering entirely (exactly the gap this test targets).
function Harness() {
  const { navigateTo } = useNavigation();
  return (
    <>
      <button data-testid="deep-link-investments" onClick={() => navigateTo('investments')}>go-investments</button>
      <button data-testid="deep-link-expenses" onClick={() => navigateTo('expenses')}>go-expenses</button>
      <App />
    </>
  );
}

function renderApp() {
  return render(
    <NotificationProvider>
      <NavigationProvider>
        <Harness />
      </NavigationProvider>
    </NotificationProvider>
  );
}

describe('App renderContent — permission recheck at the render entry point (controller ruling)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // D11 — NavigationProvider now backs activeTab with the real browser History API, which
    // (unlike a plain useState) persists across tests within this jsdom instance unless reset.
    window.history.replaceState(null, '');
  });

  it('navigateTo("investments") for a member with no investments grant does NOT mount the investments screen', async () => {
    mockUseAuthSession.mockReturnValue(readySession());
    mockUseResolvedPermissions.mockReturnValue(
      permState({ resolvedPermissions: { expenses: { view: 'family', edit: 'none' } } })
    );
    renderApp();
    fireEvent.click(screen.getByTestId('deep-link-investments'));
    await waitFor(() => expect(screen.queryByTestId('investments-screen')).not.toBeInTheDocument());
    // S2 ruling: a permission refusal is a calm access message, never an error banner and never a
    // silently-blank screen.
    expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument();
  });

  it('a permitted module still mounts normally after navigateTo', async () => {
    mockUseAuthSession.mockReturnValue(readySession());
    mockUseResolvedPermissions.mockReturnValue(
      permState({ resolvedPermissions: { expenses: { view: 'family', edit: 'none' } } })
    );
    renderApp();
    fireEvent.click(screen.getByTestId('deep-link-expenses'));
    await waitFor(() => expect(screen.getByTestId('expenses-screen')).toBeInTheDocument());
  });

  it('super-admin/parent bypass the recheck entirely, same as the nav buttons do', async () => {
    mockUseAuthSession.mockReturnValue(readySession({ role: 'super-admin' }));
    mockUseResolvedPermissions.mockReturnValue(permState());
    renderApp();
    fireEvent.click(screen.getByTestId('deep-link-investments'));
    await waitFor(() => expect(screen.getByTestId('investments-screen')).toBeInTheDocument());
  });

  it('ungated modules (e.g. dashboard) are unaffected by the guard', () => {
    mockUseAuthSession.mockReturnValue(readySession());
    mockUseResolvedPermissions.mockReturnValue(permState());
    renderApp();
    expect(screen.getByTestId('dashboard-screen')).toBeInTheDocument();
  });
});

// D11 — a header back button (real NavigationProvider, not a mock, since this IS the back-stack
// integration point) appears whenever canGoBack, and clicking it returns to the origin screen.
describe('App header back button (D11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '');
  });

  it('is absent on the initial screen, appears after one navigateTo, and returns to the origin on click', async () => {
    mockUseAuthSession.mockReturnValue(readySession());
    mockUseResolvedPermissions.mockReturnValue(
      permState({ resolvedPermissions: { expenses: { view: 'family', edit: 'none' } } })
    );
    renderApp();
    expect(screen.queryByLabelText('חזרה')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('deep-link-expenses'));
    await waitFor(() => expect(screen.getByTestId('expenses-screen')).toBeInTheDocument());
    expect(screen.getByLabelText('חזרה')).toBeInTheDocument();

    // canGoBack is a `history.length > 1` approximation (D11), not a precise "is there really
    // somewhere left to go" — it deliberately does not need to flip back to false once the app's
    // very first back-eligible navigation has happened in this session; that's the History API's
    // own limitation, not a regression to assert against here.
    fireEvent.click(screen.getByLabelText('חזרה'));
    await waitFor(() => expect(screen.getByTestId('dashboard-screen')).toBeInTheDocument());
  });
});
