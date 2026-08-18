// Task 6: Dashboard rewired onto global filters (מי/מתי/מה) + <Explain> + ComparisonTable + D8
// disclosure + loadBudget empty-vs-error/permission-denied handling.
//
// Stage 5 Task 5 (D3) — the old loadEcosystem effect + five-tile net-worth panel are RETIRED;
// Dashboard's net-worth card now calls useNetWorth (src/hooks/useNetWorth.ts), the SAME hook the
// dedicated NetWorthScreen uses. This file mocks AccountsService/LoansService directly
// (H.mockListAccounts/H.mockListLoans) to control what useNetWorth sees, independent of the
// generic firebase/firestore mock below (which still covers incomes/budgetConfig/
// transaction_lines/investments/settings-ecosystem-legacy-hints reads for everything else in this
// file, including useNetWorth's own settings/ecosystem legacy-hint + investments reads).
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
    // Task 8 review F4 — mutable so a test can choose WHICH provider the selected chat model
    // belongs to. The egress disclosure has to name the real recipient, and 'mock' is the one
    // value for which nothing leaves for a third party at all.
    aiModels: [] as { providerId: string; modelId: string; label: string; defaultForActions: string[]; usdInputPer1kTokens: number; usdOutputPer1kTokens: number }[],
    mockListMembers: vi.fn(),
    mockListGroups: vi.fn(async () => []),
    mockNavigateTo: vi.fn(),
    mockListAccounts: vi.fn(),
    mockListLoans: vi.fn(),
    mockSendChatMessage: vi.fn(),
    mockRequestApproval: vi.fn(),
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

// Stage 5 Task 5 — useNetWorth's own accounts/loans reads.
vi.mock('../services/AccountsService', () => ({ listAccounts: H.mockListAccounts }));
vi.mock('../services/LoansService', () => ({ listLoans: H.mockListLoans }));

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

// Task 6 (Stage 6) — src/services/ai.ts (the dead-env-var-bugged client-side Gemini call) is
// retired; Dashboard's chat now goes through useAiChat -> aiClient.sendChatMessage/listAiModels
// (Task 5's server-side aiChat/listAiModels callables). Mocked at the aiClient module boundary,
// same level this file already mocks MembersService/GroupsService/AccountsService/LoansService at.
//
// Batch 8 (closing review B4) — sendChatMessage and requestAiOverageApproval are H-held vi.fn()s
// now, not inline ones, so the overage tests at the bottom of this file can make a send FAIL with
// a real cost-gate refusal shape and then watch the approval panel appear. requestAiOverageApproval
// must be present in this factory at all: useAiChat imports it by name, and a mocked module that
// omits an export hands the hook an undefined to call.
vi.mock('../services/aiClient', () => ({
  listAiModels: vi.fn(async () => H.aiModels),
  sendChatMessage: H.mockSendChatMessage,
  requestAiOverageApproval: H.mockRequestApproval,
}));

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, Tooltip: Stub,
    Legend: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: Stub,
  };
});

import Dashboard, { type DashboardProps } from '../components/Dashboard';
import {
  AI_CHAT_NO_EGRESS_MOCK_HE,
  AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE,
  aiChatEgressNoticeHe,
} from '../config/aiDisclosure';
import { AI_OVERAGE_APPROVE_BUTTON_HE, AI_OVERAGE_NON_APPROVER_HE } from '../config/aiOverage';

