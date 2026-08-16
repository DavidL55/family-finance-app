// Stage 5 Task 7 (FINAL) — RecurringScreen, built on the shared useOwnedCollectionScreen<T> hook
// (D13), same composition as Accounts/Loans/Insurances with zero hook changes. Two deltas unique
// to this screen: the מה (category) filter dimension (D5) and the per-row failed-posting badge
// (M5) threading useRecurringCatchup's PostingOutcome.failed through from App.tsx.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecurringScreen from '../components/RecurringScreen';

const { mockList, mockSave, mockRemove, mockSetLeaveGuard } = vi.hoisted(() => ({
  mockList: vi.fn(), mockSave: vi.fn(), mockRemove: vi.fn(), mockSetLeaveGuard: vi.fn(),
}));
vi.mock('../services/RecurringService', () => ({
  listRecurring: mockList,
  saveRecurring: mockSave,
  deleteRecurring: mockRemove,
}));

const { mockGetCategories } = vi.hoisted(() => ({ mockGetCategories: vi.fn() }));
vi.mock('../services/CategoriesService', () => ({ getCategories: mockGetCategories }));

vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({
    navigationPayload: null,
    consumePayload: vi.fn(),
    setLeaveGuard: mockSetLeaveGuard,
  }),
}));

const FAMILY_MEMBERS = [
  { id: 'david-levy', name: 'דויד', color: '#111', role: 'הורה', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'omer-levy', name: 'עומר', color: '#222', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' },
] as any[];

let mockCategoryFilter: string[] = [];
vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: { member: { mode: 'all', memberIds: [], groupId: null }, category: { categories: mockCategoryFilter } },
    groups: { status: 'ready', groups: [] },
    familyMembers: { status: 'ready', members: FAMILY_MEMBERS, error: null, reload: vi.fn() },
  }),
}));

const RECURRING_FIXTURE = {
  id: 'r1',
  ownerId: 'david-levy',
  kind: 'expense' as const,
  description: 'ארנונה',
  amount: 800,
  category: 'דיור',
  chargeDay: 10,
  status: 'active' as const,
  startDate: '2025-01-01',
  lastPostedPeriod: '2026-07',
  createdAt: 'x',
  updatedAt: 'x',
};

