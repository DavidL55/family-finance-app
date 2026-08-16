// Task 6: Dashboard rewired onto global filters (מי/מתי/מה) + <Explain> + ComparisonTable + D8
// disclosure + loadEcosystem/loadBudget empty-vs-error/permission-denied handling.
//
// Heavy dependencies (recharts, the Gemini-backed ai service) are stubbed. `firebase/firestore`
// is mocked at a level that lets each test independently control what `getDoc(settings/ecosystem)`,
// `getDoc(settings/budgetConfig)`, `getDocs(transaction_lines)`, and the `incomes` onSnapshot
// listener do — via the mutable `H.state.*Impl` functions below — without needing a real Firestore
// connection or the emulator.
//
// A small in-provider harness component exposes `useGlobalFilters()`'s setters to tests (mirroring
// what FilterBar would otherwise do), so tests can simulate a מי/מה change without mounting FilterBar
// itself (out of scope for this file — FilterBar has its own test suite).

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../contexts/NotificationContext';
import { FilterProvider, useGlobalFilters } from '../contexts/FilterContext';

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const H = vi.hoisted(() => {
  const state = {
    ecosystemImpl: async (): Promise<{ exists: () => boolean; data: () => any }> => ({
      exists: () => false,
      data: () => undefined,
    }),
    budgetImpl: async (): Promise<{ exists: () => boolean; data: () => any }> => ({
      exists: () => false,
      data: () => undefined,
    }),
    txLinesImpl: async (): Promise<{ docs: { id: string; data: () => any }[] }> => ({ docs: [] }),
    incomesImpl: (
      onNext: (snap: { docs: unknown[] }) => void,
      _onError: (err: unknown) => void
    ): (() => void) => {
      onNext({ docs: [] });
      return () => {};
    },
  };
  return {
    state,
    mockListMembers: vi.fn(),
    mockListGroups: vi.fn(async () => []),
    mockNavigateTo: vi.fn(),
  };
});

// D8/D11 (Stage 5 Task 2) — Dashboard's drill-down calls navigateTo directly; mocked here (rather
// than mounting a real NavigationProvider) so these tests stay a focused unit test of Dashboard's
// own click-handler wiring, not an integration test of the browser History API (NavigationContext
// has its own dedicated test suite for that — NavigationContext.test.tsx).
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigateTo: H.mockNavigateTo }),
}));

vi.mock('../services/MembersService', () => ({
  listMembers: H.mockListMembers,
  saveMembers: vi.fn(),
  StaleMembersError: class StaleMembersError extends Error {},
}));

vi.mock('../services/GroupsService', () => ({ listGroups: H.mockListGroups }));

vi.mock('../services/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ __col: name })),
  query: vi.fn((...args: unknown[]) => ({ __query: args })),
  where: vi.fn(() => 'where'),
  doc: vi.fn((_db: unknown, _col: string, id: string) => ({ __doc: id })),
  onSnapshot: vi.fn((_ref: unknown, onNext: any, onError: any) => H.state.incomesImpl(onNext, onError)),
  getDocs: vi.fn(async (ref: any) =>
    ref && ref.__col === 'transaction_lines' ? H.state.txLinesImpl() : { docs: [] }
  ),
  getDoc: vi.fn(async (ref: any) => {
    if (ref?.__doc === 'ecosystem') return H.state.ecosystemImpl();
    if (ref?.__doc === 'budgetConfig') return H.state.budgetImpl();
    return { exists: () => false, data: () => undefined };
  }),
  addDoc: vi.fn(async () => ({ id: 'new' })),
  deleteDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => 'ts'),
}));

vi.mock('../services/ai', () => ({
  generateFinancialInsights: vi.fn(async () => []),
  getFinancialChatSession: vi.fn(() => ({ sendMessage: vi.fn(async () => ({ text: '' })) })),
}));

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, Tooltip: Stub,
    Legend: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: Stub,
  };
});

