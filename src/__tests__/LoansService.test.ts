import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockTxGet, mockTxSet, mockTxDelete, mockRunTransaction } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockTxGet: vi.fn(async () => ({ exists: (): boolean => false, data: (): unknown => undefined })),
  mockTxSet: vi.fn(),
  mockTxDelete: vi.fn(),
  mockRunTransaction: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-1' };
    const [first, ...rest] = args as [unknown, ...string[]];
    const segments =
      typeof first === 'object' && first !== null && '__col' in first
        ? [(first as { __col: string }).__col, ...rest]
        : rest;
    return `doc:${segments.join('/')}`;
  }),
  query: vi.fn((colRef: { __col: string }, ...clauses: unknown[]) => ({ __col: colRef.__col, __clauses: clauses })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  getDocs: mockGetDocs,
  runTransaction: mockRunTransaction.mockImplementation(async (_db: unknown, updateFn: (tx: unknown) => unknown) => {
    const tx = { get: mockTxGet, set: mockTxSet, delete: mockTxDelete };
    return updateFn(tx);
  }),
}));

import { listLoans, saveLoan, deleteLoan } from '../services/LoansService';

describe('LoansService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("listLoans('family', viewerId) reads the loans collection unfiltered", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: 'x', endDate: 'y', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const loans = await listLoans('family', 'david-levy');
    expect(loans).toHaveLength(1);
    expect(loans[0].loanType).toBe('mortgage');
  });

  it("listLoans('own', viewerId) adds a where('ownerId','==',viewerId) clause (D1)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await listLoans('own', 'omer-levy');
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__clauses).toEqual([{ field: 'ownerId', op: '==', value: 'omer-levy' }]);
  });

  it('saveLoan writes to loans/{id} with a "loan.save" audit action', async () => {
    await saveLoan({ ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: 'x', endDate: 'y', status: 'active' }, 'david-levy');
    const auditCall = mockTxSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'loan.save', target: 'loans/auto-1' });
  });

  it('deleteLoan deletes loans/{id} and audits "loan.delete"', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await deleteLoan('l1', 'david-levy');
    expect(mockTxDelete).toHaveBeenCalledWith('doc:loans/l1');
  });
});
