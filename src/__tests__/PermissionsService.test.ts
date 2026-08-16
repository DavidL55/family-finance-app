import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
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
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
}));

import {
  listPermissionDocs,
  recomputeAllResolvedPermissions,
  recomputeResolvedPermissions,
  saveModulePermissions,
} from '../services/PermissionsService';

describe('PermissionsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listPermissionDocs reads the permissions collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy' }) }],
    });
    const docs = await listPermissionDocs();
    expect(docs).toHaveLength(1);
  });

  it('listPermissionDocs propagates a read failure', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('down'));
    await expect(listPermissionDocs()).rejects.toThrow('down');
  });

  it('saveModulePermissions writes the matrix doc with a deterministic id and an audit entry', async () => {
    await saveModulePermissions('group', 'kids', { expenses: { view: 'own', edit: 'none' } }, 'david-levy');
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:permissions/group__kids',
      expect.objectContaining({ scope: 'group', targetId: 'kids', modules: { expenses: { view: 'own', edit: 'none' } } })
    );
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'permissions.update', target: 'permissions/group__kids' });
  });

  it('recomputeResolvedPermissions reads the member, its groups, its exception doc, resolves, and writes resolvedPermissions', async () => {
    // 1st getDoc: the member doc
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#111', groups: ['kids'], createdAt: 'x', updatedAt: 'x' }),
    });
    // getDocs: all permission docs (service filters client-side to what's relevant)
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { data: () => ({ id: 'group__kids', scope: 'group', targetId: 'kids', modules: { expenses: { view: 'own', edit: 'none' } }, updatedAt: 'x', updatedBy: 'david-levy' }) },
      ],
    });

    await recomputeResolvedPermissions('omer-levy');

    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:members/omer-levy',
      { resolvedPermissions: { expenses: { view: 'own', edit: 'none' } } },
      { merge: true }
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('recomputeResolvedPermissions writes {} when the member has no groups and no exception', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'lonely', name: 'X', role: 'ילד', color: '#111', groups: [], createdAt: 'x', updatedAt: 'x' }),
    });
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await recomputeResolvedPermissions('lonely');
    expect(mockBatchSet).toHaveBeenCalledWith('doc:members/lonely', { resolvedPermissions: {} }, { merge: true });
  });

  it('recomputeResolvedPermissions throws (does not silently no-op) when the member does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(recomputeResolvedPermissions('ghost')).rejects.toThrow(/not found/i);
  });

  describe('recomputeAllResolvedPermissions', () => {
    it('continues past one failing member, recomputes the rest, and throws an aggregate error naming the failed id', async () => {
      // 1st getDocs: the members collection list (recomputeAllResolvedPermissions itself)
      mockGetDocs.mockResolvedValueOnce({ docs: [{ id: 'member-a' }, { id: 'member-b' }] });
      // member-a's getDoc rejects -> recomputeResolvedPermissions('member-a') throws before it
      // ever calls listPermissionDocs, so no extra getDocs call is consumed for member-a.
      mockGetDoc.mockRejectedValueOnce(new Error('firestore down for member-a'));
      // member-b succeeds: getDoc resolves, then its own listPermissionDocs getDocs call.
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ id: 'member-b', name: 'B', role: 'ילד', color: '#111', groups: [], createdAt: 'x', updatedAt: 'x' }),
      });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      await expect(recomputeAllResolvedPermissions()).rejects.toThrow(/member-a/);

      // member-b was still recomputed and written despite member-a's failure earlier in the loop.
      expect(mockBatchSet).toHaveBeenCalledWith('doc:members/member-b', { resolvedPermissions: {} }, { merge: true });
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
    });

    it('all members succeeding resolves cleanly with no thrown aggregate', async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [{ id: 'member-a' }] });
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ id: 'member-a', name: 'A', role: 'ילד', color: '#111', groups: [], createdAt: 'x', updatedAt: 'x' }),
      });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });

      await expect(recomputeAllResolvedPermissions()).resolves.toBeUndefined();
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
    });
  });
});