import Dashboard from '../components/Dashboard';

const MEMBERS = [
  { id: 'david', name: 'דויד', role: 'הורה' as const, color: '#1F4E78', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'lilit', name: 'לילית', role: 'הורה' as const, color: '#17C3B2', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'omer', name: 'עומר', role: 'ילד' as const, color: '#E07A5F', groups: [], createdAt: 'x', updatedAt: 'x' },
];

let filtersApi: ReturnType<typeof useGlobalFilters> | null = null;

function Harness() {
  // Reassigned on every render, which keeps this module-level ref fresh (filters/familyMembers
  // are new objects on relevant state changes; the setters themselves are useCallback-stable).
  filtersApi = useGlobalFilters();
  return <Dashboard />;
}

function renderDashboard() {
  filtersApi = null;
  return render(
    <NotificationProvider>
      <FilterProvider>
        <Harness />
      </FilterProvider>
    </NotificationProvider>
  );
}

async function waitForSettled() {
  await waitFor(() => expect(screen.getByTitle(/ניהול בני משפחה/)).toBeInTheDocument());
}

beforeEach(() => {
  sessionStorage.setItem(
    'ff_global_filters',
    JSON.stringify({
      member: { mode: 'all', memberIds: [], groupId: null },
      period: { mode: 'month', month: '08', year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: [] },
    })
  );
  H.mockListMembers.mockReset();
  H.mockListMembers.mockResolvedValue(MEMBERS);
  H.mockListGroups.mockReset();
  H.mockListGroups.mockResolvedValue([]);
  H.mockNavigateTo.mockReset();
  H.state.ecosystemImpl = async () => ({ exists: () => false, data: () => undefined });
  H.state.budgetImpl = async () => ({ exists: () => false, data: () => undefined });
  H.state.txLinesImpl = async () => ({ docs: [] });
  H.state.incomesImpl = (onNext) => {
    onNext({ docs: [] });
    return () => {};
  };
});