describe('RecurringScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFilter = [];
    mockGetCategories.mockResolvedValue(['חינוך', 'בידור', 'דיור']);
  });

  it('loading state renders before the list resolves', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('empty state (zero items, successful read) renders an inviting message, not a blank list', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/עדיין לא הוספתם תנועות קבועות/)).toBeInTheDocument());
  });

  it('a failed read renders an explicit error, never an empty list (Global Constraints)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'unavailable' }));
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/טעינת התנועות הקבועות נכשלה/)).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא הוספתם תנועות קבועות/)).not.toBeInTheDocument();
  });

  it('a permission-denied read renders the calm access message, never the red error banner (S2)', async () => {
    render(<RecurringScreen session={{ memberId: 'omer-levy', role: 'member' }} recurringViewLevel={undefined} recurringEditLevel={undefined} lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument());
    expect(mockList).not.toHaveBeenCalled();
  });

  it("create form defaults ownerId to the acting session's memberId (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<RecurringScreen session={{ memberId: 'omer-levy', role: 'member' }} recurringViewLevel="own" recurringEditLevel="own" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'מנוי' } });
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'omer-levy', description: 'מנוי', amount: 50 }),
      'omer-levy'
    ));
  });

  it("an 'own'-level editor sees a ScopeBadge and no OwnerPicker combobox", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'omer-levy', role: 'member' }} recurringViewLevel="own" recurringEditLevel="own" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם תנועות קבועות/));
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    expect(screen.queryByRole('group', { name: 'בעלים' })).not.toBeInTheDocument();
  });

  it("a 'family'-level editor's create form offers an OwnerPicker with a chip per member", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    expect(screen.getByRole('button', { name: /עומר/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /דויד/ })).toBeInTheDocument();
  });

  // Brief's own pinned test (task-7-brief.md Step 1)
  it('category select only appears for kind "expense"', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByLabelText('הכנסה'));
    expect(screen.queryByLabelText('קטגוריה')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('הוצאה'));
    expect(screen.getByLabelText('קטגוריה')).toBeInTheDocument();
  });

  // Brief's own pinned test (task-7-brief.md Step 1)
  it('the מה category filter narrows the visible list (D5)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'חוג', amount: 100, category: 'חינוך', chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
      { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'מנוי', amount: 50, category: 'בידור', chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    mockCategoryFilter = ['חינוך'];
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText('חוג')).toBeInTheDocument());
    expect(screen.queryByText('מנוי')).not.toBeInTheDocument();
  });

  it('an income-kind item (no category) is excluded by an active category filter, matching Dashboard\'s own M1 formula literally', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'מענק', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    mockCategoryFilter = ['חינוך'];
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/עדיין לא הוספתם תנועות קבועות/)).toBeInTheDocument());
    expect(screen.queryByText('מענק')).not.toBeInTheDocument();
  });

  it('no category filter active means every kind passes through unfiltered', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'מענק', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText('מענק')).toBeInTheDocument());
  });

  // Brief's own pinned test (task-7-brief.md Step 1)
  it('totalMonthly excludes paused and ended items', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
      { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 999, chargeDay: 1, status: 'paused', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/סך ההתחייבות החודשית: ₪100/)).toBeInTheDocument());
  });

  // Ship-blocker fix (Fix 1): the "obligation" headline is labeled as an expense obligation, so
  // it must actually only sum expense-kind items — an active income item sitting beside an active
  // expense item must NOT inflate it. The income side gets its OWN clearly-labeled figure instead
  // of being silently folded into "obligation".
  it('an ACTIVE income item beside an ACTIVE expense item: the obligation figure counts only the expense, and a separate income figure shows the income (Fix 1)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'משכורת', amount: 20000, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
      { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'שכירות', amount: 5000, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/סך ההתחייבות החודשית: ₪5,000/)).toBeInTheDocument());
    expect(screen.queryByText(/סך ההתחייבות החודשית: ₪25,000/)).not.toBeInTheDocument();
    expect(screen.getByText(/סך ההכנסה הקבועה החודשית: ₪20,000/)).toBeInTheDocument();
  });

  // Brief's own pinned test (task-7-brief.md Step 1)
  it('shows lastPostedPeriod per row, or "טרם נרשם" when absent', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', lastPostedPeriod: '2026-07', createdAt: 'x', updatedAt: 'x' },
      { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 50, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByText(/נרשם לאחרונה: 2026-07/)).toBeInTheDocument());
    expect(screen.getByText('טרם נרשם')).toBeInTheDocument();
  });

  // Brief's own pinned test (task-7-brief.md Step 1) — M5
  it('a row whose id appears in lastCatchupOutcome.failed shows the per-row failure badge (M5)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
      { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 50, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'owner not found' }] };
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
    await waitFor(() => expect(screen.getAllByText('פרסום אחרון נכשל')).toHaveLength(1));
    expect(screen.getByText('פרסום אחרון נכשל')).toHaveAttribute('title', 'owner not found');
  });

  // Brief's own pinned test (task-7-brief.md Step 1)
  it('a row with no matching failed entry shows no badge', async () => {
    mockList.mockResolvedValueOnce([{ id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' }]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={{ posted: [], failed: [] }} />);
    await waitFor(() => screen.getByText('A'));
    expect(screen.queryByText('פרסום אחרון נכשל')).not.toBeInTheDocument();
  });

  it('lastCatchupOutcome === null shows no badge on any row', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.queryByText('פרסום אחרון נכשל')).not.toBeInTheDocument();
  });

  // Fix 3 — RecurringService.postDueRecurringTransactions pushes {recurringId: '(all)', error}
  // when the initial fetch itself throws (wholesale failure, nothing could even be checked). The
  // per-row badge lookup never matches '(all)' against a real item id, so before this fix a denied
  // catch-up showed NO badge and NO screen-level notice at all — precisely the failure the per-row
  // badge exists to make visible. This asserts a screen-level notice renders instead.
  it("a lastCatchupOutcome.failed entry with recurringId '(all)' shows no per-row badge (no item id can ever match the sentinel) but the screen notice still appears (Fix 3)", async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    const outcome = { posted: [], failed: [{ recurringId: '(all)', error: 'permission-denied' }] };
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.queryByText('פרסום אחרון נכשל')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen.recurring.wholesaleFailure')).toBeInTheDocument();
  });

  it("no screen-level wholesale-failure notice appears when failed only contains real (non-'(all)') item ids (Fix 3)", async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'owner not found' }] };
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.queryByTestId('screen.recurring.wholesaleFailure')).not.toBeInTheDocument();
  });

  it('no screen-level wholesale-failure notice appears when lastCatchupOutcome is null (Fix 3)', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.queryByTestId('screen.recurring.wholesaleFailure')).not.toBeInTheDocument();
  });

  // Fix 1 (Important, review post-Stage-5): the per-row badge is computed over `visibleItems` —
  // the מה (category) filter's OUTPUT — and that filter lives in GLOBAL FilterContext state
  // (persisted in sessionStorage, shared across every screen), so a filter set on another screen
  // silently carries into Recurring. An income-kind item has no `category` at all
  // (isValidRecurring never requires one for income), so ANY active category filter excludes it —
  // and income items are exactly the class most likely to fail posting (Fix 5's documented
  // family-level-edit-on-'income' gate). Before this fix: real failure + any active category
  // filter = no badge (row filtered out) AND no toast (Fix 4 suppresses it in favor of the badge)
  // — only a console.error. Ruling: no failure may end up with zero user-visible channel. This
  // pins the screen-level notice that now catches it, naming the item so the household knows what
  // to go check.
  it('a real-item failure whose row is filtered out by the category filter surfaces at screen level, naming the item (Fix 1)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'מענק', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    mockCategoryFilter = ['חינוך']; // income item has no category — excluded by any active category filter (D5)
    const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'permission-denied' }] };
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
    await waitFor(() => expect(screen.getByTestId('screen.recurring.hiddenCatchupFailure')).toBeInTheDocument());
    expect(screen.getByTestId('screen.recurring.hiddenCatchupFailure')).toHaveTextContent('מענק');
    // the row itself is genuinely not rendered (excluded by the category filter) — nothing for a per-row badge to attach to
    expect(screen.queryByText('מענק')).not.toBeInTheDocument();
    expect(screen.queryByText('פרסום אחרון נכשל')).not.toBeInTheDocument();
  });

  it('a real-item failure whose row IS visible still shows only the per-row badge — no duplicate screen-level notice (Fix 1)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, category: 'דיור', chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'owner not found' }] };
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
    await waitFor(() => expect(screen.getByText('פרסום אחרון נכשל')).toBeInTheDocument());
    expect(screen.queryByTestId('screen.recurring.hiddenCatchupFailure')).not.toBeInTheDocument();
  });

  it("the '(all)' wholesale-failure notice still appears, and does not also trigger the hidden-item notice (Fix 1/Fix 3)", async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    const outcome = { posted: [], failed: [{ recurringId: '(all)', error: 'permission-denied' }] };
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.getByTestId('screen.recurring.wholesaleFailure')).toBeInTheDocument();
    expect(screen.queryByTestId('screen.recurring.hiddenCatchupFailure')).not.toBeInTheDocument();
  });

  it('an income-kind row discloses the posting limitation in plain Hebrew', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'משכורת', amount: 5000, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'member' }} recurringViewLevel="own" recurringEditLevel="own" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('משכורת'));
    expect(screen.getByText(/הכנסה קבועה/)).toBeInTheDocument();
  });

  it('an expense-kind row does NOT show the income posting-limitation note', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.queryByText(/הכנסה קבועה נרשמת/)).not.toBeInTheDocument();
  });

  // Fix 5 — the note exists to explain a permanently-stuck "טרם נרשם" for viewers who cannot post
  // recurring income themselves. A parent/super-admin session always resolves to 'family' scope
  // (resolveOwnedModuleScope) and so CAN always post it — the note is pure noise for them and
  // must be gated off, using session.role, already a prop on this screen (no new prop needed).
  it('a super-admin session does NOT see the income posting-limitation note on an income-kind row (Fix 5)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'משכורת', amount: 5000, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('משכורת'));
    expect(screen.queryByText(/הכנסה קבועה נרשמת/)).not.toBeInTheDocument();
  });

  it('a parent session does NOT see the income posting-limitation note on an income-kind row (Fix 5)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'משכורת', amount: 5000, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'parent' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('משכורת'));
    expect(screen.queryByText(/הכנסה קבועה נרשמת/)).not.toBeInTheDocument();
  });

  // Fix 5 — the copy itself must not overclaim "only role X" when the real gate is family-level
  // edit on the ownerless 'income' module (a 'member' could technically hold that grant too).
  it('the income posting-limitation note attributes the limitation to family-level edit permission, not role, in its wording (Fix 5)', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'r1', ownerId: 'david-levy', kind: 'income', description: 'משכורת', amount: 5000, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'member' }} recurringViewLevel="own" recurringEditLevel="own" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('משכורת'));
    expect(screen.getByText(/הרשאת עריכה ברמת משפחה למודול ההכנסות/)).toBeInTheDocument();
    expect(screen.queryByText(/רק כשהורה או סופר-אדמין/)).not.toBeInTheDocument();
  });

  it('amount has inputMode="decimal" (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    expect(screen.getByLabelText('סכום')).toHaveAttribute('inputMode', 'decimal');
  });

  it('startDate is a native date input (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    expect(screen.getByLabelText('תאריך התחלה')).toHaveAttribute('type', 'date');
  });

  it('an empty description shows an inline validation error and does not call saveRecurring', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין תיאור/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a missing start date shows an inline validation error and does not call saveRecurring', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש לבחור תאריך התחלה/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('an out-of-range charge day shows an inline validation error and does not call saveRecurring', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('יום חיוב בחודש'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין יום חיוב תקין/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a non-positive amount shows an inline validation error and does not call saveRecurring', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין סכום תקין/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a balance/amount at or above the confirm threshold prompts window.confirm before saving (D14/M6)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '600000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalled();
  });

  it('declining the large-amount confirm does NOT save', async () => {
    mockList.mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '600000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('delete asks for confirmation before calling deleteRecurring', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByTestId('screen.recurring.row.delete'));
    expect(screen.getByText(/למחוק את התנועה הקבועה/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('כן, מחק'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('r1', 'david-levy'));
  });

  it('cancelling the delete confirmation does not call deleteRecurring', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByTestId('screen.recurring.row.delete'));
    fireEvent.click(screen.getByText('ביטול'));
    expect(screen.queryByText(/למחוק את התנועה הקבועה/)).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  // Ship-blocker fix (financeCollections.ts's save() undefined/null contract): lastPostedPeriod
  // is no longer manually threaded through by the screen — it's simply ABSENT from the payload,
  // which means "leave unchanged" and is merged over the stored value by the factory itself
  // (financeCollections.test.ts pins that at the factory level). category/endDate are absent too
  // — this quick-action changes ONLY status.
  it('clicking "השהה" on an active item calls saveRecurring with only status changed to paused, and no lastPostedPeriod/category/endDate in the payload', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    mockSave.mockResolvedValueOnce({});
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByText('השהה'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      {
        id: 'r1',
        ownerId: 'david-levy',
        kind: 'expense',
        description: 'ארנונה',
        amount: 800,
        chargeDay: 10,
        status: 'paused',
        startDate: '2025-01-01',
      },
      'david-levy'
    ));
  });

  it('clicking "הפעל מחדש" on a paused item calls saveRecurring with status changed back to active, and no lastPostedPeriod in the payload', async () => {
    mockList.mockResolvedValueOnce([{ ...RECURRING_FIXTURE, status: 'paused' }]);
    mockSave.mockResolvedValueOnce({});
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByText('הפעל מחדש'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.not.objectContaining({ lastPostedPeriod: expect.anything() }),
      'david-levy'
    ));
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', status: 'active' }), 'david-levy');
  });

  it('no status quick-action button renders for an "ended" item', async () => {
    mockList.mockResolvedValueOnce([{ ...RECURRING_FIXTURE, status: 'ended' }]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.queryByText('השהה')).not.toBeInTheDocument();
    expect(screen.queryByText('הפעל מחדש')).not.toBeInTheDocument();
  });

  it('editing an existing item pre-fills the form and, on save, omits lastPostedPeriod (leaving it unchanged per the save() contract) while sending category/endDate explicitly', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    mockSave.mockResolvedValueOnce({});
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByText('עריכה'));
    expect(screen.getByLabelText('תיאור')).toHaveValue('ארנונה');
    expect(screen.getByLabelText('סכום')).toHaveValue(800);
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '850' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      {
        id: 'r1',
        ownerId: 'david-levy',
        kind: 'expense',
        description: 'ארנונה',
        amount: 850,
        category: 'דיור',
        chargeDay: 10,
        status: 'active',
        startDate: '2025-01-01',
        endDate: null,
      },
      'david-levy'
    ));
  });

  it('navigating away with a dirty, open form triggers the leave-guard confirm (I4)', async () => {
    mockList.mockResolvedValueOnce([]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    fireEvent.click(screen.getByTestId('screen.recurring.create'));
    fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'X' } });
    const guard = mockSetLeaveGuard.mock.calls.at(-1)![0];
    expect(guard()).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('the total-monthly summary is wired to the recurring.totalMonthly glossary entry', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => expect(screen.getByLabelText('הסבר: סך ההתחייבות החודשית')).toBeInTheDocument());
  });

  it('each row amount carries its own <Explain> trigger (כל מספר)', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(screen.getByLabelText(/הסבר: סכום/)).toBeInTheDocument();
  });

  it('data-tour-id is present on the list container, the create button, and per-row edit/delete actions', async () => {
    mockList.mockResolvedValueOnce([RECURRING_FIXTURE]);
    const { container } = render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByText('ארנונה'));
    expect(container.querySelector('[data-tour-id="screen.recurring.list"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.recurring.create"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.recurring.row.edit"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.recurring.row.delete"]')).not.toBeNull();
  });

  it('a dirty create form registers a leave-guard (I4) — verified via NavigationContext.setLeaveGuard being called', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
    await waitFor(() => screen.getByTestId('screen.recurring.create'));
    expect(mockSetLeaveGuard).toHaveBeenCalledWith(expect.any(Function));
  });
});