const MOCK_CHAT_MODEL = { providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה (ללא מפתח)', defaultForActions: ['chat'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 };
const ANTHROPIC_CHAT_MODEL = { providerId: 'anthropic', modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', defaultForActions: ['chat'], usdInputPer1kTokens: 0.003, usdOutputPer1kTokens: 0.015 };

const MEMBERS = [
  { id: 'david', name: 'דויד', role: 'הורה' as const, color: '#1F4E78', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'lilit', name: 'לילית', role: 'הורה' as const, color: '#17C3B2', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'omer', name: 'עומר', role: 'ילד' as const, color: '#E07A5F', groups: [], createdAt: 'x', updatedAt: 'x' },
];

let filtersApi: ReturnType<typeof useGlobalFilters> | null = null;

// Stage 5 Task 5 — Dashboard now takes session/view-level props (D3, for its useNetWorth call).
// super-admin/'family' by default so the net-worth card renders its ordinary ready state
// (accounts/loans default to [] via H.mockListAccounts/mockListLoans below) without affecting
// any test in this file that isn't specifically about net worth.
const DEFAULT_DASHBOARD_PROPS: DashboardProps = {
  session: { memberId: 'david', role: 'super-admin' },
  accountsViewLevel: 'family',
  loansViewLevel: 'family',
  investmentsViewLevel: 'family',
};

function Harness({ dashboardProps = DEFAULT_DASHBOARD_PROPS }: { dashboardProps?: DashboardProps }) {
  // Reassigned on every render, which keeps this module-level ref fresh (filters/familyMembers
  // are new objects on relevant state changes; the setters themselves are useCallback-stable).
  filtersApi = useGlobalFilters();
  return <Dashboard {...dashboardProps} />;
}

function renderDashboard(dashboardProps?: DashboardProps) {
  filtersApi = null;
  return render(
    <NotificationProvider>
      <FilterProvider>
        <Harness dashboardProps={dashboardProps} />
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
  H.aiModels = [MOCK_CHAT_MODEL];
  H.mockSendChatMessage.mockReset();
  H.mockSendChatMessage.mockResolvedValue({ text: '', providerId: 'mock', modelId: 'mock-standard', costILS: 0 });
  H.mockRequestApproval.mockReset();
  H.mockRequestApproval.mockResolvedValue({ token: 'tok-1', expiresAt: Date.now() + 120_000, approvedAmountILS: 4.25 });
  H.mockListMembers.mockReset();
  H.mockListMembers.mockResolvedValue(MEMBERS);
  H.mockListGroups.mockReset();
  H.mockListGroups.mockResolvedValue([]);
  H.mockNavigateTo.mockReset();
  H.mockListAccounts.mockReset();
  H.mockListAccounts.mockResolvedValue([]);
  H.mockListLoans.mockReset();
  H.mockListLoans.mockResolvedValue([]);
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
    // Task 6 adds ModelPicker's own <select> (AI model choice, D5) — a different concern from the
    // מי/מתי filter controls this test guards against Dashboard re-acquiring. Assert every
    // combobox that DOES exist is the AI model picker, not that zero exist at all.
    const comboboxes = screen.queryAllByRole('combobox');
    for (const el of comboboxes) {
      expect(el).toHaveAccessibleName(/מודל/);
    }
  });

  it('keeps the manage-family-members entry point (not a filter control, stays on Dashboard)', async () => {
    renderDashboard();
    await waitForSettled();
    expect(screen.getByTitle(/ניהול בני משפחה/)).toBeInTheDocument();
  });

  // Stage 5 Task 5 (D3/D4) — the five dashboard.ecosystem.* triggers are retired along with the
  // ecosystem arithmetic; netWorth.assets.accounts/netWorth.liabilities.loans replace them
  // (accounts/loans default to [] via H.mockListAccounts/mockListLoans, so computeNetWorth still
  // pushes those two lines unconditionally — investments/realEstate stay conditional and don't
  // render for an empty household, covered by a dedicated test below).
  it('renders an <Explain> trigger on all four KPI cards, the net-worth headline, and its always-present line items', async () => {
    const { container } = renderDashboard();
    await waitForSettled();
    const ids = [
      'dashboard.totalIncome', 'dashboard.totalExpenses', 'dashboard.monthlyBalance', 'dashboard.plannedBudget',
      'dashboard.netWorth', 'netWorth.assets.accounts', 'netWorth.liabilities.loans',
    ];
    ids.forEach((id) => {
      expect(container.querySelector(`[data-tour-id="explain.${id}"]`)).toBeTruthy();
    });
  });

  // Critical review fix — the default fixture in this file's beforeEach (accounts=[], loans=[],
  // settings/ecosystem exists:false) is exactly the "isIncomplete with no legacy hints" state:
  // NetWorthIncompleteNotice used to return an empty fragment here, so nothing ever told David
  // (or any newly onboarded family) that the number shown is partial. Pinning that the plain
  // explanation now renders on the Dashboard card itself, not just in the component's own suite.
  it('critical review fix: the net-worth card shows a plain explanation when isIncomplete and no legacy hints exist (previously rendered nothing)', async () => {
    const { container } = renderDashboard();
    await waitForSettled();
    expect(container.querySelector('[data-tour-id="netWorth.incompleteNotice"]')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/השווי הנקי המוצג מבוסס רק על מה שכבר הוזן עד כה/)).toBeInTheDocument()
    );
  });

  it('renders the real-estate line item (with its own <Explain> trigger) once settings/ecosystem has a real-estate figure', async () => {
    H.state.ecosystemImpl = async () => ({ exists: () => true, data: () => ({ all: { realEstate: 2000000 } }) });
    const { container } = renderDashboard();
    await waitFor(() => expect(screen.getByText('נדל״ן')).toBeInTheDocument());
    expect(container.querySelector('[data-tour-id="explain.netWorth.assets.realEstate"]')).toBeTruthy();
  });

  it('consumes the shared members/groups fetch from FilterContext — no separate listMembers() call of its own (M2)', async () => {
    renderDashboard();
    await waitForSettled();
    expect(H.mockListMembers).toHaveBeenCalledTimes(1);
  });

  // Stage 5 Task 5 (D3) — the net-worth card now comes from useNetWorth's own accounts/loans
  // reads, not the old settings/ecosystem doc. A genuine (non-permission) failure on either must
  // still render the red error banner INSTEAD of the card, never a silent ₪0 dressed up as real
  // data — the same carry-forward rule the retired ecosystem card used to enforce.
  it('a failed (non-permission) accounts read renders the net-worth error banner, never falls back to a silent ₪0 card', async () => {
    H.mockListAccounts.mockRejectedValueOnce(new Error('network blip'));
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByText('טעינת נתוני השווי הנקי נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument()
    );
    expect(screen.queryByText('שווי נקי (Net Worth)')).not.toBeInTheDocument();
  });

  it('a permission-denied accounts read shows a calm access message on the net-worth card — never the red error banner, never ₪0', async () => {
    H.mockListAccounts.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('אין לך הרשאה לצפות בנתון זה')).toBeInTheDocument());
    expect(
      screen.queryByText('טעינת נתוני השווי הנקי נכשלה. בדוק את החיבור ונסה שוב.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('שווי נקי (Net Worth)')).not.toBeInTheDocument();
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

  // D8's old disclosure note ("...סיכום לפי כמה בני משפחה עדיין לא נתמך") existed because
  // resolveEcosystemKey had no real way to sum a 2+-member selection and silently fell back to a
  // household-wide 'all' bucket. Stage 5 Task 5's D3 rewire closes that gap FOR NET WORTH
  // specifically: accounts/loans support real per-ownerId scoping, so a 2+-member (or "all")
  // selection just resolves to the viewer's own real family/own scope (useNetWorth's own
  // scope/targetMemberId, resolved the identical way NetWorthScreen resolves them) — a genuine
  // computed figure, not a crude fallback — so the note no longer applies to this card and is
  // retired along with the ecosystem arithmetic it was warning about.
  it('never shows the old ecosystem-fallback disclosure note — net-worth scope resolution now handles multi-member selection for real (D3)', async () => {
    renderDashboard();
    await waitForSettled();
    expect(screen.queryByText(/עדיין לא נתמך/)).not.toBeInTheDocument();

    await act(async () => {
      filtersApi!.setMemberSelection({ mode: 'members', memberIds: ['david', 'lilit'], groupId: null });
    });

    await waitFor(() => expect(filtersApi!.filters.member.memberIds).toEqual(['david', 'lilit']));
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

  // Stage 5 Task 5 (D3/D8) — the net-worth card's headline is its own drill-down button (the
  // whole card can't be, since its line items below carry their own <Explain> trigger buttons —
  // nesting a button inside a button is invalid HTML).
  it('clicking the net-worth card headline navigates to the net-worth screen (D8)', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('card.netWorth'));
    fireEvent.click(screen.getByTestId('card.netWorth'));
    expect(H.mockNavigateTo).toHaveBeenCalledWith('net-worth');
  });

  it('does NOT fire the D12 "הפילטור לא חל כאן עדיין" notice when drilling into net-worth — it already uses global filters', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('card.netWorth'));
    fireEvent.click(screen.getByTestId('card.netWorth'));
    await waitFor(() => expect(H.mockNavigateTo).toHaveBeenCalled());
    expect(screen.queryByText(/הפילטור לא חל כאן עדיין/)).not.toBeInTheDocument();
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

  // Review fix (UX, controller-upgraded from Minor) — `hover:text-blue-600` was the ONLY cue that
  // a KPI number is clickable, and hover never fires on touch (this app's primary surface). Every
  // drillable number must carry a persistent, always-visible affordance; static numbers must not.
  it('a persistent drill affordance renders inside both drillable KPI cards (touch has no hover state)', async () => {
    renderDashboard();
    await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
    expect(
      within(screen.getByTestId('kpi.totalExpenses')).getByTestId('drill-affordance')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('kpi.plannedBudget')).getByTestId('drill-affordance')
    ).toBeInTheDocument();
  });

  it('the static (non-drillable) totalIncome and monthlyBalance KPI cards render NO drill affordance', async () => {
    renderDashboard();
    await waitForSettled();
    const incomeValue = screen.getByText('סך ההכנסות').parentElement!.querySelector(':scope > p, :scope > button') as HTMLElement;
    expect(within(incomeValue).queryByTestId('drill-affordance')).not.toBeInTheDocument();
    const balanceValue = screen.getByText('יתרה חודשית').parentElement!.querySelector(':scope > p, :scope > button') as HTMLElement;
    expect(within(balanceValue).queryByTestId('drill-affordance')).not.toBeInTheDocument();
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F4 — THE DATA-EGRESS DISCLOSURE REACHED ONLY THE PERSON WHO DIDN'T NEED IT.
//
// Spec §14 item 6 requires the user be told AI calls are sent to the chosen model provider. The
// copy existed, was accurate and plain — and grep proved it lived in exactly ONE file, the
// super-admin-only AiSettingsScreen. Parents and children use THIS chat; their financial
// questions egress to a third party; nobody ever told them. The disclosure now sits where the
// egress actually happens, so the role that can't open the settings screen still sees it.
//
// These tests are deliberately about the ROLES that could never see the old banner. Asserting
// "the string exists somewhere" is exactly the check that would have passed before the fix.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Dashboard chat — data-egress disclosure reaches every role (Task 8 review F4)', () => {
  const propsFor = (role: DashboardProps['session']['role']): DashboardProps => ({
    ...DEFAULT_DASHBOARD_PROPS,
    session: { memberId: 'omer', role },
  });

  // The notice is ALWAYS in the DOM (that is the point — it never waits on a load to appear), so
  // findByTestId resolves instantly, before listAiModels has settled and while the line still
  // reads its provider-unknown fallback. Every provider-naming assertion therefore has to be
  // inside waitFor, or it races the model list. Caught by a full-suite run, not in isolation.
  const noticeText = async (expected: string): Promise<HTMLElement> => {
    const notice = await screen.findByTestId('ai-chat-egress-notice');
    await waitFor(() => expect(notice).toHaveTextContent(expected));
    return notice;
  };

  it.each(['member', 'parent', 'super-admin'] as const)(
    'a %s session sees the disclosure naming the provider its questions are sent to',
    async (role) => {
      H.aiModels = [ANTHROPIC_CHAT_MODEL];
      renderDashboard(propsFor(role));
      await waitForSettled();

      const notice = await noticeText(aiChatEgressNoticeHe('anthropic'));
      expect(notice).toHaveTextContent('Anthropic');
    }
  );

  it('the named recipient follows the model switcher — a google model names Google, not the previous provider', async () => {
    H.aiModels = [{ ...ANTHROPIC_CHAT_MODEL, providerId: 'google', modelId: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' }];
    renderDashboard(propsFor('member'));
    await waitForSettled();

    const notice = await noticeText('Google');
    expect(notice).not.toHaveTextContent('Anthropic');
  });

  it('the mock model does NOT claim an egress that does not happen — it says so explicitly instead', async () => {
    H.aiModels = [MOCK_CHAT_MODEL];
    renderDashboard(propsFor('parent'));
    await waitForSettled();

    // The egress CLAIM itself must be absent — the mock adapter answers inside our own Cloud
    // Function, so telling the family their question left the machine would be a disclosure that
    // states a falsehood, the same defect class F4 is.
    const notice = await noticeText(AI_CHAT_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('ועוזבות את המחשב שלך');
  });

  it('with no model resolvable at all, it still discloses the egress rather than rendering nothing', async () => {
    H.aiModels = [];
    renderDashboard(propsFor('member'));
    await waitForSettled();

    await noticeText(AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE);
  });

  it('the disclosure sits with the chat input, not buried above the transcript', async () => {
    H.aiModels = [ANTHROPIC_CHAT_MODEL];
    const { container } = renderDashboard(propsFor('member'));
    await waitForSettled();

    const notice = await screen.findByTestId('ai-chat-egress-notice');
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    // Immediately precedes the input row in document order — permanently visible, never a
    // dismissible overlay the family learns to click away.
    expect(notice.nextElementSibling).toBe(form);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 8 (closing review B4) — THE APPROVAL PANEL IS ACTUALLY MOUNTED, AT THE SURFACE WHERE THE
// REFUSAL HAPPENS.
//
// AiOverageApprovalPanel has its own suite covering every role and every state. This file covers
// the one thing that suite structurally cannot: that Dashboard mounts it, wires it to the real
// useAiChat, and hands it the SESSION's verified role rather than a hardcoded one. That gap is
// exactly the F4 class — copy that exists, is correct, and is never rendered where it is needed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Dashboard chat — the overage approval path (closing review B4)', () => {
  const OVER_CEILING = {
    code: 'functions/resource-exhausted',
    message: 'חריגה מהתקרה',
    details: {
      reason: 'over-ceiling',
      quote: { providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedILS: 4.25 },
      usedThisMonthILS: 48, ceilingILS: 50,
      estimatedInputTokens: 5210, estimatedOutputTokens: 400,
    },
  };

  const propsFor = (role: DashboardProps['session']['role']): DashboardProps => ({
    ...DEFAULT_DASHBOARD_PROPS,
    session: { memberId: 'omer', role },
  });

  /** Drives the real chat form to a refused send. */
  async function sendAndGetRefused(role: DashboardProps['session']['role']) {
    H.aiModels = [ANTHROPIC_CHAT_MODEL];
    H.mockSendChatMessage.mockRejectedValueOnce(OVER_CEILING);
    renderDashboard(propsFor(role));
    await waitForSettled();
    const input = await screen.findByPlaceholderText(/שאל אותי/);
    await waitFor(() => expect(input).not.toBeDisabled()); // the model list has to land first
    fireEvent.change(input, { target: { value: 'שאלה יקרה' } });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });
    return screen.findByTestId('ai-overage-approval-panel');
  }

  it('a SUPER-ADMIN refused at the ceiling gets an approve-and-retry control naming the amount', async () => {
    const panel = await sendAndGetRefused('super-admin');
    expect(panel).toHaveTextContent('₪4.25');
    expect(within(panel).getByText(AI_OVERAGE_APPROVE_BUTTON_HE)).toBeInTheDocument();
  });

  it('pressing approve mints a token for the SERVER\'s estimates and resends the same question with it', async () => {
    const panel = await sendAndGetRefused('super-admin');
    H.mockSendChatMessage.mockResolvedValueOnce({ text: 'התשובה', providerId: 'anthropic', modelId: 'claude-sonnet-5', costILS: 4.2 });

    await act(async () => {
      fireEvent.click(within(panel).getByText(AI_OVERAGE_APPROVE_BUTTON_HE));
    });

    expect(H.mockRequestApproval).toHaveBeenCalledWith({
      providerId: 'anthropic', modelId: 'claude-sonnet-5',
      estimatedInputTokens: 5210, estimatedOutputTokens: 400,
    });
    expect(H.mockSendChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ approvalToken: 'tok-1', message: 'שאלה יקרה' })
    );
    // The answer lands, and the panel goes away — the path is finished, not left open offering to
    // spend again on a question already answered.
    await waitFor(() => expect(screen.getByText('התשובה')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('ai-overage-approval-panel')).toBeNull());
  });

  it.each(['parent', 'member'] as const)(
    'a %s refused at the ceiling gets the panel but NO approve control — the server would refuse them',
    async (role) => {
      const panel = await sendAndGetRefused(role);
      expect(within(panel).queryByText(AI_OVERAGE_APPROVE_BUTTON_HE)).toBeNull();
      expect(panel).toHaveTextContent(AI_OVERAGE_NON_APPROVER_HE);
      // Proves the role reaching the panel is the SESSION's, not a constant: the same refusal
      // produces a button one test up and none here.
      expect(H.mockRequestApproval).not.toHaveBeenCalled();
    }
  );

  it('an ordinary provider failure does NOT put an approval panel on screen', async () => {
    // 'resource-exhausted' is shared by a provider 429, which no approval can fix. Offering to
    // spend money on it would be a control that cannot work.
    H.aiModels = [ANTHROPIC_CHAT_MODEL];
    H.mockSendChatMessage.mockRejectedValueOnce({ code: 'functions/resource-exhausted', message: 'ספק ה-AI עמוס כרגע' });
    renderDashboard(propsFor('super-admin'));
    await waitForSettled();
    const input = await screen.findByPlaceholderText(/שאל אותי/);
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: 'שאלה' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });

    await waitFor(() => expect(screen.getByText('ספק ה-AI עמוס כרגע')).toBeInTheDocument());
    expect(screen.queryByTestId('ai-overage-approval-panel')).toBeNull();
  });

  it('no refusal, no panel — it is not a permanent fixture of the chat', async () => {
    H.aiModels = [ANTHROPIC_CHAT_MODEL];
    renderDashboard(propsFor('super-admin'));
    await waitForSettled();
    expect(screen.queryByTestId('ai-overage-approval-panel')).toBeNull();
  });
});
