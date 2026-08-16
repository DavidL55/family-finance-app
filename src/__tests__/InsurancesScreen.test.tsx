// Stage 5 Task 6 — InsurancesScreen, built on the shared useOwnedCollectionScreen<T> hook (D13),
// same composition as AccountsScreen (Task 3) / LoansScreen (Task 4) with zero hook changes. The
// real delta this collection introduces: a SECOND member reference (insuredMemberId, "who is
// covered" — a plain <select>, deliberately NOT OwnerPicker, since isValidInsurance only requires
// it non-empty and any viewer who can create a policy at all may name any insured member), a
// dynamic coverages[] add/remove list, a native renewalDate date input with a "מתחדש בקרוב"
// callout badge, and a documentId rendered as a plain text reference (no picker, no archive —
// the `documents` collection has no Firestore rules match block, per the plan's own dated risk).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InsurancesScreen from '../components/InsurancesScreen';

const { mockList, mockSave, mockRemove, mockConsumePayload, mockSetLeaveGuard } = vi.hoisted(() => ({
  mockList: vi.fn(), mockSave: vi.fn(), mockRemove: vi.fn(), mockConsumePayload: vi.fn(), mockSetLeaveGuard: vi.fn(),
}));
vi.mock('../services/InsurancesService', () => ({
  listInsurances: mockList,
  saveInsurance: mockSave,
  deleteInsurance: mockRemove,
}));

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

const INSURANCE_FIXTURE = {
  id: 'i1',
  ownerId: 'david-levy',
  insuredMemberId: 'omer-levy',
  type: 'health' as const,
  provider: 'הראל',
  premium: 200,
  premiumFrequency: 'monthly' as const,
  coverages: [{ label: 'אשפוז', amount: 1000000 }],
  renewalDate: '2099-01-01',
  status: 'active' as const,
  createdAt: 'x',
  updatedAt: 'x',
};

