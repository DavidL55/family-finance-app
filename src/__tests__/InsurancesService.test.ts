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

import { listInsurances, saveInsurance, deleteInsurance } from '../services/InsurancesService';

describe('InsurancesService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("listInsurances('family', viewerId) reads the insurances collection unfiltered", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'i1', ownerId: 'david-levy', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', premium: 300, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const policies = await listInsurances('family', 'david-levy');
    expect(policies).toHaveLength(1);
    expect(policies[0].type).toBe('car');
  });

  it("listInsurances('own', viewerId) adds a where('ownerId','==',viewerId) clause (D1)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await listInsurances('own', 'omer-levy');
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__clauses).toEqual([{ field: 'ownerId', op: '==', value: 'omer-levy' }]);
  });

  it('saveInsurance writes to insurances/{id} with an "insurance.save" audit action', async () => {
    await saveInsurance({ ownerId: 'david-levy', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', premium: 300, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active' }, 'david-levy');
    const auditCall = mockTxSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'insurance.save', target: 'insurances/auto-1' });
  });

  it('deleteInsurance deletes insurances/{id} and audits "insurance.delete"', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await deleteInsurance('i1', 'david-levy');
    expect(mockTxDelete).toHaveBeenCalledWith('doc:insurances/i1');
  });
});
