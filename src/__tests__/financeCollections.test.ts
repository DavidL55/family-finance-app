import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  // Two real firebase/firestore `doc()` overloads used here: doc(db, name, id) (3 args) for a
  // known id, and doc(collectionRef) (1 arg) for a fresh auto-id.
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-id-1' };
    const [, ...segments] = args as [unknown, ...string[]];
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { createOwnedCollectionRepo, type OwnedRecord } from '../services/financeCollections';

interface Widget extends OwnedRecord {
  name: string;
  amount: number;
}

const { list, save, remove } = createOwnedCollectionRepo<Widget>('widgets', 'widget');

describe('createOwnedCollectionRepo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list() reads every doc in the named collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'X', amount: 10, createdAt: 'a', updatedAt: 'b' }) }],
    });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('X');
  });

  it('list() propagates a read failure (never swallows into [])', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('down'));
    await expect(list()).rejects.toThrow('down');
  });

  it('save() with no id creates a new doc: fresh auto-id, createdAt===updatedAt, and an audit entry, in one batch', async () => {
    const result = await save({ ownerId: 'omer-levy', name: 'New', amount: 5 }, 'david-levy');
    expect(result.id).toBe('auto-id-1');
    expect(result.createdAt).toBe(result.updatedAt);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:widgets/auto-id-1',
      expect.objectContaining({ id: 'auto-id-1', ownerId: 'omer-levy', name: 'New', amount: 5 })
    );
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'widget.save', target: 'widgets/auto-id-1' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('save() with an id that already exists PRESERVES createdAt (fetch-then-merge) while updating everything else', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
    });
    const result = await save({ id: 'w1', ownerId: 'omer-levy', name: 'Renamed', amount: 2 }, 'david-levy');
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:widgets/w1',
      expect.objectContaining({ name: 'Renamed', createdAt: '2026-01-01T00:00:00.000Z' })
    );
  });

  it('save() with an id that does NOT yet exist (a caller-supplied new id) treats it as brand-new — createdAt=now', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const result = await save({ id: 'w-new', ownerId: 'omer-levy', name: 'X', amount: 1 }, 'david-levy');
    expect(result.createdAt).toBe(result.updatedAt);
  });

  it('save() propagates a write failure (never silently drops the edit)', async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(save({ ownerId: 'omer-levy', name: 'X', amount: 1 }, 'david-levy')).rejects.toThrow('permission-denied');
  });

  it('remove() deletes the doc and writes a "widget.delete" audit entry, in one batch', async () => {
    await remove('w1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:widgets/w1');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'widget.delete', target: 'widgets/w1' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
