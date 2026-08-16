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

import { listAccounts, saveAccount, deleteAccount } from '../services/AccountsService';

describe('AccountsService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("listAccounts('family', viewerId) reads the accounts collection unfiltered", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'a1', ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const accounts = await listAccounts('family', 'david-levy');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].type).toBe('bank');
  });

  it("listAccounts('own', viewerId) adds a where('ownerId','==',viewerId) clause (D1)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await listAccounts('own', 'omer-levy');
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__clauses).toEqual([{ field: 'ownerId', op: '==', value: 'omer-levy' }]);
  });

  it('saveAccount writes to accounts/{id} with an "account.save" audit action', async () => {
    await saveAccount({ ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active' }, 'david-levy');
    expect(mockTxSet).toHaveBeenCalledWith('doc:accounts/auto-1', expect.objectContaining({ type: 'bank' }));
    const auditCall = mockTxSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'account.save', target: 'accounts/auto-1' });
  });

  it('deleteAccount deletes accounts/{id} and audits "account.delete"', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await deleteAccount('a1', 'david-levy');
    expect(mockTxDelete).toHaveBeenCalledWith('doc:accounts/a1');
    const auditCall = mockTxSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'account.delete', target: 'accounts/a1' });
  });
});
