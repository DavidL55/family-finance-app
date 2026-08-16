// Stage 5 Task 5 — useNetWorth is the sole net-worth loader, shared by Dashboard's card and the
// dedicated NetWorthScreen (D3). Builds on useScopedRead for its accounts/loans fetches (the
// controller-mandated extraction — see useScopedRead.ts and useOwnedCollectionScreen.ts's own
// header comments) — this file mounts NO providers at all (no FilterProvider/NavigationProvider),
// which is only possible because useScopedRead has zero context dependencies.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNetWorth, netWorthGlossaryId } from '../hooks/useNetWorth';

const { mockListAccounts, mockListLoans, mockGetDocs, mockGetDoc } = vi.hoisted(() => ({
  mockListAccounts: vi.fn(), mockListLoans: vi.fn(), mockGetDocs: vi.fn(), mockGetDoc: vi.fn(),
}));
vi.mock('../services/AccountsService', () => ({ listAccounts: mockListAccounts }));
vi.mock('../services/LoansService', () => ({ listLoans: mockListLoans }));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((_db, ...segs: string[]) => ({ __doc: segs.join('/') })),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
}));

describe('useNetWorth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes assets minus liabilities from real accounts/loans/investments, archived accounts excluded', async () => {
    mockListAccounts.mockResolvedValueOnce([
      { id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' },
      { id: 'a2', ownerId: 'david-levy', name: 'Old', type: 'bank', balance: 5000, balanceUpdatedAt: 'x', status: 'archived', createdAt: 'x', updatedAt: 'x' },
    ]);
    mockListLoans.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'X', loanType: 'other', principal: 1000, balance: 400, interestRate: 1, monthlyPayment: 10, startDate: 'x', endDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    mockGetDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ value: 2000 }) }] }); // investments
    mockGetDoc.mockResolvedValueOnce({ exists: () => false }); // settings/ecosystem
    const { result } = renderHook(() => useNetWorth('family', 'david-levy', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result!.totalAssets).toBe(3000); // 1000 (archived excluded) + 2000
    expect(result.current.result!.totalLiabilities).toBe(400);
    expect(result.current.result!.netWorth).toBe(2600);
    expect(result.current.accountsCount).toBe(2); // raw count includes the archived one
    expect(result.current.isIncomplete).toBe(false);
  });

  it("isIncomplete is true when accounts OR loans is genuinely empty — NOT derived from result.assets.length (B1 fix)", async () => {
    mockListAccounts.mockResolvedValueOnce([]); // genuinely zero accounts
    mockListLoans.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'X', loanType: 'other', principal: 1000, balance: 400, interestRate: 1, monthlyPayment: 10, startDate: 'x', endDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // result.assets still has exactly one 'accounts' line item (amount 0) — netWorth.ts always
    // pushes it — so a length-based check would wrongly read this as "complete". Assert the hook
    // does NOT make that mistake:
    expect(result.current.result!.assets.some((a) => a.source === 'accounts')).toBe(true);
    expect(result.current.accountsCount).toBe(0);
    expect(result.current.isIncomplete).toBe(true);
  });

  it('surfaces a legacy cash hint only when accounts is empty AND settings/ecosystem.liquid is non-zero', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'X', loanType: 'other', principal: 1, balance: 1, interestRate: 1, monthlyPayment: 1, startDate: 'x', endDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ all: { liquid: 42000, mortgage: 0 } }) });
    const { result } = renderHook(() => useNetWorth('family', 'david-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.legacyCashHint).toEqual({ bucket: 'liquid', value: 42000 });
    expect(result.current.legacyMortgageHint).toBeNull(); // loans not empty, and value is 0 anyway
  });

  it('investmentsReadable=false excludes investments without a getDocs call', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(result.current.result!.assets.find((a) => a.source === 'investments')).toBeUndefined();
  });

  it('a permission-denied ecosystem (real estate/legacy hints) read does NOT fail the whole hook', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result!.assets.find((a) => a.source === 'realEstate')).toBeUndefined();
    expect(result.current.legacyCashHint).toBeNull(); // unreachable legacy doc — no hint offered, not an error
  });

  it('accounts/loans permission-denied DOES set the whole hook to permission-denied (a central failure, not optional data)', async () => {
    mockListAccounts.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
  });

  it('a genuine connectivity failure on accounts renders error, never resets to an empty/zero result', async () => {
    mockListAccounts.mockRejectedValueOnce(new Error('down'));
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.result).toBeNull();
  });

  it('reload() re-fetches accounts, loans, and the legacy doc', async () => {
    mockListAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' },
    ]);
    mockListLoans.mockResolvedValue([]);
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('family', 'david-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.accountsCount).toBe(0);
    result.current.reload();
    await waitFor(() => expect(result.current.accountsCount).toBe(1));
  });
});

describe('netWorthGlossaryId', () => {
  it('maps side+source to the D4 id scheme', () => {
    expect(netWorthGlossaryId('assets', 'accounts')).toBe('netWorth.assets.accounts');
    expect(netWorthGlossaryId('liabilities', 'loans')).toBe('netWorth.liabilities.loans');
  });
});
