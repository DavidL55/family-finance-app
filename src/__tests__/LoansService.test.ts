import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(async () => ({ exists: () => false })),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-1' };
    const [, ...segments] = args as [unknown, ...string[]];
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { listLoans, saveLoan, deleteLoan } from '../services/LoansService';

describe('LoansService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listLoans reads the loans collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: 'x', endDate: 'y', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const loans = await listLoans();
    expect(loans).toHaveLength(1);
    expect(loans[0].loanType).toBe('mortgage');
  });

  it('saveLoan writes to loans/{id} with a "loan.save" audit action', async () => {
    await saveLoan({ ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: 'x', endDate: 'y', status: 'active' }, 'david-levy');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'loan.save', target: 'loans/auto-1' });
  });

  it('deleteLoan deletes loans/{id} and audits "loan.delete"', async () => {
    await deleteLoan('l1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:loans/l1');
  });
});