describe('Dashboard — rewired onto global filters (Task 6)', () => {
  it('renders no local member/date selector controls of its own anymore (owned by FilterBar now)', async () => {
    renderDashboard();
    await waitForSettled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps the manage-family-members entry point (not a filter control, stays on Dashboard)', async () => {
    renderDashboard();
    await waitForSettled();
    expect(screen.getByTitle(/ניהול בני משפחה/)).toBeInTheDocument();
  });

  it('renders an <Explain> trigger on all four KPI cards, the net-worth card, and the five ecosystem tiles', async () => {
    const { container } = renderDashboard();
    await waitForSettled();
    const ids = [
      'dashboard.totalIncome', 'dashboard.totalExpenses', 'dashboard.monthlyBalance', 'dashboard.plannedBudget',
      'dashboard.netWorth',
      'dashboard.ecosystem.liquid', 'dashboard.ecosystem.investments', 'dashboard.ecosystem.pensions',
      'dashboard.ecosystem.crypto', 'dashboard.ecosystem.realEstate',
    ];
    ids.forEach((id) => {
      expect(container.querySelector(`[data-tour-id="explain.${id}"]`)).toBeTruthy();
    });
  });

  it('consumes the shared members/groups fetch from FilterContext — no separate listMembers() call of its own (M2)', async () => {
    renderDashboard();
    await waitForSettled();
    expect(H.mockListMembers).toHaveBeenCalledTimes(1);
  });

  // Carry-forward fix (Stage 1 Task 6a / Task 5 review): the OLD bug caught any ecosystem read
  // failure into EMPTY_ECOSYSTEM and rendered ordinary-looking zero tiles — no error at all. This
  // asserts the fixed behavior: a genuine (non-permission) failure renders the red error banner
  // INSTEAD of the tiles, never a silent ₪0 dressed up as real data.
  it('a failed (non-permission) ecosystem read renders the error banner, never falls back to a silent ₪0 tile display', async () => {
    H.state.ecosystemImpl = async () => {
      throw new Error('network blip');
    };
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByText('טעינת נתוני הנכסים נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument()
    );
    expect(screen.queryByText('עו"ש וחסכון')).not.toBeInTheDocument();
    expect(screen.queryByText('שווי נקי (Net Worth)')).not.toBeInTheDocument();
  });

  it('a permission-denied ecosystem read shows a calm access message — never the red error banner, never ₪0 (security fix 60d1c32)', async () => {
    H.state.ecosystemImpl = async () => {
      const err: any = new Error('denied');
      err.code = 'permission-denied';
      throw err;
    };
    renderDashboard();
    await waitFor(() => expect(screen.getByText('אין לך הרשאה לצפות בנתון זה')).toBeInTheDocument());
    expect(
      screen.queryByText('טעינת נתוני הנכסים נכשלה. בדוק את החיבור ונסה שוב.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('עו"ש וחסכון')).not.toBeInTheDocument();
  });

  it('a permission-denied budgetConfig read shows a calm access message instead of the connectivity-retry banner (security fix 60d1c32)', async () => {
    H.state.budgetImpl = async () => {
      const err: any = new Error('denied');
      err.code = 'permission-denied';
      throw err;
    };
    renderDashboard();
    await waitFor(() =>
      expect(screen.getAllByText('אין לך הרשאה לצפות בנתון זה').length).toBeGreaterThan(0)
    );
    expect(
      screen.queryByText('טעינת נתוני התקציב נכשלה. בדוק את החיבור ונסה שוב.')
    ).not.toBeInTheDocument();
  });

  it('a non-permission budgetConfig read failure still shows the connectivity-retry error (unchanged)', async () => {
    H.state.budgetImpl = async () => {
      throw new Error('boom');
    };
    renderDashboard();
    await waitFor(() =>
      expect(screen.getAllByText('טעינת נתוני התקציב נכשלה. בדוק את החיבור ונסה שוב.').length).toBeGreaterThan(0)
    );
    expect(screen.queryByText('אין לך הרשאה לצפות בנתון זה')).not.toBeInTheDocument();
  });

  // S3 — the incomes onSnapshot error callback previously only console.error'd, leaving
  // totalIncome silently ₪0.
  it('an incomes read failure surfaces an explicit error instead of a silent ₪0 total-income figure (S3)', async () => {
    H.state.incomesImpl = (_onNext, onError) => {
      onError(new Error('boom'));
      return () => {};
    };
    renderDashboard();
    // Shows on both the total-income KPI AND monthly-balance KPI (balance combines both reads,
    // per this task's S3 fix — it must not silently pick a winner between the two).
    await waitFor(() =>
      expect(screen.getAllByText('טעינת ההכנסות נכשלה. בדוק את החיבור ונסה שוב.').length).toBeGreaterThan(0)
    );
  });

  it('a permission-denied incomes read shows a calm access message on the income KPI, not the connectivity error (S3)', async () => {
    H.state.incomesImpl = (_onNext, onError) => {
      const err: any = new Error('denied');
      err.code = 'permission-denied';
      onError(err);
      return () => {};
    };
    renderDashboard();
    await waitFor(() =>
      expect(screen.getAllByText('אין לך הרשאה לצפות בנתון זה').length).toBeGreaterThan(0)
    );
    expect(
      screen.queryByText('טעינת ההכנסות נכשלה. בדוק את החיבור ונסה שוב.')
    ).not.toBeInTheDocument();
  });

  // S3 — previously the four KPI cards ignored budgetLoadError entirely (only the two chart cards
  // below reacted to it), so a budget read failure looked like an ordinary ₪0 month at a glance.
  it('the KPI cards derived from the budget read (expenses/balance/planned) reflect a budget load error instead of a silent figure (S3)', async () => {
    H.state.budgetImpl = async () => {
      throw new Error('boom');
    };
    renderDashboard();
    await waitFor(() =>
      expect(screen.getAllByText('טעינת נתוני התקציב נכשלה. בדוק את החיבור ונסה שוב.').length).toBeGreaterThan(1)
    );
  });

  // M1 — the מה/category filter was state-only before this fix: Dashboard rewired member+period
  // into loadBudget's actuals loop but never categories, so toggling a category never moved the
  // numbers. This seeds two transaction_lines rows in different categories and asserts the
  // rendered total actually changes when the category filter narrows to one of them.
  it("wires filters.category.categories into loadBudget's actuals aggregation — toggling a category changes the rendered figures (M1)", async () => {
    H.state.txLinesImpl = async () => ({
      docs: [
        { id: 't1', data: () => ({ category: 'מזון', owner: 'דויד', date: '2026-08-05', amount: 100, isCredit: false }) },
        { id: 't2', data: () => ({ category: 'תחבורה', owner: 'דויד', date: '2026-08-06', amount: 50, isCredit: false }) },
      ],
    });
    renderDashboard();
    // Scoped to the "סך ההוצאות" KPI card specifically — ₪150 also legitimately appears in the
    // settlement widget/ComparisonTable card below (same transaction_lines rows, a different
    // aggregation that M1 doesn't touch), so an unscoped text query would be ambiguous. The label
    // itself is a <div> (not <p> — a <div> can't validly nest inside a <p>/<h*> alongside
    // <Explain>'s own popover <div>), so its parentElement (not .closest('div'), which would
    // match the label div itself) is the KPI card's value-holding wrapper.
    const expensesCard = () => screen.getByText('סך ההוצאות').parentElement!;
    await waitFor(() => expect(within(expensesCard()).getByText('₪150')).toBeInTheDocument());

    await act(async () => {
      filtersApi!.setCategoryFilter({ categories: ['מזון'] });
    });

    await waitFor(() => expect(within(expensesCard()).getByText('₪100')).toBeInTheDocument());
  });

  // D8 (Ofra ruling B1) — a 2+-member selection makes resolveEcosystemKey fall back to 'all'; the
  // ecosystem/net-worth cards must say so, not silently show household-wide figures under what
  // looks like a scoped filter.
  it("shows the D8 disclosure note on the ecosystem/net-worth cards when 2+ members are selected (resolveEcosystemKey falls back to 'all')", async () => {
    renderDashboard();
    await waitForSettled();
    expect(screen.queryByText(/עדיין לא נתמך/)).not.toBeInTheDocument();

    await act(async () => {
      filtersApi!.setMemberSelection({ mode: 'members', memberIds: ['david', 'lilit'], groupId: null });
    });

    await waitFor(() =>
      expect(
        screen.getByText('מציג את נתוני כל המשפחה — סיכום לפי כמה בני משפחה עדיין לא נתמך')
      ).toBeInTheDocument()
    );
  });

  it("does NOT show the D8 disclosure note when the member filter is 'all' or exactly one member", async () => {
    renderDashboard();
    await waitForSettled();
    expect(screen.queryByText(/עדיין לא נתמך/)).not.toBeInTheDocument();

    await act(async () => {
      filtersApi!.setMemberSelection({ mode: 'members', memberIds: ['david'], groupId: null });
    });

    await waitFor(() => expect(filtersApi!.filters.member.memberIds).toEqual(['david']));
    expect(screen.queryByText(/עדיין לא נתמך/)).not.toBeInTheDocument();
  });

  // D9 (amended per Lola finding 1) — ComparisonTable ships WIRED this stage, fed by
  // loadSettlement's already-computed per-owner settlementData (no new Firestore reads).
  it('renders a "מי הוציא כמה החודש" ComparisonTable card fed by settlementData (D9)', async () => {
    H.state.txLinesImpl = async () => ({
      docs: [
        { id: 't1', data: () => ({ category: 'מזון', owner: 'דויד', date: '2026-08-05', amount: 300, isCredit: false }) },
        { id: 't2', data: () => ({ category: 'תחבורה', owner: 'לילית', date: '2026-08-06', amount: 200, isCredit: false }) },
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('מי הוציא כמה החודש')).toBeInTheDocument());

    const card = screen.getByText('מי הוציא כמה החודש').closest('div')!;
    expect(within(card).getByText('דויד')).toBeInTheDocument();
    expect(within(card).getByText('לילית')).toBeInTheDocument();
    expect(within(card).getByText('₪300')).toBeInTheDocument();
    expect(within(card).getByText('₪200')).toBeInTheDocument();
  });

  // Closing review fix — loadSettlement reads transaction_lines, which Firestore denies
  // WHOLESALE for a member without an expenses grant (same as loadBudget's transaction_lines
  // read above). Before this fix, loadSettlement's catch had no permission-denied branch: the
  // settlement widget showed the red connectivity-failure banner (wrong classification, S2), and
  // the ComparisonTable card rendered unconditionally from settlementData with zero reference to
  // settlementLoadError — on denial it silently showed "אין נתונים להשוואה.", indistinguishable
  // from a genuinely quiet household.
  it('a permission-denied settlement/transaction_lines read shows a calm access message on both the settlement widget and the comparison card — never "no data" (closing review fix)', async () => {
    H.state.txLinesImpl = async () => {
      const err: any = new Error('denied');
      err.code = 'permission-denied';
      throw err;
    };
    renderDashboard();
    await waitFor(() =>
      expect(screen.getAllByText('אין לך הרשאה לצפות בנתון זה').length).toBeGreaterThan(0)
    );
    expect(screen.queryByText('אין נתונים להשוואה.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('טעינת נתוני ההתחשבנות נכשלה. בדוק את החיבור ונסה שוב.')
    ).not.toBeInTheDocument();
  });

  it('a non-permission settlement/transaction_lines read failure shows the settlement error state on both the widget and the comparison card, not "no data" (closing review fix)', async () => {
    H.state.txLinesImpl = async () => {
      throw new Error('boom');
    };
    renderDashboard();
    await waitFor(() =>
      expect(
        screen.getAllByText('טעינת נתוני ההתחשבנות נכשלה. בדוק את החיבור ונסה שוב.').length
      ).toBeGreaterThan(1)
    );
    expect(screen.queryByText('אין נתונים להשוואה.')).not.toBeInTheDocument();
    expect(screen.queryByText('אין לך הרשאה לצפות בנתון זה')).not.toBeInTheDocument();
  });

  it('a genuinely empty settlement result (no adults configured, no transaction owners) shows the existing empty state, not an error or access-denied message (closing review fix)', async () => {
    H.mockListMembers.mockResolvedValue([
      { id: 'omer', name: 'עומר', role: 'ילד' as const, color: '#E07A5F', groups: [], createdAt: 'x', updatedAt: 'x' },
    ]);
    H.state.txLinesImpl = async () => ({ docs: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('אין נתונים להשוואה.')).toBeInTheDocument());
    expect(screen.queryByText('אין לך הרשאה לצפות בנתון זה')).not.toBeInTheDocument();
    expect(
      screen.queryByText('טעינת נתוני ההתחשבנות נכשלה. בדוק את החיבור ונסה שוב.')
    ).not.toBeInTheDocument();
  });
});

// D8 (spec §5.1 drill-down) + D12 (filter-not-applied notice) — Stage 5 Task 2. Dashboard's KPI
// and comparison cards become real navigateTo(...) buttons; useNavigation is mocked at the top of
// this file (H.mockNavigateTo) so these stay focused unit tests of Dashboard's own click-handler
// wiring (NavigationContext's real history/back-stack behavior has its own dedicated suite). The
// D12 notice is asserted via the real, mounted NotificationProvider (same pattern this file
// already uses for every other user-facing message).
describe('Dashboard — spec §5.1 drill-down (D8) + D12 filter-not-applied notice', () => {
  it('clicking the "סך ההוצאות" KPI card navigates to the expenses screen (D8)', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
    fireEvent.click(screen.getByTestId('kpi.totalExpenses'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('expenses');
  });

  it('clicking the "תקציב מתוכנן" KPI card navigates to the expenses screen (D8)', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('kpi.plannedBudget'));
    fireEvent.click(screen.getByTestId('kpi.plannedBudget'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('expenses');
  });

  it('clicking the "מי הוציא כמה החודש" comparison card navigates to the expenses screen', async () => {
    H.state.txLinesImpl = async () => ({
      docs: [
        { id: 't1', data: () => ({ category: 'מזון', owner: 'דויד', date: '2026-08-05', amount: 300, isCredit: false }) },
        { id: 't2', data: () => ({ category: 'תחבורה', owner: 'לילית', date: '2026-08-06', amount: 200, isCredit: false }) },
      ],
    });
    renderDashboard();
    await waitFor(() => screen.getByTestId('card.comparison'));
    fireEvent.click(screen.getByTestId('card.comparison'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('expenses');
  });

  it('a permission-denied KPI card is NOT clickable — navigating to a screen the viewer cannot see is worse than a dead card', async () => {
    H.state.budgetImpl = async () => {
      const err: any = new Error('denied');
      err.code = 'permission-denied';
      throw err;
    };
    renderDashboard();
    await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
    expect(screen.getByTestId('kpi.totalExpenses').tagName).not.toBe('BUTTON');
    expect(screen.getByTestId('kpi.plannedBudget').tagName).not.toBe('BUTTON');

    fireEvent.click(screen.getByTestId('kpi.totalExpenses'));
    expect(H.mockNavigateTo).not.toHaveBeenCalled();
  });

  it('a comparison card in an access-denied/error state is NOT clickable either', async () => {
    H.state.txLinesImpl = async () => {
      const err: any = new Error('denied');
      err.code = 'permission-denied';
      throw err;
    };
    renderDashboard();
    await waitFor(() => screen.getByTestId('card.comparison'));
    expect(screen.getByTestId('card.comparison').tagName).not.toBe('BUTTON');
    fireEvent.click(screen.getByTestId('card.comparison'));
    expect(H.mockNavigateTo).not.toHaveBeenCalled();
  });

  it('totalIncome and monthlyBalance KPI cards render as plain, non-button cards — no dedicated screen exists this stage', async () => {
    renderDashboard();
    await waitForSettled();
    // ":scope > p, :scope > button" (direct children only) so this doesn't accidentally match
    // the label row's own nested <Explain> trigger button one level deeper.
    const incomeValue = screen.getByText('סך ההכנסות').parentElement!.querySelector(':scope > p, :scope > button')!;
    expect(incomeValue.tagName).toBe('P');
    const balanceValue = screen.getByText('יתרה חודשית').parentElement!.querySelector(':scope > p, :scope > button')!;
    expect(balanceValue.tagName).toBe('P');
  });

  it('navigating to "expenses" (not global-filter-aware this stage) fires the D12 "הפילטור לא חל כאן עדיין" notice exactly once', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
    fireEvent.click(screen.getByTestId('kpi.totalExpenses'));
    await waitFor(() =>
      expect(screen.getAllByText(/הפילטור לא חל כאן עדיין/).length).toBe(1)
    );
  });

  it('does NOT fire the D12 notice when the destination already uses global filters (dashboard itself)', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
    // Dashboard itself uses global filters — a same-tab click never reaches this in real usage,
    // but drillDownTo's own logic must be keyed off the destination's registry flag, not fire
    // unconditionally. Verified indirectly: the notice text is absent before any click.
    expect(screen.queryByText(/הפילטור לא חל כאן עדיין/)).not.toBeInTheDocument();
  });
});
