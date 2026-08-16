// M6 — getCategories() used to self-seed via setDoc on a missing/empty doc, but `settings`
// writes are super-admin/parent only (firestore.rules): a member-role session mounting FilterBar
// for the first time on a fresh database hit permission-denied and, per this project's own
// no-silent-catch rule, rendered a permanent error. Seeding now happens once, at bootstrap, in
// MembersService.ensureSeeded() (super-admin-gated) — see MembersService.test.ts's ensureSeeded
// describe block for that half. This file verifies getCategories() itself never writes.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { setDocMock, getDocMock } = vi.hoisted(() => ({
  setDocMock: vi.fn(),
  getDocMock: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDoc: getDocMock,
  setDoc: setDocMock,
  arrayUnion: vi.fn((...items: unknown[]) => ({ __arrayUnion: items })),
}));

import { getCategories, addCategory } from '../services/CategoriesService';

describe('getCategories (M6 — no more seed-on-read)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty list for a missing doc and NEVER calls setDoc (a member-role session cannot write settings/*)', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    const result = await getCategories();
    expect(result).toEqual([]);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('returns an empty list for an existing doc with no list field, without writing', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    const result = await getCategories();
    expect(result).toEqual([]);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('returns the persisted list as-is when present', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ list: ['מזון וצריכה', 'חינוך וחוגים'] }) });
    const result = await getCategories();
    expect(result).toEqual(['מזון וצריכה', 'חינוך וחוגים']);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('propagates a read failure as a rejection (never swallowed into [])', async () => {
    getDocMock.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(getCategories()).rejects.toThrow('permission-denied');
  });
});

describe('addCategory (unchanged)', () => {
  it('still merges a new name into the categories doc', async () => {
    setDocMock.mockResolvedValueOnce(undefined);
    await addCategory('קטגוריה חדשה');
    expect(setDocMock).toHaveBeenCalledWith(
      'doc:settings/categories',
      { list: { __arrayUnion: ['קטגוריה חדשה'] } },
      { merge: true }
    );
  });
});
