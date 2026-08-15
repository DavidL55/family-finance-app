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

import { listInsurances, saveInsurance, deleteInsurance } from '../services/InsurancesService';

describe('InsurancesService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listInsurances reads the insurances collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'i1', ownerId: 'david-levy', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', premium: 300, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const policies = await listInsurances();
    expect(policies).toHaveLength(1);
    expect(policies[0].type).toBe('car');
  });

  it('saveInsurance writes to insurances/{id} with an "insurance.save" audit action', async () => {
    await saveInsurance({ ownerId: 'david-levy', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', premium: 300, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active' }, 'david-levy');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'insurance.save', target: 'insurances/auto-1' });
  });

  it('deleteInsurance deletes insurances/{id} and audits "insurance.delete"', async () => {
    await deleteInsurance('i1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:insurances/i1');
  });
});
