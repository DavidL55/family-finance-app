import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => `col:${name}`),
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDocs: mockGetDocs,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { deleteGroup, listGroups, saveGroup } from '../services/GroupsService';

describe('GroupsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listGroups reads the groups collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' }) }],
    });
    const groups = await listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('הילדים');
  });

  it('listGroups propagates a read failure', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('down'));
    await expect(listGroups()).rejects.toThrow('down');
  });

  it('saveGroup writes the group doc AND an audit log entry in the same batch', async () => {
    await saveGroup({ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'] }, 'david-levy');
    expect(mockBatchSet).toHaveBeenCalledWith('doc:groups/kids', expect.objectContaining({ id: 'kids', name: 'הילדים' }));
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'group.save', target: 'groups/kids' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('deleteGroup deletes the group AND writes an audit entry, in one batch', async () => {
    await deleteGroup('kids', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:groups/kids');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'group.delete', target: 'groups/kids' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
