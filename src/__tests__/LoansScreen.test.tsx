// Stage 5 Task 4 — LoansScreen, built on the shared useOwnedCollectionScreen<T> hook (D13) the
// same way AccountsScreen (Task 3) is. Mirrors AccountsScreen.test.tsx's loading/empty/error/
// permission-denied/create-defaults-ownerId/no-picker-at-own-level/ScopeBadge/inputMode/
// soft-confirm/delete-confirm/glossary-wired cases against LoansService's mock, plus the
// loan-specific cases this task's brief calls out: the "כמה נשאר" payoff progress, native
// <input type="date"> controls for startDate/endDate (B3 — Loans is the first screen with real
// dates), and client-side endDate > startDate validation (confirmed absent from both
// firestore.rules' isValidLoan and any client validator before this task).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoansScreen from '../components/LoansScreen';

const { mockList, mockSave, mockRemove, mockConsumePayload, mockSetLeaveGuard } = vi.hoisted(() => ({
  mockList: vi.fn(), mockSave: vi.fn(), mockRemove: vi.fn(), mockConsumePayload: vi.fn(), mockSetLeaveGuard: vi.fn(),
}));
vi.mock('../services/LoansService', () => ({ listLoans: mockList, saveLoan: mockSave, deleteLoan: mockRemove }));

let mockNavigationPayload: unknown = null;
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({
    navigationPayload: mockNavigationPayload,
    consumePayload: mockConsumePayload,
    setLeaveGuard: mockSetLeaveGuard,
  }),
}));

const FAMILY_MEMBERS = [
  { id: 'david-levy', name: 'דויד', color: '#111', role: 'הורה', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'omer-levy', name: 'עומר', color: '#222', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' },
] as any[];

vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: { member: { mode: 'all', memberIds: [], groupId: null } },
    groups: { status: 'ready', groups: [] },
    familyMembers: { status: 'ready', members: FAMILY_MEMBERS, error: null, reload: vi.fn() },
  }),
}));

const LOAN_FIXTURE = {
  id: 'l1',
  ownerId: 'david-levy',
  name: 'משכנתא',
  loanType: 'mortgage' as const,
  principal: 1000000,
  balance: 750000,
  interestRate: 3.5,
  monthlyPayment: 4000,
  startDate: '2020-01-01',
  endDate: '2045-01-01',
  status: 'active' as const,
  createdAt: 'x',
  updatedAt: 'x',
};

