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

import { listAccounts, saveAccount, deleteAccount } from '../services/AccountsService';

describe('AccountsService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listAccounts reads the accounts collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'a1', ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const accounts = await listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].type).toBe('bank');
  });

  it('saveAccount writes to accounts/{id} with an "account.save" audit action', async () => {
    await saveAccount({ ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active' }, 'david-levy');
    expect(mockBatchSet).toHaveBeenCalledWith('doc:accounts/auto-1', expect.objectContaining({ type: 'bank' }));
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'account.save', target: 'accounts/auto-1' });
  });

  it('deleteAccount deletes accounts/{id} and audits "account.delete"', async () => {
    await deleteAccount('a1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:accounts/a1');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'account.delete', target: 'accounts/a1' });
  });
});