describe('InsurancesScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockNavigationPayload = null; });

  it('loading state renders before the list resolves', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('empty state (zero insurances, successful read) renders an inviting "no policies yet" message, not a blank list', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/עדיין לא הוספתם פוליסות ביטוח/)).toBeInTheDocument());
  });

  it('a failed read renders an explicit error, never an empty list (Global Constraints)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'unavailable' }));
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/טעינת הביטוחים נכשלה/)).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא הוספתם פוליסות ביטוח/)).not.toBeInTheDocument();
  });

  it('a permission-denied read renders the calm access message, never the red error banner (S2)', async () => {
    render(<InsurancesScreen session={{ memberId: 'omer-levy', role: 'member' }} insurancesViewLevel={undefined} insurancesEditLevel={undefined} />);
    await waitFor(() => expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument());
    expect(mockList).not.toHaveBeenCalled();
  });

  it("create form defaults ownerId AND insuredMemberId to the acting session's memberId (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<InsurancesScreen session={{ memberId: 'omer-levy', role: 'member' }} insurancesViewLevel="own" insurancesEditLevel="own" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'הראל' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'omer-levy', insuredMemberId: 'omer-levy', provider: 'הראל', premium: 150 }),
      'omer-levy'
    ));
  });

  it("an 'own'-level editor sees a ScopeBadge and no OwnerPicker combobox, but DOES see the insuredMemberId select (D7/D14/I5)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'omer-levy', role: 'member' }} insurancesViewLevel="own" insurancesEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם פוליסות ביטוח/));
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    expect(screen.queryByRole('combobox', { name: 'בעלים' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'מבוטח' })).toBeInTheDocument();
  });

  it("a 'family'-level editor's create form offers an OwnerPicker with a chip per member for 'בעלים' (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    expect(screen.getByRole('button', { name: /עומר/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /דויד/ })).toBeInTheDocument();
  });

  it('insuredMemberId is a plain <select> distinct from ownerId, fed by familyMembers, and unrestricted at any edit level', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    const insuredSelect = screen.getByLabelText('מבוטח');
    fireEvent.change(insuredSelect, { target: { value: 'omer-levy' } });
    expect(insuredSelect).toHaveValue('omer-levy');
  });

  it('premium has inputMode="decimal" (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    expect(screen.getByLabelText('פרמיה')).toHaveAttribute('inputMode', 'decimal');
  });

  it('renewalDate is a native date input (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    expect(screen.getByLabelText('תאריך חידוש')).toHaveAttribute('type', 'date');
  });

  it('renders a coverage row for each entry in coverages', async () => {
    mockList.mockResolvedValueOnce([{ id: 'i1', ownerId: 'david-levy', insuredMemberId: 'omer-levy', type: 'health', provider: 'הראל', premium: 200, premiumFrequency: 'monthly', coverages: [{ label: 'אשפוז', amount: 1000000 }], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByText('אשפוז')).toBeInTheDocument());
  });

  it('a renewal date within 30 days shows the "מתחדש בקרוב" badge; one far away does not', async () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    mockList.mockResolvedValueOnce([
      { id: 'i1', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'car', provider: 'X', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: soon, status: 'active', createdAt: 'x', updatedAt: 'x' },
      { id: 'i2', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'home', provider: 'Y', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getAllByText('מתחדש בקרוב')).toHaveLength(1));
  });

  it('totalPremium divides a yearly premium by 12 before summing with monthly ones', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'i1', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'car', provider: 'X', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
      { id: 'i2', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'life', provider: 'Y', premium: 1200, premiumFrequency: 'yearly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/סך הפרמיה החודשית: ₪200/)).toBeInTheDocument()); // 100 + (1200/12)
  });

  it('a lapsed/cancelled policy is excluded from totalPremium, same convention as accounts/loans active-only totals', async () => {
    mockList.mockResolvedValueOnce([
      { id: 'i1', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'car', provider: 'X', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
      { id: 'i2', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'life', provider: 'Y', premium: 5000, premiumFrequency: 'monthly', coverages: [], renewalDate: '2099-01-01', status: 'cancelled', createdAt: 'x', updatedAt: 'x' },
    ]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/סך הפרמיה החודשית: ₪100/)).toBeInTheDocument());
  });

  it('the coverage amount field has inputMode="decimal" (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    expect(screen.getByLabelText('סכום כיסוי')).toHaveAttribute('inputMode', 'decimal');
  });

  it('adding two coverage rows and removing one leaves exactly one row, and saves only the remaining label', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    expect(screen.getAllByLabelText('תיאור כיסוי')).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText('תיאור כיסוי')[0], { target: { value: 'אשפוז' } });
    fireEvent.change(screen.getAllByLabelText('סכום כיסוי')[0], { target: { value: '500000' } });
    fireEvent.click(screen.getAllByLabelText('הסר כיסוי')[1]);
    expect(screen.getAllByLabelText('תיאור כיסוי')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ coverages: [{ label: 'אשפוז', amount: 500000 }] }),
      'david-levy'
    ));
  });

  it('a blank coverage row (never filled in) is silently dropped on save, not submitted empty', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ coverages: [] }), 'david-levy'));
  });

  it('a coverage row with an amount but no label blocks submit with an inline validation error, instead of silently dropping the entered amount', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    fireEvent.change(screen.getByLabelText('סכום כיסוי'), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין תיאור לכל כיסוי שהוזן לו סכום/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('filling in the label after the amount-without-label error clears it and saves normally', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    fireEvent.change(screen.getByLabelText('סכום כיסוי'), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין תיאור לכל כיסוי שהוזן לו סכום/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('תיאור כיסוי'), { target: { value: 'אשפוז' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ coverages: [{ label: 'אשפוז', amount: 500000 }] }),
      'david-levy'
    ));
  });

  it('the coverage-row remove control has a proper square 44x44 touch target (min-h and min-w), not just tall-but-narrow', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('הוסף כיסוי'));
    const removeButton = screen.getByLabelText('הסר כיסוי');
    expect(removeButton.className).toContain('min-h-[44px]');
    expect(removeButton.className).toContain('min-w-[44px]');
  });

  it('navigating away with a dirty, open insurance form triggers the leave-guard confirm (I4)', async () => {
    mockList.mockResolvedValueOnce([]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'הראל' } });
    const guard = mockSetLeaveGuard.mock.calls.at(-1)![0];
    expect(guard()).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('a balance/premium at or above the confirm threshold prompts window.confirm before saving (D14/M6)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '600000' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalled();
  });

  it('declining the large-amount confirm does NOT save', async () => {
    mockList.mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '600000' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('delete asks for confirmation before calling deleteInsurance', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByText('הראל'));
    fireEvent.click(screen.getByTestId('screen.insurances.row.delete'));
    expect(screen.getByText(/למחוק את הפוליסה/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('כן, מחק'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('i1', 'david-levy'));
  });

  it('cancelling the delete confirmation does not call deleteInsurance', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByText('הראל'));
    fireEvent.click(screen.getByTestId('screen.insurances.row.delete'));
    fireEvent.click(screen.getByText('ביטול'));
    expect(screen.queryByText(/למחוק את הפוליסה/)).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('the total-premium summary is wired to the insurances.totalPremium glossary entry', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByLabelText('הסבר: סך הפרמיה החודשית')).toBeInTheDocument());
  });

  it('each row premium and each coverage amount carry their own <Explain> triggers (כל מספר)', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByText('הראל'));
    expect(screen.getByLabelText(/הסבר: פרמיה/)).toBeInTheDocument();
    expect(screen.getByLabelText(/הסבר: סכום כיסוי/)).toBeInTheDocument();
  });

  it('a documentId is rendered as a plain text reference, never a clickable link or picker', async () => {
    mockList.mockResolvedValueOnce([{ ...INSURANCE_FIXTURE, documentId: 'doc-123' }]);
    const { container } = render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/מסמך מקושר: doc-123/)).toBeInTheDocument());
    expect(container.querySelector('a[href*="doc-123"]')).toBeNull();
  });

  it('no documentId reference line renders when the policy has none', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByText('הראל'));
    expect(screen.queryByText(/מסמך מקושר/)).not.toBeInTheDocument();
  });

  it('data-tour-id is present on the list container, the create button, and per-row edit/delete actions', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    const { container } = render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByText('הראל'));
    expect(container.querySelector('[data-tour-id="screen.insurances.list"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.insurances.create"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.insurances.row.edit"]')).not.toBeNull();
    expect(container.querySelector('[data-tour-id="screen.insurances.row.delete"]')).not.toBeNull();
  });

  it('an empty provider shows an inline validation error and does not call saveInsurance', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין את שם חברת הביטוח/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a missing renewal date shows an inline validation error and does not call saveInsurance', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש לבחור תאריך חידוש/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a non-numeric premium shows an inline validation error and does not call saveInsurance', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    fireEvent.click(screen.getByTestId('screen.insurances.create'));
    fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('תאריך חידוש'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByLabelText('פרמיה'), { target: { value: '' } });
    fireEvent.click(screen.getByText('שמור'));
    expect(await screen.findByText(/יש להזין פרמיה תקינה/)).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('editing an existing insurance pre-fills the form from the item, including insuredMemberId, coverages, and dates', async () => {
    mockList.mockResolvedValueOnce([INSURANCE_FIXTURE]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByText('הראל'));
    fireEvent.click(screen.getByText('עריכה'));
    expect(screen.getByLabelText('ספק')).toHaveValue('הראל');
    expect(screen.getByLabelText('מבוטח')).toHaveValue('omer-levy');
    expect(screen.getByDisplayValue('200')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2099-01-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('אשפוז')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1000000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /דויד/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a dirty create form registers a leave-guard (I4) — verified via NavigationContext.setLeaveGuard being called', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.insurances.create'));
    expect(mockSetLeaveGuard).toHaveBeenCalledWith(expect.any(Function));
  });
});