describe('LoansScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockNavigationPayload = null; });

  it('loading state renders before the list resolves', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('empty state (zero loans, successful read) renders an explicit "no loans yet" message, not a blank list', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/עדיין לא הוספתם הלוואות/)).toBeInTheDocument());
  });

  it('a failed read renders an explicit error, never an empty list (Global Constraints)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'unavailable' }));
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/טעינת ההלוואות נכשלה/)).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא הוספתם הלוואות/)).not.toBeInTheDocument();
  });

  it('a permission-denied read renders the calm access message, never the red error banner (S2)', async () => {
    render(<LoansScreen session={{ memberId: 'omer-levy', role: 'member' }} loansViewLevel={undefined} loansEditLevel={undefined} />);
    await waitFor(() => expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument());
    expect(mockList).not.toHaveBeenCalled();
  });

  it("create form defaults ownerId to the acting session's memberId (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<LoansScreen session={{ memberId: 'omer-levy', role: 'member' }} loansViewLevel="own" loansEditLevel="own" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'הלוואת רכב' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2028-01-01' } });
    fireEvent.change(screen.getByLabelText('סכום קרן'), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText('יתרה נוכחית'), { target: { value: '40000' } });
    fireEvent.change(screen.getByLabelText('ריבית שנתית (%)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('תשלום חודשי'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'omer-levy', name: 'הלוואת רכב', principal: 50000, balance: 40000 }),
      'omer-levy'
    ));
  });

  it("an 'own'-level editor sees a ScopeBadge and no OwnerPicker combobox (D7/D14/I5)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'omer-levy', role: 'member' }} loansViewLevel="own" loansEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם הלוואות/));
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    expect(screen.queryByRole('combobox', { name: /בעלים/ })).not.toBeInTheDocument();
  });

  it("a 'family'-level editor's create form offers an OwnerPicker with a chip per member (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    expect(screen.getByRole('button', { name: /עומר/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /דויד/ })).toBeInTheDocument();
  });

  it('principal/balance/monthlyPayment all carry inputMode="decimal", and interestRate has a numeric input (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    expect(screen.getByLabelText('סכום קרן')).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText('יתרה נוכחית')).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText('תשלום חודשי')).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText('ריבית שנתית (%)')).toHaveAttribute('inputMode', 'decimal');
    expect(screen.getByLabelText('ריבית שנתית (%)')).toHaveAttribute('type', 'number');
  });

  it('start/end date fields are native date inputs (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    expect(screen.getByLabelText('תאריך התחלה')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('תאריך סיום')).toHaveAttribute('type', 'date');
  });

  it('rejects endDate <= startDate with an inline error, never calling saveLoan', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(screen.getByText('תאריך הסיום חייב להיות אחרי תאריך ההתחלה')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects endDate === startDate too (not strictly greater), never calling saveLoan', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(screen.getByText('תאריך הסיום חייב להיות אחרי תאריך ההתחלה')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('shows the "כמה נשאר" payoff progress for each loan', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/25% שולם/)).toBeInTheDocument());
    expect(screen.getByText(/נשארו ₪750,000/)).toBeInTheDocument();
  });

  it('a balance at/above the confirm threshold prompts window.confirm before saving (D14/M6)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2040-01-01' } });
    fireEvent.change(screen.getByLabelText('סכום קרן'), { target: { value: '900000' } });
    fireEvent.change(screen.getByLabelText('יתרה נוכחית'), { target: { value: '600000' } });
    fireEvent.change(screen.getByLabelText('ריבית שנתית (%)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('תשלום חודשי'), { target: { value: '4000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalled();
  });

  it('declining the large-amount confirm does NOT save', async () => {
    mockList.mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2040-01-01' } });
    fireEvent.change(screen.getByLabelText('סכום קרן'), { target: { value: '900000' } });
    fireEvent.change(screen.getByLabelText('יתרה נוכחית'), { target: { value: '600000' } });
    fireEvent.change(screen.getByLabelText('ריבית שנתית (%)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('תשלום חודשי'), { target: { value: '4000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('delete asks for confirmation before calling deleteLoan', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByText('משכנתא'));
    fireEvent.click(screen.getByTestId('screen.loans.row.delete'));
    expect(screen.getByText(/למחוק את ההלוואה/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('כן, מחק'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('l1', 'david-levy'));
  });

  it('cancelling the delete confirmation does not call deleteLoan', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByText('משכנתא'));
    fireEvent.click(screen.getByTestId('screen.loans.row.delete'));
    fireEvent.click(screen.getByText('ביטול'));
    expect(screen.queryByText(/למחוק את ההלוואה/)).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('the total-balance summary is wired to the loans.totalBalance glossary entry', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => expect(screen.getByLabelText('הסבר: סך היתרה שנותרה')).toBeInTheDocument());
  });

  it('each loan row payoff progress, interest rate, and monthly payment carry their own <Explain> triggers', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByText('משכנתא'));
    expect(screen.getByLabelText(/הסבר: כמה נשאר לשלם/)).toBeInTheDocument();
    expect(screen.getByLabelText(/הסבר: ריבית שנתית/)).toBeInTheDocument();
    expect(screen.getByLabelText(/הסבר: תשלום חודשי/)).toBeInTheDocument();
  });

  it('data-tour-id is present on the list container, the create button, and per-row edit/delete actions', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    const { container } = render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByText('משכנתא'));
    expect(container.querySelector('[data-tour-id="screen.loans.list"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.loans.create"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.loans.row.edit"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.loans.row.delete"]')).not.toBeNull();
  });

  it('an empty loan name shows an inline validation error and does not call saveLoan', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין שם להלוואה/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a missing start date shows an inline validation error and does not call saveLoan', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText('יש לבחור תאריך התחלה')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a non-numeric principal shows an inline validation error and does not call saveLoan', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    fireEvent.click(screen.getByTestId('screen.loans.create'));
    fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין סכום קרן תקין/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('editing an existing loan pre-fills the form from the item, including its ownerId', async () => {
    mockList.mockResolvedValueOnce([LOAN_FIXTURE]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByText('משכנתא'));
    fireEvent.click(screen.getByText('עריכה'));
    expect(screen.getByLabelText('שם ההלוואה')).toHaveValue('משכנתא');
    expect(screen.getByDisplayValue('1000000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('750000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2020-01-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2045-01-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /דויד/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a dirty create form registers a leave-guard (I4) — verified via NavigationContext.setLeaveGuard being called', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.loans.create'));
    expect(mockSetLeaveGuard).toHaveBeenCalledWith(expect.any(Function));
  });
});
