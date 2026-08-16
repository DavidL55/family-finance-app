import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountsScreen from '../components/AccountsScreen';

const { mockList, mockSave, mockRemove, mockConsumePayload, mockSetLeaveGuard } = vi.hoisted(() => ({
  mockList: vi.fn(), mockSave: vi.fn(), mockRemove: vi.fn(), mockConsumePayload: vi.fn(), mockSetLeaveGuard: vi.fn(),
}));
vi.mock('../services/AccountsService', () => ({ listAccounts: mockList, saveAccount: mockSave, deleteAccount: mockRemove }));

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

describe('AccountsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockNavigationPayload = null; });

  it('loading state renders before the list resolves', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('empty state (zero accounts, successful read) renders an explicit "no accounts yet" message, not a blank list', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/עדיין לא הוספתם חשבונות/)).toBeInTheDocument());
  });

  it('a failed read renders an explicit error, never an empty list (Global Constraints)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'unavailable' }));
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/טעינת החשבונות נכשלה/)).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא הוספתם חשבונות/)).not.toBeInTheDocument();
  });

  it('a permission-denied read renders the calm access message, never the red error banner (S2)', async () => {
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel={undefined} accountsEditLevel={undefined} />);
    await waitFor(() => expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument());
    expect(mockList).not.toHaveBeenCalled();
  });

  it("create form defaults ownerId to the acting session's memberId (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel="own" accountsEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם חשבונות/));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('שם החשבון'), { target: { value: 'עו״ש' } });
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'omer-levy', name: 'עו״ש', balance: 1000 }), 'omer-levy'
    ));
  });

  it("an 'own'-level editor sees a ScopeBadge and no OwnerPicker combobox (D7/D14/I5)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel="own" accountsEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם חשבונות/));
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    expect(screen.queryByRole('combobox', { name: /בעלים/ })).not.toBeInTheDocument();
  });

  it("a 'family'-level editor's create form offers an OwnerPicker with a chip per member (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    expect(screen.getByRole('button', { name: /עומר/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /דויד/ })).toBeInTheDocument();
  });

  it('the balance field has inputMode="decimal" (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    expect(screen.getByLabelText('יתרה')).toHaveAttribute('inputMode', 'decimal');
  });

  it('a balance at/above the confirm threshold prompts window.confirm before saving (D14/M6)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('שם החשבון'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '600000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalled();
  });

  it('declining the large-amount confirm does NOT save', async () => {
    mockList.mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('שם החשבון'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '600000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a navigationPayload.prefillCreate opens the create form pre-populated and consumes the payload (D3 pre-fill affordance)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockNavigationPayload = { prefillCreate: { name: 'מזומן (מיובא)', type: 'cash', balance: 12000 } };
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByDisplayValue('מזומן (מיובא)')).toBeInTheDocument());
    expect(screen.getByDisplayValue('12000')).toBeInTheDocument();
    expect(mockConsumePayload).toHaveBeenCalled();
  });

  it('delete asks for confirmation before calling deleteAccount', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByText('עו״ש'));
    fireEvent.click(screen.getByTestId('screen.accounts.row.delete'));
    expect(screen.getByText(/למחוק את החשבון/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('כן, מחק'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('a1', 'david-levy'));
  });

  it('cancelling the delete confirmation does not call deleteAccount', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByText('עו״ש'));
    fireEvent.click(screen.getByTestId('screen.accounts.row.delete'));
    fireEvent.click(screen.getByText('ביטול'));
    expect(screen.queryByText(/למחוק את החשבון/)).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('archived accounts render with a visible "ארכיון" badge and drop out of the total', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'ישן', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'archived', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText('ארכיון')).toBeInTheDocument());
    expect(screen.getByText('סך היתרות: ₪0')).toBeInTheDocument();
  });

  it('the total-balance summary is wired to the accounts.totalBalance glossary entry', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByLabelText('הסבר: סך היתרות')).toBeInTheDocument());
  });

  it('each account row balance carries its own <Explain> trigger — every rendered number gets one, not just the aggregate total', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' },
      { id: 'a2', ownerId: 'david-levy', name: 'Y', type: 'cash', balance: 100, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByText('X'));
    expect(screen.getAllByLabelText(/הסבר: יתרת חשבון/).length).toBe(2);
  });

  it('data-tour-id is present on the list container, the create button, and per-row edit/delete actions', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    const { container } = render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByText('X'));
    expect(container.querySelector('[data-tour-id="screen.accounts.list"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.accounts.create"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.accounts.row.edit"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.accounts.row.delete"]')).not.toBeNull();
  });

  it('an empty account name shows an inline validation error and does not call saveAccount', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין שם לחשבון/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a non-numeric balance shows an inline validation error and does not call saveAccount', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('שם החשבון'), { target: { value: 'עו״ש' } });
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין סכום תקין/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('editing an existing account pre-fills the form from the item, including its ownerId', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'omer-levy', name: 'חיסכון', type: 'bank', balance: 250, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByText('חיסכון'));
    fireEvent.click(screen.getByText('עריכה'));
    expect(screen.getByDisplayValue('חיסכון')).toBeInTheDocument();
    expect(screen.getByDisplayValue('250')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /עומר/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a dirty create form registers a leave-guard (I4) — verified via NavigationContext.setLeaveGuard being called', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    expect(mockSetLeaveGuard).toHaveBeenCalledWith(expect.any(Function));
  });
});
