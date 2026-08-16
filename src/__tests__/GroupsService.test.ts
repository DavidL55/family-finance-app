import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockBatchSet, mockBatchDelete, mockBatchUpdate, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  // doc(db, name, id) (path segments after db) OR doc(collectionRef, id) (writeAuditLog's shape,
  // D10 — the collectionRef carries the collection name via its mocked `__col` field, since
  // `collection()` never actually touches `db`).
  doc: vi.fn((...args: unknown[]) => {
    const [first, ...rest] = args as [unknown, ...string[]];
    const segments =
      typeof first === 'object' && first !== null && '__col' in first
        ? [(first as { __col: string }).__col, ...rest]
        : rest;
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  arrayUnion: vi.fn((...vals: unknown[]) => ({ __op: 'arrayUnion', vals })),
  arrayRemove: vi.fn((...vals: unknown[]) => ({ __op: 'arrayRemove', vals })),
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, update: mockBatchUpdate, commit: mockBatchCommit })),
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

  describe('members/{id}.groups sync — closes the "Stage 2 fills" gap so recomputeResolvedPermissions (which reads member.groups, never groups.memberIds) actually sees membership changes', () => {
    it('a brand-new group (no previousMemberIds arg) arrayUnions every member in memberIds', async () => {
      await saveGroup({ id: 'kids', name: 'הילדים', memberIds: ['omer-levy', 'lilit-levy'] }, 'david-levy');
      expect(mockBatchUpdate).toHaveBeenCalledWith('doc:members/omer-levy', { groups: { __op: 'arrayUnion', vals: ['kids'] } });
      expect(mockBatchUpdate).toHaveBeenCalledWith('doc:members/lilit-levy', { groups: { __op: 'arrayUnion', vals: ['kids'] } });
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    });

    it('editing an existing group arrayUnions only newly-added members and arrayRemoves only newly-removed members (not members present both before and after)', async () => {
      await saveGroup(
        { id: 'kids', name: 'הילדים', memberIds: ['lilit-levy', 'omer-levy'] },
        'david-levy',
        ['omer-levy', 'david-levy'] // previous: omer + david; new: lilit + omer -> omer unchanged
      );
      // omer-levy is in both before and after -> no update call for omer-levy at all.
      expect(mockBatchUpdate).not.toHaveBeenCalledWith('doc:members/omer-levy', expect.anything());
      // lilit-levy newly added -> arrayUnion.
      expect(mockBatchUpdate).toHaveBeenCalledWith('doc:members/lilit-levy', { groups: { __op: 'arrayUnion', vals: ['kids'] } });
      // david-levy removed -> arrayRemove.
      expect(mockBatchUpdate).toHaveBeenCalledWith('doc:members/david-levy', { groups: { __op: 'arrayRemove', vals: ['kids'] } });
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    });

    it('deleteGroup arrayRemoves the group id from every provided memberId', async () => {
      await deleteGroup('kids', 'david-levy', ['omer-levy', 'lilit-levy']);
      expect(mockBatchUpdate).toHaveBeenCalledWith('doc:members/omer-levy', { groups: { __op: 'arrayRemove', vals: ['kids'] } });
      expect(mockBatchUpdate).toHaveBeenCalledWith('doc:members/lilit-levy', { groups: { __op: 'arrayRemove', vals: ['kids'] } });
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    });

    it('deleteGroup with no memberIds arg does not touch any member doc', async () => {
      await deleteGroup('kids', 'david-levy');
      expect(mockBatchUpdate).not.toHaveBeenCalled();
    });
  });
});
